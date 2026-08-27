const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    eventKey: row.event_key,
    label: row.label,
    enabled: !!row.enabled,
    subject: row.subject,
    body: row.body,
    reminderDaysBefore: row.reminder_days_before,
    updatedAt: row.updated_at,
  };
}

// The set of automations is fixed by what the code actually fires (see
// server/lib/automations.js callers) — admins can only edit copy/on-off/
// timing, not create or delete rows, so this route is GET+PUT only.
router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM email_automations ORDER BY id');
  res.json({ automations: rows.map(serialize) });
});

// GET /api/automations/history?eventKey=&status=&from=&to=
// Backs admin-automations.html's Execution History tab. Capped at 200 rows —
// this is a recent-activity view, not a paginated archive.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
router.get('/history', requireAuth, async (req, res) => {
  let sql = `
    SELECT ae.id, ae.event_key, ae.recipient_email, ae.status, ae.error_message,
           ae.duration_ms, ae.fired_at, ea.label AS automation_label,
           nc.name AS contact_name
    FROM automation_executions ae
    LEFT JOIN email_automations ea ON ea.event_key = ae.event_key
    LEFT JOIN newsletter_contacts nc ON nc.email = ae.recipient_email
    WHERE 1=1`;
  const params = [];

  if (req.query.eventKey) {
    sql += ' AND ae.event_key = ?';
    params.push(req.query.eventKey);
  }
  if (['success', 'failed', 'skipped'].includes(req.query.status)) {
    sql += ' AND ae.status = ?';
    params.push(req.query.status);
  }
  if (DATE_PATTERN.test(req.query.from)) {
    sql += ' AND ae.fired_at >= ?';
    params.push(req.query.from + ' 00:00:00');
  }
  if (DATE_PATTERN.test(req.query.to)) {
    sql += ' AND ae.fired_at <= ?';
    params.push(req.query.to + ' 23:59:59');
  }
  sql += ' ORDER BY ae.fired_at DESC LIMIT 200';

  const [rows] = await pool.query(sql, params);
  res.json({
    executions: rows.map(r => ({
      id: r.id,
      eventKey: r.event_key,
      automationLabel: r.automation_label || r.event_key,
      recipientEmail: r.recipient_email,
      contactName: r.contact_name || null,
      status: r.status,
      errorMessage: r.error_message,
      durationMs: r.duration_ms,
      firedAt: r.fired_at,
    })),
  });
});

// GET /api/automations/stats — per-event_key execution/success-rate counts
// (Automations tab table) plus today/last-24h aggregates (Overview tab).
router.get('/stats', requireAuth, async (req, res) => {
  const [byEvent] = await pool.query(
    `SELECT event_key,
            COUNT(*) AS total,
            SUM(status = 'success') AS successes
     FROM automation_executions
     GROUP BY event_key`
  );
  const [[today]] = await pool.query(
    `SELECT
       SUM(fired_at >= CURDATE()) AS executions_today,
       SUM(fired_at >= CURDATE() AND status = 'success') AS messages_today,
       SUM(fired_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) AND status = 'failed') AS failed_24h
     FROM automation_executions`
  );

  res.json({
    byEvent: Object.fromEntries(byEvent.map(r => [
      r.event_key,
      { executions: Number(r.total), successRate: r.total > 0 ? Math.round((Number(r.successes) / Number(r.total)) * 100) : null },
    ])),
    overview: {
      executionsToday: Number(today.executions_today || 0),
      messagesToday: Number(today.messages_today || 0),
      failed24h: Number(today.failed_24h || 0),
    },
  });
});

router.put('/:eventKey', requireAuth, async (req, res) => {
  const b = req.body || {};
  const subject = (b.subject || '').trim();
  const body = (b.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Subject and body are required' });

  const [existing] = await pool.query('SELECT id FROM email_automations WHERE event_key = ?', [req.params.eventKey]);
  if (!existing[0]) return res.status(404).json({ error: 'Automation not found' });

  await pool.query(
    'UPDATE email_automations SET subject = ?, body = ?, enabled = ?, reminder_days_before = ? WHERE event_key = ?',
    [subject, body, b.enabled === false ? 0 : 1, b.reminderDaysBefore ? Number(b.reminderDaysBefore) : null, req.params.eventKey]
  );

  const [rows] = await pool.query('SELECT * FROM email_automations WHERE event_key = ?', [req.params.eventKey]);
  res.json({ automation: serialize(rows[0]) });
});

module.exports = router;

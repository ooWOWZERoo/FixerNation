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

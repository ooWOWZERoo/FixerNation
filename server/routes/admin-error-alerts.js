// Error spike alerts, the staff side (phase B of docs/reference/help-support-tools-requirements.md).
//
//   GET  /api/admin/error-alerts        the settings (on or off, recipients, thresholds) and the last alerts sent
//   PUT  /api/admin/error-alerts        save the settings
//   POST /api/admin/error-alerts/test   send a test alert to the saved recipients (at most one a minute)
//
// Every route is requireAuth (the admin account). The checking itself runs from cron (scripts/alert-error-spikes.js) and is off until the switch is on.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const A = require('../lib/error-alerts');
const mailer = require('../lib/mailer');

const router = express.Router();

function auditAlerts(req, action, extra = {}) {
  return audit(pool, { actorType: 'admin', actorId: req.user && req.user.userId, action, entityType: 'error_alerts', ipAddress: clientIp(req), ...extra });
}

// Update the row, or add it when there is none (portable SQL: no ON DUPLICATE KEY).
async function saveSetting(key, value) {
  const [r] = await pool.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
  if (!r.affectedRows) await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
}

function view(cfg, recent) {
  return {
    enabled: cfg.enabled, recipients: cfg.recipients, browserReports: cfg.browserReports, browsers: cfg.browsers, serverErrors: cfg.serverErrors,
    quietHours: cfg.quietHours, dailyCap: cfg.dailyCap, maxRecipients: A.MAX_RECIPIENTS, ranges: A.RANGES,
    recent: recent.map(r => ({ at: r.created_at, kind: r.kind, summary: r.summary, status: r.status })),
  };
}

async function recentAlerts() {
  const [rows] = await pool.query('SELECT kind, summary, status, created_at FROM error_alerts ORDER BY id DESC LIMIT 15');
  return rows;
}

router.get('/', requireAuth, async (req, res) => {
  res.json(view(await A.loadConfig((sql, p) => pool.query(sql, p)), await recentAlerts()));
});

router.put('/', requireAuth, async (req, res) => {
  const clean = A.cleanSettings(req.body);
  if (clean.error) return res.status(400).json({ error: clean.error });
  const before = await A.loadConfig((sql, p) => pool.query(sql, p));
  for (const [key, value] of Object.entries(clean.values)) await saveSetting(key, value);
  const after = await A.loadConfig((sql, p) => pool.query(sql, p));
  // The audit row says what changed in number only: never the addresses.
  await auditAlerts(req, 'error_alerts_settings_saved', { prevValue: { enabled: before.enabled, recipients: before.recipients.length }, newValue: { enabled: after.enabled, recipients: after.recipients.length } });
  res.json(view(after, await recentAlerts()));
});

router.post('/test', requireAuth, async (req, res) => {
  const cfg = await A.loadConfig((sql, p) => pool.query(sql, p));
  if (!cfg.recipients.length) return res.status(400).json({ error: 'Save at least one email address first.' });
  const since = new Date(Date.now() - 60 * 1000);
  const [[recent]] = await pool.query(`SELECT COUNT(*) AS n FROM error_alerts WHERE kind = 'test' AND created_at >= ?`, [since]);
  if (Number(recent.n) > 0) return res.status(429).json({ error: 'A test was just sent. Wait a minute and try again.' });
  const base = process.env.SITE_URL || '';
  let sent = 0; let failed = 0;
  for (const to of cfg.recipients) {
    try { await mailer.sendErrorAlertEmail({ to, lines: [], test: true, linkUrl: `${base}/admin-support-errors.html` }); sent++; } catch (e) { failed++; }
  }
  await pool.query(`INSERT INTO error_alerts (group_key, kind, summary, reports, browsers, status) VALUES ('', 'test', ?, 0, 0, ?)`,
    [`Test alert: ${sent} sent, ${failed} failed.`, sent ? 'sent' : 'failed']);
  await auditAlerts(req, 'error_alerts_test', { newValue: { sent, failed } });
  res.json({ ok: sent > 0, sent, failed });
});

module.exports = router;

// Alerts for error spikes (phase B of docs/reference/help-support-tools-requirements.md). Reads client_errors (error capture, Release 122) and, when a
// group of errors crosses a threshold, tells staff by email. Used by scripts/alert-error-spikes.js (cron, every 10 minutes) and
// routes/admin-error-alerts.js (the settings card and the test button).
//
// Rules that must not erode:
//  - OFF until the setting error_alerts_enabled is 'true' AND at least one recipient is set.
//  - Nothing new is collected or sent: an alert carries only what client_errors already holds (kind, page or API path, message, counts,
//    first and last time), which never has an IP, a query string, a full email address, a token or a student identifier.
//  - Staff only: recipients are addresses an admin typed; nothing is ever emailed to a customer.
//  - An alert email that fails to send is itself recorded as an email_failed error; those are NEVER alerted on again (no loop).
//  - Quiet period per group and a daily cap, so one broken page cannot fill an inbox.
//  - A group that two or more different browsers have not hit never alerts as a browser error (one person's extension is not a spike).
const crypto = require('node:crypto');

const KEYS = {
  enabled: 'error_alerts_enabled',
  recipients: 'error_alerts_recipients',
  browserReports: 'error_alerts_browser_reports',
  browsers: 'error_alerts_browsers',
  serverErrors: 'error_alerts_server_errors',
  quietHours: 'error_alerts_quiet_hours',
  dailyCap: 'error_alerts_daily_cap',
};
const DEFAULTS = { enabled: false, recipients: [], browserReports: 10, browsers: 3, serverErrors: 3, quietHours: 6, dailyCap: 5 };
const RANGES = { browserReports: [2, 1000], browsers: [2, 100], serverErrors: [1, 1000], quietHours: [1, 72], dailyCap: [1, 50] };
const MAX_RECIPIENTS = 5;
const WINDOW_MINUTES = 60;
const MAX_GROUPS_PER_EMAIL = 10;
const ALERT_SUBJECT_MARK = 'Error alert'; // failed alert emails carry this in their subject; email_failed rows with it are never counted
const BROWSER_KINDS = ['js_error', 'promise_rejection', 'failed_request'];
const GROUP_FIELDS = ['kind', 'page_path', 'api_path', 'method', 'http_status', 'message', 'source'];
const EMAIL = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[A-Za-z]{2,}$/;

// Times go to the database as Date objects (the driver writes them in the server's own timezone, the same one CURRENT_TIMESTAMP uses), never as UTC text.
function parseRecipients(value) {
  const list = (Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/)).map(s => String(s).trim().toLowerCase()).filter(Boolean);
  return [...new Set(list)];
}
function badRecipients(list) { return list.filter(a => !EMAIL.test(a) || a.length > 120); }

function clampInt(value, [lo, hi], fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
}

// `query` is a pool or a connection (both answer query() with [rows]). Missing or invalid values fall back to the defaults.
async function loadConfig(query) {
  const [rows] = await query('SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE ?', ['error_alerts_%']);
  const v = {};
  for (const r of rows) v[r.setting_key] = r.setting_value;
  const cfg = { ...DEFAULTS };
  cfg.enabled = v[KEYS.enabled] === 'true';
  cfg.recipients = parseRecipients(v[KEYS.recipients]).filter(a => EMAIL.test(a)).slice(0, MAX_RECIPIENTS);
  for (const k of Object.keys(RANGES)) cfg[k] = clampInt(v[KEYS[k]], RANGES[k], DEFAULTS[k]);
  return cfg;
}

// Checks and cleans an admin's submitted settings. Returns { error } or { values } (the strings to save, keyed by setting name).
function cleanSettings(body) {
  const b = body && typeof body === 'object' ? body : {};
  const values = {};
  if (typeof b.enabled !== 'boolean') return { error: 'Say whether alerts are on or off.' };
  values[KEYS.enabled] = b.enabled ? 'true' : 'false';
  const recipients = parseRecipients(b.recipients);
  if (recipients.length > MAX_RECIPIENTS) return { error: `Use at most ${MAX_RECIPIENTS} addresses.` };
  const bad = badRecipients(recipients);
  if (bad.length) return { error: 'One of the email addresses does not look right.' };
  if (b.enabled && !recipients.length) return { error: 'Add at least one email address before turning alerts on.' };
  values[KEYS.recipients] = recipients.join(',');
  const labels = { browserReports: 'Reports needed', browsers: 'Different browsers needed', serverErrors: 'Server errors needed', quietHours: 'Quiet hours', dailyCap: 'Daily limit' };
  for (const k of Object.keys(RANGES)) {
    const n = b[k] === undefined ? DEFAULTS[k] : Number(b[k]);
    if (!Number.isInteger(n) || n < RANGES[k][0] || n > RANGES[k][1]) return { error: `${labels[k]} must be a whole number from ${RANGES[k][0]} to ${RANGES[k][1]}.` };
    values[KEYS[k]] = String(n);
  }
  return { values };
}

function groupKey(g) {
  return crypto.createHash('sha1').update(GROUP_FIELDS.map(f => String(g[f] === undefined || g[f] === null ? '' : g[f])).join('\u0001')).digest('hex');
}

// The groups that crossed a threshold in the last hour. Counting uses each saved row's occurrences when that row's last report fell inside the window.
async function findSpikes(query, cfg, now) {
  const since = new Date(now.getTime() - WINDOW_MINUTES * 60 * 1000);
  const [groups] = await query(
    `SELECT kind, page_path, api_path, method, http_status, message, source,
            SUM(occurrences) AS total, COUNT(DISTINCT CASE WHEN client_session_id <> '' THEN client_session_id END) AS browsers,
            MIN(first_seen) AS first_seen, MAX(last_seen) AS last_seen
     FROM client_errors WHERE last_seen >= ?
     GROUP BY kind, page_path, api_path, method, http_status, message, source`, [since]);
  const spikes = [];
  for (const g of groups) {
    const total = Number(g.total) || 0;
    const browsers = Number(g.browsers) || 0;
    let why = '';
    if (BROWSER_KINDS.includes(g.kind)) {
      if (total >= cfg.browserReports && browsers >= cfg.browsers) why = `${total} reports from ${browsers} browsers in the last hour`;
    } else if (g.kind === 'server_error') {
      if (total >= cfg.serverErrors) why = `${total} server errors in the last hour`;
    } else if (g.kind === 'email_failed') {
      if (String(g.source || '').includes(`subject: ${ALERT_SUBJECT_MARK}`)) continue; // a failed alert never alerts (no loop)
      if (total >= 1) why = `${total} email${total === 1 ? '' : 's'} could not be sent in the last hour`;
    }
    if (why) spikes.push({ ...g, total, browsers, why, key: groupKey(g) });
  }
  return spikes.sort((a, b) => b.total - a.total);
}

// One line of plain text for a spike; the stored fields only.
function describe(s) {
  if (s.kind === 'email_failed') return `email_failed (${s.source || 'unknown email'}): ${s.message || 'no reason given'}. ${s.why}.`.slice(0, 400);
  const where = s.api_path ? `${s.method ? s.method + ' ' : ''}${s.api_path}${s.http_status ? ' (' + s.http_status + ')' : ''}` : (s.page_path || 'unknown page');
  const what = s.message ? `: ${s.message}` : '';
  return `${s.kind} on ${where}${what}. ${s.why}.`.slice(0, 400);
}

// The whole check. With apply false it only reports. Never throws on a send failure: the failure is returned.
//   ctx: { query, now, send({ recipients, spikes, held }) , apply, force }
async function run({ query, now = new Date(), send, apply = false, cfg: given = null }) {
  const cfg = given || await loadConfig(query);
  const out = { enabled: cfg.enabled, recipients: cfg.recipients.length, spikes: 0, quiet: 0, sent: 0, held: 0, failed: false, wouldSend: 0, skipped: '' };
  if (!cfg.enabled) { out.skipped = 'Alerts are switched off.'; return out; }
  if (!cfg.recipients.length) { out.skipped = 'No recipient addresses are set.'; return out; }
  const spikes = await findSpikes(query, cfg, now);
  out.spikes = spikes.length;
  if (!spikes.length) return out;
  const quietSince = new Date(now.getTime() - cfg.quietHours * 3600 * 1000);
  const [recent] = await query(`SELECT group_key FROM error_alerts WHERE status = 'sent' AND kind <> 'test' AND created_at >= ?`, [quietSince]);
  const quiet = new Set(recent.map(r => r.group_key));
  const fresh = spikes.filter(s => !quiet.has(s.key));
  out.quiet = spikes.length - fresh.length;
  if (!fresh.length) return out;
  const daySince = new Date(now.getTime() - 24 * 3600 * 1000);
  const [[today]] = await query(`SELECT COUNT(DISTINCT created_at) AS n FROM error_alerts WHERE status = 'sent' AND kind <> 'test' AND created_at >= ?`, [daySince]);
  if ((Number(today.n) || 0) >= cfg.dailyCap) { out.held = fresh.length; return out; }
  const batch = fresh.slice(0, MAX_GROUPS_PER_EMAIL);
  out.wouldSend = batch.length;
  if (!apply) return out;
  const stamp = now;
  try {
    await send({ recipients: cfg.recipients, spikes: batch.map(s => ({ ...s, line: describe(s) })), more: fresh.length - batch.length });
  } catch (err) {
    out.failed = true;
    await query(`INSERT INTO error_alerts (group_key, kind, summary, reports, browsers, status, created_at) VALUES (?, ?, ?, ?, ?, 'failed', ?)`,
      ['', 'batch', 'The alert email could not be sent.', batch.length, 0, stamp]);
    return out;
  }
  for (const s of batch) {
    await query(`INSERT INTO error_alerts (group_key, kind, summary, reports, browsers, status, created_at) VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
      [s.key, s.kind, describe(s).slice(0, 300), s.total, s.browsers, stamp]);
  }
  out.sent = batch.length;
  // Old rows are no use after 90 days.
  await query('DELETE FROM error_alerts WHERE created_at < ?', [new Date(now.getTime() - 90 * 24 * 3600 * 1000)]);
  return out;
}

module.exports = { KEYS, DEFAULTS, RANGES, MAX_RECIPIENTS, WINDOW_MINUTES, ALERT_SUBJECT_MARK, parseRecipients, loadConfig, cleanSettings, findSpikes, describe, run, groupKey };

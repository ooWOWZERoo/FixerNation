// Error spike alerts (phase B of docs/reference/help-support-tools-requirements.md). Off until switched on with a recipient; a page error alerts only when
// several different browsers hit it; server errors and failed emails alert on their own thresholds; one email names every new problem; a quiet period and a
// daily limit stop repeats; a failed alert email never alerts about itself; only admins reach the settings and the test button.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE client_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, page_path TEXT NOT NULL DEFAULT '', api_path TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '', http_status INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', user_kind TEXT NOT NULL DEFAULT 'visitor', site_user_id INTEGER, client_session_id TEXT NOT NULL DEFAULT '', user_agent TEXT NOT NULL DEFAULT '', occurrences INTEGER NOT NULL DEFAULT 1, first_seen TEXT DEFAULT CURRENT_TIMESTAMP, last_seen TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE error_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_key TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', reports INTEGER NOT NULL DEFAULT 0, browsers INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'sent', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
const run = async (sql, rawParams = []) => {
  const params = [];
  let i = 0;
  const s = sql.trim().replace(/\?/g, () => { const v = rawParams[i++]; params.push(v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : v); return '?'; });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};

let signedIn = true;
const sent = [];
let mailFails = false;
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => { if (!signedIn) return res.status(401).json({ error: 'Not signed in' }); req.user = { userId: 7 }; next(); } },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
  [path.join(SERVER, 'lib/mailer.js')]: { sendErrorAlertEmail: async (m) => { if (mailFails) throw new Error('smtp down'); sent.push(m); } },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const A = require(path.join(SERVER, 'lib/error-alerts.js'));
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/admin/error-alerts', require(path.join(SERVER, 'routes/admin-error-alerts.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const data = body !== null ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const NOW = new Date('2026-11-24T15:00:00Z');
const at = (minAgo) => new Date(NOW.getTime() - minAgo * 60000).toISOString().slice(0, 19).replace('T', ' ');
const reset = () => {
  for (const t of ['settings', 'school_audit_log', 'client_errors', 'error_alerts']) db.exec(`DELETE FROM ${t}`);
  sent.length = 0; mailFails = false; signedIn = true;
};
const setting = (k, v) => db.prepare('INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES (?, ?)').run(k, v);
const turnOn = (extra = {}) => { setting('error_alerts_enabled', 'true'); setting('error_alerts_recipients', 'boss@example.com'); for (const [k, v] of Object.entries(extra)) setting(k, String(v)); };
const err = (o = {}) => db.prepare(
  `INSERT INTO client_errors (kind, page_path, api_path, method, http_status, message, source, client_session_id, occurrences, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run(o.kind || 'js_error', o.page || '/lessons.html', o.api || '', o.method || '', o.status || 0, o.message || 'x is undefined', o.source || '/nav.js:12', o.session === undefined ? 'sess-aaaaaaaa' : o.session, o.n || 1, at(o.ago || 5), at(o.ago || 5));
const browsers = (count, each = 1, o = {}) => { for (let i = 0; i < count; i++) err({ ...o, session: `sess-${String(i).padStart(8, 'x')}`, n: each }); };
const runIt = (o = {}) => A.run({ query: run, now: NOW, send: async (m) => { if (mailFails) throw new Error('smtp down'); sent.push(m); }, apply: true, ...o });

test('OFF BY DEFAULT: nothing is checked or sent until the switch is on and an address is set', async () => {
  reset();
  browsers(5, 5);
  let r = await runIt();
  assert.equal(r.skipped, 'Alerts are switched off.'); assert.equal(sent.length, 0);
  setting('error_alerts_enabled', 'true');
  r = await runIt();
  assert.equal(r.skipped, 'No recipient addresses are set.'); assert.equal(sent.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM error_alerts').get().n, 0);
});

test('PAGE ERRORS: need enough reports AND enough different browsers inside the last hour; one person\'s extension never alerts', async () => {
  reset(); turnOn();
  browsers(1, 50);                                    // one browser, 50 reports
  assert.equal((await A.findSpikes(run, await A.loadConfig(run), NOW)).length, 0, 'one browser is not a spike');
  reset(); turnOn();
  browsers(3, 3);                                     // 9 reports, 3 browsers: just under 10
  assert.equal((await A.findSpikes(run, await A.loadConfig(run), NOW)).length, 0, '9 reports is under the limit');
  err({ session: 'sess-extraaaa' }); db.prepare('UPDATE client_errors SET occurrences = 2 WHERE client_session_id = ?').run('sess-extraaaa');
  const spikes = await A.findSpikes(run, await A.loadConfig(run), NOW);
  assert.equal(spikes.length, 1); assert.match(spikes[0].why, /11 reports from 4 browsers/);
  reset(); turnOn(); browsers(4, 5, { ago: 90 });     // older than an hour
  assert.equal((await A.findSpikes(run, await A.loadConfig(run), NOW)).length, 0, 'only the last hour counts');
  reset(); turnOn({ error_alerts_browser_reports: 4, error_alerts_browsers: 2 }); browsers(2, 2);
  assert.equal((await A.findSpikes(run, await A.loadConfig(run), NOW)).length, 1, 'the limits are settings');
});

test('SERVER ERRORS and FAILED EMAIL have their own thresholds; a failed ALERT email is never counted (no alert loop)', async () => {
  reset(); turnOn();
  err({ kind: 'server_error', api: '/api/classrooms/:id', method: 'GET', message: 'ER_LOCK_WAIT_TIMEOUT', session: '', n: 2 });
  assert.equal((await A.findSpikes(run, await A.loadConfig(run), NOW)).length, 0, '2 server errors is under 3');
  err({ kind: 'server_error', api: '/api/classrooms/:id', method: 'GET', message: 'ER_LOCK_WAIT_TIMEOUT', session: '', n: 1, ago: 3 });
  db.prepare("UPDATE client_errors SET source = 'x' WHERE kind = 'server_error'").run();
  let spikes = await A.findSpikes(run, await A.loadConfig(run), NOW);
  assert.equal(spikes.length, 1, 'rows with the same group fields add up'); assert.match(spikes[0].why, /3 server errors/);
  reset(); turnOn();
  err({ kind: 'email_failed', source: 'to @school.edu; subject: Reset your password — Fixer Nation', message: '550 mailbox unavailable', session: '' });
  err({ kind: 'email_failed', source: 'to @example.com; subject: Error alert: 2 problems on the site — Fixer Nation', message: 'smtp down', session: '' });
  err({ kind: 'email_failed', source: 'to @example.com; subject: Error alert test — Fixer Nation', message: 'smtp down', session: '' });
  spikes = await A.findSpikes(run, await A.loadConfig(run), NOW);
  assert.equal(spikes.length, 1, 'one failed email is enough; the failed alert emails are skipped');
  assert.match(spikes[0].source, /Reset your password/);
});

test('SENDING: one email names every new problem; a dry run sends and records nothing; the same problem stays quiet; it can come back after the quiet hours', async () => {
  reset(); turnOn();
  browsers(3, 4); err({ kind: 'email_failed', source: 'to @school.edu; subject: Welcome', message: '550', session: '' });
  let r = await runIt({ apply: false });
  assert.equal(r.spikes, 2); assert.equal(r.wouldSend, 2); assert.equal(sent.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM error_alerts').get().n, 0, 'report only records nothing');
  r = await runIt();
  assert.equal(r.sent, 2); assert.equal(sent.length, 1, 'one email for both problems');
  assert.deepEqual(sent[0].recipients, ['boss@example.com']);
  assert.equal(sent[0].spikes.length, 2); assert.ok(sent[0].spikes.every(s => s.line && !/@/.test(s.line.replace(/to @/, ''))), 'lines hold stored fields only');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM error_alerts WHERE status = 'sent'").get().n, 2);
  r = await runIt();
  assert.equal(r.quiet, 2); assert.equal(sent.length, 1, 'quiet period');
  // 7 hours later the same error alerts again (its rows are still inside a fresh hour in this scenario)
  const later = new Date(NOW.getTime() + 7 * 3600 * 1000);
  db.prepare("UPDATE client_errors SET last_seen = ?").run(later.toISOString().slice(0, 19).replace('T', ' '));
  r = await runIt({ now: later });
  assert.equal(r.sent, 2); assert.equal(sent.length, 2);
});

test('DAILY LIMIT: after the limit, new problems are held and nothing more is sent that day', async () => {
  reset(); turnOn({ error_alerts_daily_cap: 1 });
  browsers(3, 4);
  assert.equal((await runIt()).sent, 1);
  err({ kind: 'email_failed', source: 'to @school.edu; subject: Another', message: '550', session: '' });
  const r = await runIt({ now: new Date(NOW.getTime() + 60000) });
  assert.equal(r.held, 1); assert.equal(r.sent, 0); assert.equal(sent.length, 1);
});

test('A FAILED ALERT is recorded as failed (not as sent), counts for nothing, and is tried again next run', async () => {
  reset(); turnOn(); browsers(3, 4);
  mailFails = true;
  let r = await runIt();
  assert.equal(r.failed, true); assert.equal(r.sent, 0);
  assert.deepEqual(db.prepare('SELECT status FROM error_alerts').all().map(x => x.status), ['failed']);
  mailFails = false;
  r = await runIt({ now: new Date(NOW.getTime() + 60000) });
  assert.equal(r.sent, 1, 'retried and sent');
});

test('SETTINGS: what is accepted and refused', () => {
  const ok = { enabled: true, recipients: 'a@example.com, B@example.com', browserReports: 10, browsers: 3, serverErrors: 3, quietHours: 6, dailyCap: 5 };
  assert.deepEqual(A.cleanSettings(ok).values.error_alerts_recipients, 'a@example.com,b@example.com');
  assert.ok(A.cleanSettings({ ...ok, enabled: 'yes' }).error, 'a real on or off');
  assert.ok(A.cleanSettings({ ...ok, recipients: '' }).error, 'on needs a recipient');
  assert.ok(!A.cleanSettings({ ...ok, enabled: false, recipients: '' }).error, 'off needs none');
  assert.ok(A.cleanSettings({ ...ok, recipients: 'not-an-address' }).error);
  assert.ok(A.cleanSettings({ ...ok, recipients: 'a@example.com,b@example.com,c@example.com,d@example.com,e@example.com,f@example.com' }).error, 'at most 5');
  assert.ok(A.cleanSettings({ ...ok, browsers: 1 }).error, 'a spike needs at least 2 browsers');
  assert.ok(A.cleanSettings({ ...ok, dailyCap: 0 }).error);
  assert.ok(A.cleanSettings({ ...ok, quietHours: 2.5 }).error);
  assert.ok(A.cleanSettings({ ...ok, browserReports: '10; DROP' }).error);
  assert.ok(A.cleanSettings(null).error);
});

test('ROUTES: staff only; saving writes the settings and an audit row with counts (never the addresses); the test button sends to saved addresses at most once a minute', async () => {
  reset();
  signedIn = false;
  for (const [m, p] of [['GET', '/api/admin/error-alerts'], ['PUT', '/api/admin/error-alerts'], ['POST', '/api/admin/error-alerts/test']]) assert.equal((await call(m, p, m === 'GET' ? null : {})).status, 401, `${m} ${p}`);
  signedIn = true;
  const empty = await call('GET', '/api/admin/error-alerts');
  assert.equal(empty.json.enabled, false); assert.deepEqual(empty.json.recipients, []); assert.equal(empty.json.browserReports, 10);
  assert.equal((await call('POST', '/api/admin/error-alerts/test', {})).status, 400, 'no addresses saved yet');
  const bad = await call('PUT', '/api/admin/error-alerts', { enabled: true, recipients: '', browserReports: 10, browsers: 3, serverErrors: 3, quietHours: 6, dailyCap: 5 });
  assert.equal(bad.status, 400);
  const good = await call('PUT', '/api/admin/error-alerts', { enabled: true, recipients: 'owner@example.com', browserReports: 12, browsers: 4, serverErrors: 3, quietHours: 6, dailyCap: 5 });
  assert.equal(good.status, 200); assert.equal(good.json.enabled, true); assert.equal(good.json.browserReports, 12);
  const log = db.prepare("SELECT action, prev_value, new_value FROM school_audit_log WHERE entity_type = 'error_alerts'").all();
  assert.equal(log.length, 1); assert.ok(!/owner@example\.com/.test(JSON.stringify(log)), 'no address in the audit log');
  const t = await call('POST', '/api/admin/error-alerts/test', {});
  assert.equal(t.status, 200); assert.equal(t.json.sent, 1);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'owner@example.com'); assert.equal(sent[0].test, true);
  assert.equal((await call('POST', '/api/admin/error-alerts/test', {})).status, 429, 'once a minute');
  const after = await call('GET', '/api/admin/error-alerts');
  assert.equal(after.json.recent[0].kind, 'test');
  // a test row never counts toward the quiet period or the daily limit
  browsers(4, 4); // the saved limits are now 12 reports from 4 browsers
  assert.equal((await runIt()).sent, 1);
});

test('WIRING: cron line, schema, alter script, mailer subject mark, Errors page card, red banner for failed email, and only mailer.js sends', () => {
  const cron = read('server/scripts/setup-cron-jobs.sh');
  assert.match(cron, /\*\/10 \* \* \* \* \$NODE \$SCRIPTS\/alert-error-spikes\.js --apply/);
  assert.match(read('server/db/schema.sql'), /CREATE TABLE IF NOT EXISTS error_alerts/);
  assert.ok(fs.existsSync(path.join(SERVER, 'scripts/alter-create-error-alerts.js')));
  const mailer = read('server/lib/mailer.js');
  assert.ok(mailer.includes(`subject: test ? 'Error alert test' : \`Error alert:`), 'the subjects start with the mark the checker skips');
  assert.equal(A.ALERT_SUBJECT_MARK, 'Error alert');
  assert.match(mailer, /async function sendErrorAlertEmail/); assert.match(mailer, /module\.exports = \{[^}]*sendErrorAlertEmail/);
  const script = read('server/scripts/alert-error-spikes.js');
  assert.match(script, /apply/); assert.ok(!/nodemailer|sendMail\(/.test(script), 'the script sends only through lib/mailer.js');
  assert.ok(!/nodemailer|sendMail\(/.test(read('server/lib/error-alerts.js')) && !/nodemailer|sendMail\(/.test(read('server/routes/admin-error-alerts.js')));
  const page = read('admin-support-errors.html');
  assert.match(page, /\/api\/admin\/error-alerts/); assert.match(page, /id="alTest"/); assert.ok(!/innerHTML\s*=\s*[^;]*alRecent/.test(page));
  const dash = read('admin-dashboard.html');
  assert.match(dash, /id="emailFailBanner"/); assert.match(dash, /g\.kind === 'email_failed'/);
  assert.match(read('server/app.js'), /app\.use\('\/api\/admin\/error-alerts', adminErrorAlertRoutes\)/);
  const handlers = read('server/routes/admin-error-alerts.js').match(/router\.(get|put|post|delete)\(/g) || [];
  const guarded = read('server/routes/admin-error-alerts.js').match(/router\.(get|put|post|delete)\('[^']*', requireAuth,/g) || [];
  assert.equal(handlers.length, guarded.length);
});

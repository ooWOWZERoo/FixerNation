// Emailing a prospect demo invitation (docs/reference/demo-invitation-email-requirements.md, phase 1). The real routes and library run on a real SQL engine (node:sqlite),
// with the admin sign-in and the mail sender stood in. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.SESSION_SECRET = 'test-secret-for-shared-demo-email';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');
process.env.SITE_URL = 'https://example.test';

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE admin_users (id INTEGER PRIMARY KEY, username TEXT, crm_role TEXT DEFAULT 'admin');
CREATE TABLE email_automations (id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE, label TEXT, enabled INTEGER DEFAULT 1, subject TEXT, body TEXT);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, status TEXT DEFAULT 'Subscribed', crm_classification TEXT DEFAULT 'suspect', last_contacted_at TEXT);
CREATE TABLE campaign_sends (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, status TEXT);
CREATE TABLE public_demo_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, workspace_id INTEGER NOT NULL, access_code TEXT NOT NULL UNIQUE, code_version INTEGER NOT NULL DEFAULT 1,
  password TEXT NOT NULL DEFAULT '', pin TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, ended_at TEXT, end_reason TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public_demo_invitation_recipients (id INTEGER PRIMARY KEY AUTOINCREMENT, invitation_id INTEGER NOT NULL, contact_id INTEGER, email TEXT NOT NULL, result TEXT NOT NULL, error_code TEXT, sent_by TEXT NOT NULL, sent_at TEXT NOT NULL);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT,
  prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
const run = async (sql, rawParams = []) => {
  const params = [];
  let i = 0;
  const s = sql.trim().replace(/\bNOW\(\)/g, "datetime('now','localtime')").replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(', '); }
    params.push(p instanceof Date ? p.toISOString().slice(0, 19).replace('T', ' ') : p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const poolStub = { query: run, getConnection: async () => ({ query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }) };

const sent = []; // what the mail stand-in was asked to send
let failFor = new Map(); // address -> error to throw for it
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: poolStub,
  [path.join(SERVER, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (req.get('x-admin')) { req.user = { userId: 7, username: 'admin' }; return next(); } res.status(401).json({ error: 'Not logged in' }); },
    getAuthUser: () => null,
  },
  [path.join(SERVER, 'routes/site-auth.js')]: { siteLoginBlockedFor: () => 0, unlockSiteLogin: () => {} },
  [path.join(SERVER, 'lib/mailer.js')]: {
    sendAutomationEmail: async () => {},
    sendDemoInvitationEmail: async (mail) => {
      if (failFor.has(mail.to.toLowerCase())) throw failFor.get(mail.to.toLowerCase());
      sent.push(mail);
    },
  },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const inv = require(path.join(SERVER, 'lib/public-demo-invitations.js'));
const E = require(path.join(SERVER, 'lib/public-demo-email.js'));
const { demoEmailEvents } = require(path.join(SERVER, 'lib/crm-timeline.js'));
const app = express();
app.use(express.json());
app.use('/api/admin/public-demo', require(path.join(SERVER, 'routes/admin-public-demo.js')));
app.use((err, req, res, next) => { if (process.env.DEBUG_DEMO_TEST) console.error(err); res.status(500).json({ error: String(err.message) }); });
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; inv.setCacheTtl(0); });
test.after(() => server.close());

function call(method, p, { admin = true, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = method === 'GET' ? null : JSON.stringify(body || {});
    const headers = {};
    if (admin) headers['x-admin'] = '1';
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: '/api/admin/public-demo' + p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => { let json = {}; try { json = b ? JSON.parse(b) : {}; } catch { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const toDb = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const LABEL = 'Springfield USD';
const PASSWORD = 'Sw0rdfish-Secret-Pw';
const PIN = '482913';
const CODE = 'ABCD2345';
const TEMPLATE_SUBJECT = 'Your Fixer Nation Education demo';
const TEMPLATE_BODY = "Hi {{firstName}},\n\nOpen the demo: {{demoLink}}\nAccess code: {{accessCode}}\nThe demo is open until {{endDate}}.\n\nGroup: {{label}}{{groupName}}\n\nThanks,\nThe Fixer Nation Team";

function reset() {
  for (const t of ['public_demo_invitations', 'public_demo_invitation_recipients', 'newsletter_contacts', 'campaign_sends', 'email_automations', 'settings', 'admin_users', 'school_audit_log']) db.exec(`DELETE FROM ${t}`);
  db.exec('DELETE FROM sqlite_sequence');
  db.prepare("INSERT INTO admin_users (id, username, crm_role) VALUES (7, 'admin', 'admin')").run();
  db.prepare('INSERT INTO email_automations (event_key, label, enabled, subject, body) VALUES (?, ?, 1, ?, ?)').run('demo_invitation', 'Demo', TEMPLATE_SUBJECT, TEMPLATE_BODY);
  db.prepare('INSERT INTO public_demo_invitations (label, workspace_id, access_code, password, pin, status, starts_at, ends_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
    .run(LABEL, CODE, PASSWORD, PIN, 'active', toDb(new Date()), toDb(new Date(Date.now() + 7 * 86400000)));
  sent.length = 0; failFor = new Map();
}
const contact = (name, email, status = 'Subscribed') => Number(db.prepare('INSERT INTO newsletter_contacts (name, email, status) VALUES (?, ?, ?)').run(name, email, status).lastInsertRowid);
const rows = () => db.prepare('SELECT * FROM public_demo_invitation_recipients ORDER BY id').all();
const send = (extra = {}, id = 1) => call('POST', `/invitations/${id}/email`, { body: { recipients: [{ email: 'dana@school.test' }], replyTo: 'sales@fne.test', subject: TEMPLATE_SUBJECT, body: 'Hi {{firstName}}, code {{accessCode}}', ...extra } });
const addSent = (n, { email = (i) => `p${i}@x.test`, when = new Date(), invitation = 1 } = {}) => {
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO public_demo_invitation_recipients (invitation_id, email, result, sent_by, sent_at) VALUES (?, ?, 'sent', 'admin', ?)").run(invitation, email(i), toDb(when));
};

test('AUTH: both new routes need the admin, and Read-only cannot send', async () => {
  reset();
  assert.equal((await call('GET', '/invitations/1/email', { admin: false })).status, 401);
  assert.equal((await call('POST', '/invitations/1/email', { admin: false, body: {} })).status, 401);
  db.prepare("UPDATE admin_users SET crm_role = 'readonly' WHERE id = 7").run();
  const ro = await send();
  assert.equal(ro.status, 403);
  assert.equal(sent.length, 0); assert.equal(rows().length, 0);
  assert.equal((await call('GET', '/invitations/1/email')).status, 200, 'Read-only may still see who it went to');
  for (const role of ['sales', 'admin']) {
    db.prepare('UPDATE admin_users SET crm_role = ? WHERE id = 7').run(role);
    assert.equal((await send({}, 1)).status, 200, role);
  }
  assert.equal((await call('GET', '/invitations/999/email')).status, 404);
  assert.equal((await call('POST', '/invitations/999/email', { body: {} })).status, 404);
});

test('PREVIEW: the template comes back with the invitation filled in, {{firstName}} left, and the limits', async () => {
  reset();
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('contact_email_quote', 'quotes@fne.test')").run();
  const r = await call('GET', '/invitations/1/email');
  assert.equal(r.status, 200);
  assert.equal(r.json.templateReady, true); assert.equal(r.json.templateEnabled, true);
  assert.equal(r.json.replyTo, 'quotes@fne.test');
  assert.equal(r.json.subject, TEMPLATE_SUBJECT);
  assert.match(r.json.body, /Hi \{\{firstName\}\},/);
  assert.match(r.json.body, /https:\/\/example\.test\/demo-welcome\.html/);
  assert.ok(r.json.body.includes('ABCD-2345'), 'the access code, formatted');
  assert.deepEqual(r.json.limits, { perSend: 5, perInvitation: 10, perDay: 50 });
  assert.ok(!JSON.stringify(r.json).includes(PASSWORD) && !JSON.stringify(r.json).includes(PIN) && !JSON.stringify(r.json).includes(LABEL), 'no password, PIN or group name');
});

test('SEND: each person gets their own email from the typed Reply-To, with the code and link, and it is recorded', async () => {
  reset();
  const dana = contact('Dana Reyes', 'Dana@School.test');
  const r = await send({ recipients: [{ email: 'dana@school.test' }, { email: 'sam@other.test' }, { email: 'DANA@school.test' }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.sent, r.json.failed, r.json.skipped], [2, 0, 0], 'the same address twice is one email');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(m => m.to), ['dana@school.test', 'sam@other.test'], 'one email each, never two people on one email');
  for (const m of sent) {
    assert.equal(m.replyTo, 'sales@fne.test');
    assert.ok(m.body.includes('ABCD-2345'), 'the code is in the email');
    assert.ok(!m.body.includes('{{'), 'every merge field was filled in');
    for (const secret of [PASSWORD, PIN, LABEL]) assert.ok(!m.body.includes(secret) && !m.subject.includes(secret), `${secret} must not be in the email`);
  }
  assert.match(sent[0].body, /Hi Dana,/); assert.match(sent[1].body, /Hi there,/, 'a typed address with no contact is greeted as "there"');

  const got = rows();
  assert.deepEqual(got.map(g => [g.email, g.result, g.contact_id, g.sent_by, g.invitation_id]), [['dana@school.test', 'sent', dana, 'admin', 1], ['sam@other.test', 'sent', null, 'admin', 1]]);
  assert.deepEqual(Object.keys(got[0]).sort(), ['contact_id', 'email', 'error_code', 'id', 'invitation_id', 'result', 'sent_at', 'sent_by'], 'no body, code or secret is stored');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 1, 'a typed address does not create a contact');

  const c = db.prepare('SELECT crm_classification, last_contacted_at FROM newsletter_contacts WHERE id = ?').get(dana);
  assert.ok(c.last_contacted_at, 'last contacted moved');
  assert.equal(c.crm_classification, 'suspect', 'the label is never changed by an email');

  const a = db.prepare("SELECT * FROM school_audit_log WHERE action = 'public_demo.invitation_emailed'").get();
  assert.deepEqual(JSON.parse(a.new_value), { id: 1, people: 2, sent: 2, failed: 0, skipped: 0, replyTo: 'sales@fne.test' });
  for (const secret of [CODE, 'ABCD-2345', PASSWORD, PIN, 'dana@school.test', 'sam@other.test']) assert.ok(!JSON.stringify(a).includes(secret), `${secret} must not be in the audit row`);

  const list = await call('GET', '/invitations/1/email');
  assert.deepEqual(list.json.recipients.map(x => x.email), ['sam@other.test', 'dana@school.test'], 'newest first');
});

test('TEXT: staff edits are sent as typed, the template is not changed, and the group name has no merge field', async () => {
  reset();
  const r = await send({ subject: 'A quick hello', body: 'Hi {{firstName}}, your code is {{accessCode}}. {{label}}{{groupName}}{{invitationLabel}}' });
  assert.equal(r.status, 200);
  assert.equal(sent[0].subject, 'A quick hello');
  assert.equal(sent[0].body, 'Hi there, your code is ABCD-2345. ');
  assert.equal(db.prepare("SELECT body FROM email_automations WHERE event_key = 'demo_invitation'").get().body, TEMPLATE_BODY);
  // the stored template with {{label}} also never produces the name
  const pv = await call('GET', '/invitations/1/email');
  assert.ok(!pv.json.body.includes(LABEL));
});

test('REPLY-TO: one clean address or empty; anything else is refused before anything is sent', async () => {
  reset();
  for (const bad of ['a@b.test, c@d.test', 'a@b.test;c@d.test', 'a@b.test\nBcc: x@y.test', 'Name <a@b.test>', 'not an address', 'a@b', `${'x'.repeat(300)}@b.test`, 5, {}]) {
    const r = await send({ replyTo: bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.json.error, /Reply to/);
  }
  assert.equal(sent.length, 0); assert.equal(rows().length, 0);
  const none = await send({ replyTo: '' });
  assert.equal(none.status, 200); assert.equal(sent[0].replyTo, '', 'empty means no Reply-To');
  assert.equal((await send({ replyTo: undefined, recipients: [{ email: 'b@b.test' }] })).status, 200);
});

test('NOT WORKING: an ended invitation, paused demos, a switched-off or missing template, or a bad form send nothing', async () => {
  reset();
  db.prepare("UPDATE public_demo_invitations SET status = 'ended' WHERE id = 1").run();
  let r = await send(); assert.equal(r.status, 409); assert.match(r.json.error, /ended/);
  reset();
  db.prepare("UPDATE public_demo_invitations SET ends_at = ? WHERE id = 1").run(toDb(new Date(Date.now() - 60000)));
  r = await send(); assert.equal(r.status, 409, 'time ran out');
  reset();
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('public_demo_paused', 'true')").run();
  r = await send(); assert.equal(r.status, 409); assert.match(r.json.error, /paused/);
  reset();
  db.prepare("UPDATE email_automations SET enabled = 0").run();
  r = await send(); assert.equal(r.status, 409); assert.match(r.json.error, /switched off/);
  assert.equal((await call('GET', '/invitations/1/email')).json.templateEnabled, false);
  reset();
  db.prepare('DELETE FROM email_automations').run();
  r = await send(); assert.equal(r.status, 409); assert.match(r.json.error, /not been set up/);
  reset();
  for (const bad of [{ subject: '' }, { subject: 'two\nlines' }, { subject: 'x'.repeat(201) }, { body: '' }, { body: 5 }, { body: 'x'.repeat(6001) }, { recipients: [] }, { recipients: 'a@b.test' }]) {
    assert.equal((await send(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  const blank = await send({ recipients: [{}] });
  assert.equal(blank.status, 200); assert.equal(blank.json.skipped, 1, 'a person with no address is skipped, not sent');
  assert.equal(sent.length, 0); assert.equal(rows().length, 0);
});

test('SKIP: unsubscribed, bounced, refused-for-good and test addresses are skipped with a reason, and the rest still go', async () => {
  reset();
  contact('Una Sub', 'una@school.test', 'Unsubscribed');
  contact('Bo Bounce', 'bo@school.test');
  db.prepare("INSERT INTO campaign_sends (email, status) VALUES ('bo@school.test', 'sent')").run();
  db.prepare("INSERT INTO campaign_sends (email, status) VALUES ('bo@school.test', 'bounced')").run();
  contact('Okay Bounced Long Ago', 'ok@school.test');
  db.prepare("INSERT INTO campaign_sends (email, status) VALUES ('ok@school.test', 'bounced')").run();
  db.prepare("INSERT INTO campaign_sends (email, status) VALUES ('ok@school.test', 'sent')").run();
  db.prepare("INSERT INTO public_demo_invitation_recipients (invitation_id, email, result, error_code, sent_by, sent_at) VALUES (1, 'gone@school.test', 'failed', '550', 'admin', ?)").run(toDb(new Date()));
  db.prepare("INSERT INTO public_demo_invitation_recipients (invitation_id, email, result, error_code, sent_by, sent_at) VALUES (1, 'later@school.test', 'failed', '421', 'admin', ?)").run(toDb(new Date()));
  const r = await send({ recipients: ['una@school.test', 'bo@school.test', 'ok@school.test', 'gone@school.test', 'later@school.test', 'test@example.com', 'TEST@EXAMPLE.COM', 'nonsense'].map(email => ({ email })) });
  assert.equal(r.status, 400, 'eight people in one send is too many');
  const r2 = await send({ recipients: ['una@school.test', 'bo@school.test', 'ok@school.test', 'gone@school.test', 'later@school.test'].map(email => ({ email })) });
  assert.equal(r2.status, 200);
  const by = Object.fromEntries(r2.json.results.map(x => [x.email, x]));
  assert.equal(by['una@school.test'].result, 'skipped'); assert.match(by['una@school.test'].reason, /unsubscribed/);
  assert.equal(by['bo@school.test'].result, 'skipped'); assert.match(by['bo@school.test'].reason, /bounced/);
  assert.equal(by['ok@school.test'].result, 'sent', 'only the LAST campaign email counts');
  assert.equal(by['gone@school.test'].result, 'skipped'); assert.match(by['gone@school.test'].reason, /refused for good/);
  assert.equal(by['later@school.test'].result, 'sent', 'a temporary failure does not block a retry');
  assert.deepEqual(sent.map(m => m.to).sort(), ['later@school.test', 'ok@school.test']);
  const r3 = await send({ recipients: [{ email: 'test@example.com' }, { email: 'nonsense' }, { email: 'real@school.test' }] });
  assert.deepEqual(r3.json.results.map(x => [x.email, x.result]), [['test@example.com', 'skipped'], ['nonsense', 'skipped'], ['real@school.test', 'sent']]);
  assert.match(r3.json.results[0].reason, /test address/); assert.match(r3.json.results[1].reason, /email address/);
  assert.equal(rows().filter(x => x.email === 'una@school.test' || x.email === 'test@example.com').length, 0, 'a skipped address is not an attempt, so no row');
});

test('FAILURE: one refused address is recorded as failed with its code only, and the others still go', async () => {
  reset();
  failFor.set('bad@school.test', Object.assign(new Error('550 5.1.1 <bad@school.test> user unknown'), { responseCode: 550 }));
  const r = await send({ recipients: [{ email: 'bad@school.test' }, { email: 'good@school.test' }] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.sent, r.json.failed], [1, 1]);
  assert.deepEqual(r.json.results.map(x => [x.email, x.result]), [['bad@school.test', 'failed'], ['good@school.test', 'sent']]);
  const bad = rows().find(x => x.email === 'bad@school.test');
  assert.equal(bad.result, 'failed'); assert.equal(bad.error_code, '550');
  assert.ok(!JSON.stringify(rows()).includes('user unknown'), 'the server message (it can hold the address) is never stored');
  assert.ok(!r.json.results[0].reason.includes('550'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 0);
});

test('LIMITS: 5 per send, 10 per invitation, and a daily cap that looks back 24 hours', async () => {
  reset();
  const six = Array.from({ length: 6 }, (_, i) => ({ email: `s${i}@x.test` }));
  let r = await send({ recipients: six }); assert.equal(r.status, 400); assert.match(r.json.error, /up to 5/);
  assert.equal(sent.length, 0);

  addSent(9, { email: (i) => `old${i}@x.test` });
  r = await send({ recipients: [{ email: 'new1@x.test' }, { email: 'new2@x.test' }] });
  assert.equal(r.status, 400); assert.match(r.json.error, /up to 10/); assert.equal(sent.length, 0);
  r = await send({ recipients: [{ email: 'old0@x.test' }, { email: 'new1@x.test' }] });
  assert.equal(r.status, 200, 'someone already emailed does not count twice');
  addSent(1, { email: () => 'tenth@x.test' });
  assert.equal((await send({ recipients: [{ email: 'eleventh@x.test' }] })).status, 400);

  // the daily cap: other invitations count too, and rows older than 24 hours do not
  reset();
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('demo_email_daily_cap', '3')").run();
  addSent(2, { when: new Date(Date.now() - 30 * 3600000), email: (i) => `yesterday${i}@x.test` });
  addSent(2, { invitation: 2, email: (i) => `other${i}@x.test` });
  r = await send({ recipients: [{ email: 'a@x.test' }, { email: 'b@x.test' }] });
  assert.equal(r.status, 400); assert.match(r.json.error, /daily limit of 3/);
  r = await send({ recipients: [{ email: 'a@x.test' }] });
  assert.equal(r.status, 200, 'the old rows did not count, so one more fits');
  assert.equal((await call('GET', '/invitations/1/email')).json.limits.perDay, 3);
});

test('TIMELINE: a sent invitation shows for that address as "Demo invitation emailed", never the group, and a failed one does not', async () => {
  reset();
  contact('Dana Reyes', 'dana@school.test');
  failFor.set('bad@school.test', Object.assign(new Error('x'), { responseCode: 550 }));
  await send({ recipients: [{ email: 'dana@school.test' }, { email: 'bad@school.test' }] });
  const ev = await demoEmailEvents(poolStub, { kind: 'contact', id: 1, emails: ['dana@school.test'] });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].title, 'Demo invitation emailed'); assert.equal(ev[0].type, 'demo');
  assert.ok(!JSON.stringify(ev).includes(LABEL) && !JSON.stringify(ev).includes(CODE) && !JSON.stringify(ev).includes('ABCD'));
  assert.equal((await demoEmailEvents(poolStub, { kind: 'contact', id: 2, emails: ['bad@school.test'] })).length, 0, 'a failed send is not on the timeline');
  assert.equal((await demoEmailEvents(poolStub, { kind: 'opportunity', id: 3, emails: [] })).length, 0);
});

test('LIBRARY: address and Reply-To checks, and the code never touches counts or creates a mail transport', () => {
  assert.equal(E.cleanEmail(' a@b.test '), 'a@b.test');
  for (const bad of ['', 'a', 'a@b', 'a@b.test,c@d.test', 'a b@c.test', 'a@b.test\n', null, 5]) assert.equal(E.cleanEmail(bad), null, JSON.stringify(bad));
  assert.equal(E.parseReplyTo(undefined), ''); assert.equal(E.parseReplyTo('  '), ''); assert.equal(E.parseReplyTo('r@x.test'), 'r@x.test');
  assert.equal(E.isTestAddress('x@EXAMPLE.com'), true); assert.equal(E.isTestAddress('x@example.com.au'), false);
  const src = fs.readFileSync(path.join(SERVER, 'lib/public-demo-email.js'), 'utf8');
  assert.ok(!/public_demo_events|invitationCounts/.test(src), 'sending never touches the anonymous counts');
  assert.ok(!/createTransport|nodemailer/.test(src), 'only lib/mailer.js creates the transport');
  assert.ok(!/UPDATE newsletter_contacts SET crm_classification|crm_classification/.test(src), 'sending never changes the Suspect / Prospect / Customer label');
  const mailer = fs.readFileSync(path.join(SERVER, 'lib/mailer.js'), 'utf8');
  assert.match(mailer, /async function sendDemoInvitationEmail/);
  assert.match(mailer, /unsubscribeUrl\(to\)/);
});

test('SEARCH: the typeahead returns name, email and company only, and needs two characters', async () => {
  reset();
  db.exec("ALTER TABLE newsletter_contacts ADD COLUMN company TEXT");
  db.prepare("INSERT INTO newsletter_contacts (name, email, company, status) VALUES ('Dana Reyes', 'dana@school.test', 'Springfield USD', 'Unsubscribed')").run();
  assert.equal((await call('GET', '/contacts/search?q=d', {})).json.contacts.length, 0);
  assert.equal((await call('GET', '/contacts/search?q=dan', { admin: false })).status, 401);
  const r = await call('GET', '/contacts/search?q=dan');
  assert.deepEqual(Object.keys(r.json.contacts[0]).sort(), ['company', 'email', 'id', 'name']);
});

test('PAGE: the Email block uses data- attributes, escapes what came from the CRM, and calls only the demo API', () => {
  const page = fs.readFileSync(path.join(SERVER, '..', 'admin-demo.html'), 'utf8');
  for (const b of ['pick', 'unpick', 'addtyped', 'sendemail']) assert.ok(page.includes(`data-inv="${b}"`), b);
  assert.ok(page.includes('data-email="\' + esc(c.email)') && page.includes('data-name="\' + esc(c.name'), 'CRM data goes in escaped data- attributes');
  assert.ok(!/fetch\('\/api\/(?!admin\/public-demo)/.test(page), 'no other endpoint is called');
  assert.match(page, /'\/invitations\/' \+ id \+ '\/email', 'POST'/);
  const auto = fs.readFileSync(path.join(SERVER, '..', 'admin-automations.html'), 'utf8');
  assert.match(auto, /demo_invitation:\s+\['firstName','demoLink','accessCode','endDate'\]/);
  assert.ok(!/label|groupName/.test(auto.match(/demo_invitation:[^\n]*/)[0]), 'no merge field offers the group name');
});

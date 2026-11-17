// Sales CRM punch list G5 (PRD FR-RENEW-02): a district administrator asks to renew a license or change its seats; staff approve or decline; staff then quote with the usual tool.
// Matrix: docs/reference/crm-g5-repeat-order-requirements.md. Real routes and real SQL (node:sqlite); the district admin gate and the mailer are stubbed. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const c of ['school_domain TEXT', 'seat_count INTEGER', 'expiration_date TEXT']) { try { db.exec(`ALTER TABLE purchases ADD COLUMN ${c}`); } catch { /* already there */ } }
for (const c of ['first_name TEXT', 'last_name TEXT']) { try { db.exec(`ALTER TABLE site_users ADD COLUMN ${c}`); } catch { /* already there */ } }
const TABLE = `CREATE TABLE crm_repeat_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, district_id INTEGER NOT NULL, school_id INTEGER, purchase_id INTEGER NOT NULL, kind TEXT NOT NULL, current_seats INTEGER,
  requested_seats INTEGER, note TEXT, state TEXT NOT NULL DEFAULT 'waiting', open_flag INTEGER, opportunity_id INTEGER, requested_by_site_user_id INTEGER NOT NULL, decided_by_admin_id INTEGER,
  decision_note TEXT, decided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (purchase_id, open_flag))`;
db.exec(TABLE);

const mail = [];
const mailer = new Proxy({}, { get: (_, name) => async (args) => { mail.push({ name: String(name), args }); } });
const districtGate = {
  requireDistrictAdmin: (req, res, next) => {
    const raw = req.headers['x-da'];
    if (!raw) return res.status(401).json({ error: 'Not logged in' });
    const a = JSON.parse(raw);
    req.districtAdmin = { siteUserId: a.siteUserId, email: a.email, firstName: 'Dee', lastName: 'Admin', districts: a.districts, districtIds: a.districts.map(d => d.district_id) };
    next();
  },
};
env.install(pool, { [path.join(env.SERVER, 'lib/mailer.js')]: mailer, [path.join(env.SERVER, 'middleware/districtAdminAuth.js')]: districtGate });
const R = require(path.join(env.SERVER, 'lib/crm-repeat-requests.js'));
const { server } = env.listen([
  ['/api/district-admin/repeat', require(path.join(env.SERVER, 'routes/district-admin-repeat.js'))],
  ['/api/crm/repeat-requests', require(path.join(env.SERVER, 'routes/crm-repeat-requests.js'))],
  ['/api/crm/attention', require(path.join(env.SERVER, 'routes/crm-attention.js'))],
]);
test.after(() => server.close());
const port = server.address().port;
function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const h = { 'Content-Type': 'application/json', ...headers };
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ port, method, path: p, headers: h }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, json }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
const ymd = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const boss = env.addAdmin(db, 'g5boss', 'admin');
const owner = env.addAdmin(db, 'g5owner', 'sales');
const other = env.addAdmin(db, 'g5other', 'sales');
const viewer = env.addAdmin(db, 'g5viewer', 'readonly');
env.enable(db, true);

const D1 = ins("INSERT INTO districts (name) VALUES ('Riverbend District')"), D2 = ins("INSERT INTO districts (name) VALUES ('Lakeside District')"), D3 = ins("INSERT INTO districts (name) VALUES ('FNE Sales Demo District')");
const S1 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('maple.riverbend.test', ?, 'Maple Elementary')", D1);
const S2 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('oak.riverbend.test', ?, 'Oak Middle')", D1);
const S3 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('pine.lakeside.test', ?, 'Pine High')", D2);
const S4 = ins("INSERT INTO schools (domain, district_id, display_name) VALUES ('demo.example.com', ?, 'Demo School')", D3);
const U1 = ins("INSERT INTO site_users (email, first_name, last_name) VALUES ('dee@riverbend.test', 'Dee', 'Admin')"), U2 = ins("INSERT INTO site_users (email, first_name, last_name) VALUES ('lee@lakeside.test', 'Lee', 'Admin')"), U3 = ins("INSERT INTO site_users (email, first_name, last_name) VALUES ('demo@example.com', 'Demo', 'Admin')");
const as1 = { 'x-da': JSON.stringify({ siteUserId: U1, email: 'dee@riverbend.test', districts: [{ district_id: D1, district_name: 'Riverbend District' }] }) };
const as2 = { 'x-da': JSON.stringify({ siteUserId: U2, email: 'lee@lakeside.test', districts: [{ district_id: D2, district_name: 'Lakeside District' }] }) };
const asDemo = { 'x-da': JSON.stringify({ siteUserId: U3, email: 'demo@example.com', districts: [{ district_id: D3, district_name: 'FNE Sales Demo District' }] }) };
// The account for Maple belongs to the sales owner (so a deal opens for it); Oak has no account.
const A1 = ins("INSERT INTO crm_accounts (name, account_type, school_id, assigned_admin_id) VALUES ('Maple Elementary', 'school', ?, ?)", S1, owner);
const buyer = env.addContact(db, 'buyer@riverbend.test', 'Bea Buyer');
const lic = (f) => env.addPurchase(db, buyer, { amountCents: f.cents === undefined ? 50000 : f.cents, paymentStatus: f.status || 'paid', trialLessonLimit: f.trial ? 5 : undefined, trialExpirationDate: f.trial ? ymd(30) : undefined });
function license(f) {
  const id = lic(f);
  db.prepare('UPDATE purchases SET school_id = ?, school_domain = ?, seat_count = ?, expiration_date = ?, license_status = ? WHERE id = ?').run(f.school || null, f.domain || null, f.seats === undefined ? 100 : f.seats, f.ends || ymd(60), f.licStatus || 'active', id);
  return id;
}
const P1 = license({ school: S1, seats: 100 });
const P2 = license({ domain: 'oak.riverbend.test', seats: 40 });          // matched through its domain
const P3 = license({ school: S3, seats: 70 });                            // another district
const P4 = license({ school: S1, trial: true });                          // a trial
const P5 = license({ school: S1, licStatus: 'cancelled' });
const P6 = license({ school: S1, ends: ymd(-400) });                      // ended long ago
const P7 = license({ school: S4, seats: 20 });                            // the demo district
const SNAP_TABLES = ['purchases', 'invoices', 'license_seats', 'quote_requests', 'newsletter_contacts'];
const snap = () => JSON.stringify(SNAP_TABLES.map(t => { try { return all(`SELECT * FROM ${t} ORDER BY 1`); } catch { return []; } }));
const ask = (body, headers = as1) => req('POST', '/api/district-admin/repeat', { districtId: D1, ...body }, headers);
const reset = () => db.exec('DELETE FROM crm_repeat_requests; DELETE FROM crm_tasks; DELETE FROM crm_opportunities; DELETE FROM school_audit_log; DELETE FROM crm_opportunity_contacts; DELETE FROM crm_opportunity_stage_history');
const hub = (method, p, body, who = boss) => req(method, `/api/crm/repeat-requests${p}`, body, { 'x-admin': String(who) });

test('WHAT A DISTRICT ADMIN SEES: only their own district\'s paid, live group licenses, never a price; anyone else is turned away', async () => {
  const r = await req('GET', '/api/district-admin/repeat', undefined, as1);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.licenses.map(l => l.id).sort((a, b) => a - b), [P1, P2], 'not the other district, the trial, the cancelled one, the long-ended one or the demo');
  assert.equal(r.json.licenses.find(l => l.id === P2).school, 'Oak Middle', 'matched by domain when the purchase has no school id');
  assert.doesNotMatch(JSON.stringify(r.json), /amount|price|cents|@riverbend|buyer/i);
  assert.equal((await req('GET', '/api/district-admin/repeat', undefined, {})).status, 401);
  assert.equal((await req('GET', `/api/district-admin/repeat?districtId=${D2}`, undefined, as1)).status, 404, 'another district is not found, not forbidden');
  const lake = await req('GET', '/api/district-admin/repeat', undefined, as2);
  assert.deepEqual(lake.json.licenses.map(l => l.id), [P3]);
});

test('RENEW: one request, a deal for staff, an audit row and a staff email with counts only; the purchase side is untouched', async () => {
  reset(); mail.length = 0;
  const before = snap();
  const r = await ask({ purchaseId: P1, kind: 'renew', note: 'Budget closes in March' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const row = get('SELECT * FROM crm_repeat_requests WHERE id = ?', r.json.id);
  assert.equal(row.state, 'waiting'); assert.equal(row.open_flag, 1); assert.equal(row.kind, 'renew'); assert.equal(row.requested_seats, null); assert.equal(row.current_seats, 100); assert.equal(row.requested_by_site_user_id, U1);
  const deal = get('SELECT * FROM crm_opportunities WHERE id = ?', row.opportunity_id);
  assert.equal(deal.opp_type, 'renewal'); assert.equal(deal.owner_admin_id, owner); assert.equal(deal.account_id, A1); assert.equal(deal.state, 'open'); assert.equal(deal.amount_cents, null, 'no price is set');
  assert.ok(get("SELECT id FROM school_audit_log WHERE action = 'crm_repeat_requested' AND entity_id = ?", row.id));
  const m = mail.find(x => x.name === 'sendSalesAlertEmail');
  assert.ok(m && /renew/i.test(m.args.subject)); assert.deepEqual(Object.keys(m.args.fields), ['District', 'School', 'Request']);
  assert.doesNotMatch(JSON.stringify(m.args), /dee@|Dee|Bea|buyer@|Budget/, 'no person, address or note in the email');
  assert.equal(snap(), before, 'no purchase, invoice, license seat, quote or contact changed');
  assert.equal(get('SELECT COUNT(*) n FROM crm_opportunities').n, 1);
});

test('ONE WAITING PER LICENSE, CANCEL, AND ANOTHER DISTRICT: a second request is refused; cancel works for the asker\'s district only, only while waiting; then a new one is allowed', async () => {
  reset();
  const first = await ask({ purchaseId: P1, kind: 'renew' });
  assert.equal(first.status, 201);
  const dup = await ask({ purchaseId: P1, kind: 'change_seats', seats: 120 });
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'already_waiting');
  assert.equal((await req('POST', `/api/district-admin/repeat/${first.json.id}/cancel`, {}, as2)).status, 404, 'another district cannot even tell it exists');
  assert.equal((await req('POST', `/api/district-admin/repeat/${first.json.id}/cancel`, {}, {})).status, 401);
  assert.equal((await req('POST', `/api/district-admin/repeat/${first.json.id}/cancel`, {}, as1)).status, 200);
  assert.equal(get('SELECT open_flag, state FROM crm_repeat_requests WHERE id = ?', first.json.id).open_flag, null);
  assert.equal((await req('POST', `/api/district-admin/repeat/${first.json.id}/cancel`, {}, as1)).status, 409, 'not waiting any more');
  const again = await ask({ purchaseId: P1, kind: 'change_seats', seats: 120 });
  assert.equal(again.status, 201, 'a finished request does not block a new one');
  // Another district's license cannot be asked about at all.
  assert.equal((await ask({ purchaseId: P3, kind: 'renew' })).status, 404);
  assert.equal((await req('POST', '/api/district-admin/repeat', { districtId: D2, purchaseId: P1, kind: 'renew' }, as1)).status, 404, 'a district the admin does not run');
  assert.equal((await req('POST', '/api/district-admin/repeat', { districtId: D1, purchaseId: P4, kind: 'renew' }, as1)).status, 404, 'a trial is not a license to renew');
});

test('SEATS: a whole number from 1 to 100,000 that differs from today\'s; more seats opens an expansion deal, fewer a renewal; a school with no account still gets its request', async () => {
  reset();
  for (const bad of [{ seats: 0 }, { seats: -5 }, { seats: 1.5 }, { seats: '12abc' }, { seats: 100001 }, { seats: {} }, { seats: [] }, { seats: true }, {}, { seats: 100 }]) {
    const r = await ask({ purchaseId: P1, kind: 'change_seats', ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.ok(r.json.error && !/Error:|\bat \w+\.js/.test(r.json.error), 'a plain message, no stack');
  }
  assert.equal((await ask({ purchaseId: P1, kind: 'bogus' })).status, 400);
  assert.equal((await ask({ purchaseId: P1, kind: 'renew', note: { x: 1 } })).status, 400);
  assert.equal(get('SELECT COUNT(*) n FROM crm_repeat_requests').n, 0, 'nothing refused was saved');
  const up = await ask({ purchaseId: P1, kind: 'change_seats', seats: '150' });
  assert.equal(up.status, 201);
  const upRow = get('SELECT * FROM crm_repeat_requests WHERE id = ?', up.json.id);
  assert.equal(upRow.requested_seats, 150); assert.equal(get('SELECT opp_type FROM crm_opportunities WHERE id = ?', upRow.opportunity_id).opp_type, 'expansion');
  await req('POST', `/api/district-admin/repeat/${up.json.id}/cancel`, {}, as1);
  const down = await ask({ purchaseId: P1, kind: 'change_seats', seats: 60 });
  assert.equal(get('SELECT opp_type FROM crm_opportunities WHERE id = ?', get('SELECT opportunity_id o FROM crm_repeat_requests WHERE id = ?', down.json.id).o).opp_type, 'renewal');
  assert.equal(get("SELECT COUNT(*) n FROM crm_opportunities WHERE state = 'open' AND opp_type = 'expansion'").n, 1, 'the open expansion deal is reused, not doubled, if asked again');
  const oak = await ask({ purchaseId: P2, kind: 'renew' });
  assert.equal(oak.status, 201); assert.equal(get('SELECT opportunity_id o FROM crm_repeat_requests WHERE id = ?', oak.json.id).o, null, 'Oak has no CRM account, so no deal; the request and the alert still exist');
});

test('DEMO: the sales-demo district cannot send a request', async () => {
  reset();
  const r = await req('POST', '/api/district-admin/repeat', { districtId: D3, purchaseId: P7, kind: 'renew' }, asDemo);
  assert.equal(r.status, 403); assert.equal(get('SELECT COUNT(*) n FROM crm_repeat_requests').n, 0);
});

test('STAFF LIST: every CRM role can read it; Read-only gets no asker name; nobody signed in gets nothing; the state filter works', async () => {
  reset();
  await ask({ purchaseId: P1, kind: 'renew' });
  const a = await hub('GET', '', undefined, boss), v = await hub('GET', '', undefined, viewer);
  assert.equal(a.status, 200); assert.equal(a.json.requests.length, 1); assert.equal(a.json.requests[0].askedBy, 'Dee Admin'); assert.equal(a.json.requests[0].schoolName, 'Maple Elementary');
  assert.equal(v.json.requests[0].askedBy, null);
  assert.equal((await req('GET', '/api/crm/repeat-requests', undefined, {})).status, 401);
  assert.equal((await hub('GET', '?state=approved')).json.requests.length, 0);
  assert.equal((await hub('GET', '?state=all')).json.requests.length, 1);
});

test('WHO CAN DECIDE: a CRM Admin, or the Sales user who owns the request\'s deal; not another rep, not Read-only; a deal nobody owns is for a CRM Admin', async () => {
  reset();
  const q = (await ask({ purchaseId: P1, kind: 'change_seats', seats: 130 })).json.id;
  assert.equal((await hub('POST', `/${q}/approve`, {}, viewer)).status, 403);
  assert.equal((await hub('POST', `/${q}/approve`, {}, other)).status, 403);
  assert.equal((await req('POST', `/api/crm/repeat-requests/${q}/approve`, {}, {})).status, 401);
  assert.equal(get('SELECT state FROM crm_repeat_requests WHERE id = ?', q).state, 'waiting', 'a refused attempt changes nothing');
  db.prepare('UPDATE crm_opportunities SET owner_admin_id = NULL').run();
  assert.equal((await hub('POST', `/${q}/approve`, {}, owner)).status, 403, 'a deal nobody owns is for a CRM Admin');
  db.prepare('UPDATE crm_opportunities SET owner_admin_id = ?').run(owner);
  const before = snap();
  mail.length = 0;
  const ok = await hub('POST', `/${q}/approve`, { note: 'looks right' }, owner);
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.state, 'approved');
  const row = get('SELECT * FROM crm_repeat_requests WHERE id = ?', q);
  assert.equal(row.state, 'approved'); assert.equal(row.open_flag, null); assert.equal(row.decided_by_admin_id, owner);
  const task = get('SELECT * FROM crm_tasks WHERE id = ?', ok.json.taskId);
  assert.match(task.title, /Draft and send the quote: change to 130 seats/); assert.equal(task.assigned_admin_id, owner); assert.equal(task.opportunity_id, row.opportunity_id); assert.match(task.details, /Nothing has been priced or sent/);
  assert.equal(snap(), before, 'approving never touches a purchase, invoice, seat or quote');
  assert.equal(all('SELECT * FROM quote_requests').length, 0, 'and it does not make a quote');
  assert.equal(mail.filter(m => m.name === 'sendRepeatRequestDeclinedEmail').length, 0);
  assert.equal((await hub('POST', `/${q}/approve`, {}, boss)).status, 409, 'a second decision is refused');
  assert.equal((await hub('POST', `/${q}/decline`, { note: 'no' }, boss)).status, 409);
  assert.equal(all("SELECT * FROM crm_tasks WHERE title LIKE 'Draft and send%'").length, 1, 'a repeated approve makes one task');
  assert.ok(get("SELECT id FROM school_audit_log WHERE action = 'crm_repeat_approved' AND entity_id = ?", q));
});

test('DECLINE: needs a note; the person who asked is emailed that note; the portal shows it; a cancelled request cannot be decided', async () => {
  reset(); mail.length = 0;
  const q = (await ask({ purchaseId: P1, kind: 'renew' })).json.id;
  assert.equal((await hub('POST', `/${q}/decline`, {}, boss)).status, 400);
  assert.equal((await hub('POST', `/${q}/decline`, { note: '   ' }, boss)).status, 400);
  assert.equal(get('SELECT state FROM crm_repeat_requests WHERE id = ?', q).state, 'waiting');
  const r = await hub('POST', `/${q}/decline`, { note: 'We need to talk about the term first.' }, boss);
  assert.equal(r.status, 200); assert.equal(r.json.state, 'declined');
  const m = mail.find(x => x.name === 'sendRepeatRequestDeclinedEmail');
  assert.ok(m); assert.equal(m.args.to, 'dee@riverbend.test'); assert.equal(m.args.note, 'We need to talk about the term first.'); assert.equal(m.args.districtName, 'Riverbend District');
  const view = await req('GET', '/api/district-admin/repeat', undefined, as1);
  const mine = view.json.requests.find(x => x.id === q);
  assert.equal(mine.state, 'declined'); assert.equal(mine.declinedBecause, 'We need to talk about the term first.');
  assert.equal(get('SELECT COUNT(*) n FROM crm_tasks').n, 0, 'declining makes no task');
  const c = (await ask({ purchaseId: P1, kind: 'renew' })).json.id;
  await req('POST', `/api/district-admin/repeat/${c}/cancel`, {}, as1);
  assert.equal((await hub('POST', `/${c}/approve`, {}, boss)).status, 409);
  assert.equal((await hub('POST', '/99999/approve', {}, boss)).status, 404);
});

test('NEEDS ATTENTION: a waiting request is one item, with a plain reason; a decided one is gone; a long wait is marked', async () => {
  reset();
  const q = (await ask({ purchaseId: P1, kind: 'renew' })).json.id;
  const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));
  let items = (await A.evaluate(pool, { today: ymd(0) })).filter(i => i.ruleKey === 'repeat_request');
  assert.equal(items.length, 1); assert.equal(items[0].fingerprint, String(q)); assert.equal(items[0].link, 'admin-crm-repeat-requests.html'); assert.equal(items[0].ownerAdminId, owner);
  assert.match(items[0].why, /Nothing has been bought, priced or sent/); assert.doesNotMatch(items[0].why, /waiting too long/);
  items = (await A.evaluate(pool, { today: ymd(70) })).filter(i => i.ruleKey === 'repeat_request');
  assert.match(items[0].why, /waiting too long/);
  assert.equal(items[0].ruleKey in A.RULES, true);
  await hub('POST', `/${q}/decline`, { note: 'x' }, boss);
  assert.equal((await A.evaluate(pool, { today: ymd(0) })).filter(i => i.ruleKey === 'repeat_request').length, 0);
});

test('SAFE: before the alter script has run, both sides say it is not available yet instead of failing', async () => {
  reset();
  db.exec('DROP TABLE crm_repeat_requests');
  const a = await req('GET', '/api/district-admin/repeat', undefined, as1);
  assert.equal(a.status, 503); assert.equal(a.json.code, 'not_available');
  assert.equal((await ask({ purchaseId: P1, kind: 'renew' })).status, 503);
  assert.equal((await hub('GET', '')).status, 503);
  db.exec(TABLE);
});

test('FILES AND RULES: the pages escape what comes from outside, the nav and versions are in step, the alter script and schema match, nothing writes a purchase', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
  const src = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const lib = src('lib/crm-repeat-requests.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(lib, /INSERT INTO (purchases|invoices|license_seats|quote_requests)|UPDATE (purchases|invoices|license_seats|quote_requests|newsletter_contacts) SET|DELETE FROM (purchases|invoices|license_seats)/i);
  assert.doesNotMatch(lib, /mailer|sendMail|amount_cents\s*=/i, 'the library never mails or sets a price (the routes mail, through lib/mailer.js)');
  for (const f of ['district-admin-renew.html', 'admin-crm-repeat-requests.html']) {
    const html = read(f);
    assert.match(html, /esc\(/); assert.doesNotMatch(html, /innerHTML\s*=\s*[^;]*\.note\b(?![^;]*esc\()/);
    assert.match(html, /name="robots" content="noindex"/); assert.doesNotMatch(html, /fonts\.googleapis|cdn\./i);
  }
  assert.match(read('district-admin-renew.html'), /esc\(r\.note\)/); assert.match(read('admin-crm-repeat-requests.html'), /esc\(q\.note\)/);
  assert.match(read('admin-crm-repeat-requests.html'), /admin-nav\.js\?v=37/); assert.match(read('admin-crm-repeat-requests.html'), /admin-shell\.js\?v=10/);
  assert.match(read('admin-nav.js'), /admin-crm-repeat-requests\.html/); assert.match(read('admin-nav.js'), /"crm-repeat-requests": "</);
  assert.match(read('admin-shell.js'), /'crm-repeat-requests':/);
  assert.match(read('district-admin-nav.js'), /district-admin-renew\.html/);
  for (const f of ['district-admin-dashboard.html', 'district-admin-renew.html']) assert.match(read(f), /district-admin-nav\.js\?v=15/);
  const schema = src('db/schema.sql'), alter = src('scripts/alter-create-crm-repeat-requests.js');
  for (const s of [schema, alter]) { assert.match(s, /CREATE TABLE IF NOT EXISTS crm_repeat_requests/); assert.match(s, /UNIQUE KEY uq_crm_repeat_open \(purchase_id, open_flag\)/); }
  assert.match(alter, /already exists/); assert.match(alter, /information_schema\.TABLES/);
  const app = src('app.js');
  assert.ok(app.indexOf("'/api/district-admin/repeat'") < app.indexOf("app.use('/api/district-admin', districtAdminRoutes)"), 'mounted before the general district-admin router');
  assert.match(app, /\/api\/crm\/repeat-requests/);
  const perms = src('lib/crm-permissions.js'); assert.match(perms, /decide_repeat: \['admin', 'sales'\]/);
  for (const f of ['lib/crm-repeat-requests.js', 'routes/crm-repeat-requests.js', 'routes/district-admin-repeat.js', 'scripts/alter-create-crm-repeat-requests.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});

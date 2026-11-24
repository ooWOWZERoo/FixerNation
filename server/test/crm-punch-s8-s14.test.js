// Sales CRM punch list S8 to S14 (docs/reference/sales-crm-punch-list.md, section A). S15, the signer change and the stored acceptance text have their tests in
// quote-billing-hardening.test.js, next to the money code they cover. Real routes and real SQL (node:sqlite) from test/helpers/crm-env.js. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec('ALTER TABLE quote_requests ADD COLUMN acceptance_document_snapshot TEXT');
for (const col of ['first_name TEXT', 'last_name TEXT', 'role TEXT', 'is_fne_staff INTEGER']) db.exec(`ALTER TABLE site_users ADD COLUMN ${col}`);
db.prepare('INSERT INTO quote_content_profiles (id, is_default) VALUES (1, 1)').run();
db.exec('CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER, kind TEXT, detail TEXT, invitation_id INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
// The shared pool wrapper cannot run MySQL's ON DUPLICATE KEY; the quote forms use it, so translate it the way the other route tests do.
const baseQuery = pool.query;
pool.query = (sql, params) => {
  let s = String(sql);
  if (/ON DUPLICATE KEY UPDATE/i.test(s)) s = s.replace(/ON DUPLICATE KEY UPDATE[\s\S]*$/i, '').replace(/^\s*INSERT INTO/i, 'INSERT OR IGNORE INTO');
  return baseQuery(s, params);
};
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-s12-'));
process.env.CRM_FILES_DIR = FILES;
env.install(pool);

const R = (f) => require(path.join(env.SERVER, f));
const { server, call } = env.listen([
  ['/api/contact', R('routes/contact.js')], ['/api/newsletter', R('routes/newsletter.js').router], ['/api/crm/contacts', R('routes/crm-contacts.js')],
  ['/api/crm/opportunities', R('routes/crm-opportunities.js')], ['/api/crm/meetings', R('routes/crm-meetings.js')], ['/api/crm/audit', R('routes/crm-audit.js')],
]);
test.after(() => { server.close(); fs.rmSync(FILES, { recursive: true, force: true }); });
env.enable(db, true);

const admin = env.addAdmin(db, 'owner', 'admin');
const sales = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const statusOf = (email) => (get('SELECT status FROM newsletter_contacts WHERE LOWER(email) = LOWER(?)', email) || {}).status;

// ---- S8 ------------------------------------------------------------------------------------------------------------------------------
test('S8: a quote request does not subscribe a NEW person to the newsletter, public form or staff-made; a person already on file keeps their status', async () => {
  const pub = await call('POST', '/api/contact/quote', { firstName: 'Pat', lastName: 'Visitor', email: 'someone-elses-address@school.test', school: 'Riverbend', phone: '555', message: 'Hi' });
  assert.ok(pub.status < 300, JSON.stringify(pub.json));
  assert.equal(statusOf('someone-elses-address@school.test'), 'Unsubscribed');
  const staff = await call('POST', '/api/contact/quotes', { firstName: 'Sam', lastName: 'Outreach', email: 'cold-lead@school.test', school: 'Elm' }, sales);
  assert.ok(staff.status < 300, JSON.stringify(staff.json));
  assert.equal(statusOf('cold-lead@school.test'), 'Unsubscribed');
  env.addContact(db, 'already-subscribed@school.test', 'Already');
  env.addContact(db, 'already-out@school.test', 'Out', { status: 'Unsubscribed' });
  await call('POST', '/api/contact/quote', { firstName: 'A', lastName: 'B', email: 'already-subscribed@school.test', school: 'X', phone: '1', message: 'Hi' });
  await call('POST', '/api/contact/quote', { firstName: 'A', lastName: 'B', email: 'already-out@school.test', school: 'X', phone: '1', message: 'Hi' });
  assert.equal(statusOf('already-subscribed@school.test'), 'Subscribed', 'never changed');
  assert.equal(statusOf('already-out@school.test'), 'Unsubscribed', 'an opt-out is never turned back on by a quote request');
});

// ---- S9 ------------------------------------------------------------------------------------------------------------------------------
test('S9: the private CRM folder is refused under every spelling, judged after decoding, and the check runs before express.static', async () => {
  const F = R('lib/crm-files.js');
  for (const p of ['/crm-private/x.bin', '/%63rm-private/x.bin', '/CRM-Private/x.bin', '/crm-private%2Fx.bin', '/a/../crm-private/x.bin', '//crm-private/x.bin', '/%2e%2e/crm-private/x', '/crm-private', '/%63rm%2dprivate/x', '/crm-private/../crm-private/x', '/%zz', '/crm%00-private/x']) {
    assert.equal(F.isPrivatePath(p), true, `${p} is private`);
  }
  for (const p of ['/logo.png', '/crm-privateer/x', '/branding/crm-private.png', '/', '/a/b/c.webp']) assert.equal(F.isPrivatePath(p), false, `${p} is public`);
  // The real middleware pair from app.js in front of real express.static, over HTTP, with a file in the private folder.
  const express = require('express');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-s9-'));
  fs.mkdirSync(path.join(root, 'crm-private')); fs.writeFileSync(path.join(root, 'crm-private', 'secret.bin'), 'SECRET'); fs.writeFileSync(path.join(root, 'ok.txt'), 'fine');
  const app = express();
  const appSrc = fs.readFileSync(path.join(env.SERVER, 'app.js'), 'utf8');
  const line = appSrc.split('\n').find(l => l.includes('isPrivatePath'));
  assert.ok(line && /app\.use\('\/uploads', \(req, res, next\)/.test(line), 'app.js has the decoded-path check');
  assert.ok(appSrc.indexOf('isPrivatePath') < appSrc.indexOf("app.use('/uploads', express.static"), 'and it comes before express.static');
  app.use('/uploads', (req, res, next) => (F.isPrivatePath(req.path) ? res.status(404).type('text/plain').send('Not found') : next()));
  app.use('/uploads', express.static(root));
  const srv = app.listen(0);
  const hit = (p) => new Promise((resolve) => require('node:http').get({ port: srv.address().port, path: p }, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ status: r.statusCode, body: b })); }));
  try {
    assert.equal((await hit('/uploads/ok.txt')).body, 'fine');
    for (const p of ['/uploads/crm-private/secret.bin', '/uploads/%63rm-private/secret.bin', '/uploads/CRM-PRIVATE/secret.bin', '/uploads/crm-private%2fsecret.bin', '/uploads/x/../crm-private/secret.bin']) {
      const r = await hit(p);
      assert.notEqual(r.body, 'SECRET', `${p} must not serve the file`);
      assert.equal(r.status, 404, p);
    }
  } finally { srv.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- S10 and S13 ---------------------------------------------------------------------------------------------------------------------
const acct = Number(db.prepare("INSERT INTO crm_accounts (name) VALUES ('S10 District')").run().lastInsertRowid);
const stage = (k) => get('SELECT id FROM crm_pipeline_stages WHERE stage_key = ?', k).id;
const deal = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, state) VALUES (?, 'S10 deal', ?, ?, 'open')").run(acct, stage('qualified'), sales).lastInsertRowid);
const { snapshot, sha256 } = R('lib/quote-evidence.js');
function acceptedQuote({ withSnapshot = true, tamper = false, accepted = true } = {}) {
  const id = env.addQuote(db, 'signer@school.test', { opportunityId: deal, number: `S10-${Math.random().toString(36).slice(2, 7)}`, amountCents: 50000, status: 'converted' });
  const row = get('SELECT * FROM quote_requests WHERE id = ?', id);
  const text = snapshot({ ...row, quote_number: row.quote_number }, null, '1');
  db.prepare(`UPDATE quote_requests SET accepted_at = ?, acceptance_name = 'Dana Whitaker', acceptance_title = 'Principal', acceptance_recorded_at = '2026-11-01 10:00:00', acceptance_recorded_by = 'buyer',
    acceptance_terms_version = '1', acceptance_document_hash = ?, acceptance_document_snapshot = ? WHERE id = ?`).run(accepted ? '2026-11-01 10:00:00' : null, sha256(text), withSnapshot ? (tamper ? text.replace('50000', '40000') : text) : null, id);
  return id;
}

test('S10: the full acceptance record is for a CRM Admin only, is audited every time it is opened, and says whether the stored text still matches its hash', async () => {
  const q = acceptedQuote();
  const url = `/api/crm/opportunities/${deal}/quotes/${q}/evidence`;
  assert.equal((await call('GET', url, undefined, sales)).status, 403);
  assert.equal((await call('GET', url, undefined, viewer)).status, 403);
  assert.equal((await call('GET', url)).status, 401);
  assert.equal(all("SELECT id FROM school_audit_log WHERE action = 'crm_quote_evidence_viewed'").length, 0, 'a refused look is not a look');
  const r = await call('GET', url, undefined, admin);
  assert.equal(r.status, 200);
  assert.equal(r.json.signerName, 'Dana Whitaker'); assert.equal(r.json.snapshot.amountCents, 50000); assert.equal(r.json.hashMatches, true);
  await call('GET', url, undefined, admin);
  const rows = all("SELECT * FROM school_audit_log WHERE action = 'crm_quote_evidence_viewed' AND entity_id = ?", deal);
  assert.equal(rows.length, 2, 'each look writes a row');
  assert.equal(JSON.parse(rows[0].new_value).quoteId, q);
  assert.ok(rows[0].actor_id === admin);
});

test('S10: a stored text that was changed after the fact shows as NOT matching; an older acceptance with no text says so; an unaccepted quote has no record', async () => {
  const bad = await call('GET', `/api/crm/opportunities/${deal}/quotes/${acceptedQuote({ tamper: true })}/evidence`, undefined, admin);
  assert.equal(bad.json.hashMatches, false);
  const old = await call('GET', `/api/crm/opportunities/${deal}/quotes/${acceptedQuote({ withSnapshot: false })}/evidence`, undefined, admin);
  assert.equal(old.json.snapshot, null); assert.equal(old.json.hashMatches, null); assert.match(old.json.documentHash, /^[0-9a-f]{64}$/);
  assert.equal((await call('GET', `/api/crm/opportunities/${deal}/quotes/${acceptedQuote({ accepted: false })}/evidence`, undefined, admin)).status, 404);
  assert.equal((await call('GET', `/api/crm/opportunities/${deal}/quotes/9999/evidence`, undefined, admin)).status, 404);
  const elsewhere = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state) VALUES (?, 'other', ?, 'open')").run(acct, stage('qualified')).lastInsertRowid);
  assert.equal((await call('GET', `/api/crm/opportunities/${elsewhere}/quotes/${acceptedQuote()}/evidence`, undefined, admin)).status, 404, 'a quote on another deal is not reachable through this one');
});

test('S13: the deal page shows "accepted by" only once the quote is accepted, not when a name was merely typed before a card payment', async () => {
  const unpaid = acceptedQuote({ accepted: false });
  const paid = acceptedQuote();
  const r = await call('GET', `/api/crm/opportunities/${deal}`, undefined, sales);
  const by = Object.fromEntries(r.json.quotes.map(q => [q.id, q.acceptance]));
  assert.equal(by[unpaid], null, 'no acceptance shown for an unpaid quote');
  assert.equal(by[paid].name, 'Dana Whitaker');
});

test('S10: the acceptance-snapshot alter script adds one column and does nothing the second time', async () => {
  const alter = R('scripts/alter-add-quote-acceptance-snapshot.js');
  const have = new Set();
  const fake = { alters: [], async query(sql, params = []) {
    if (/information_schema\.COLUMNS/.test(sql)) return [have.has(params[2]) ? [{ 1: 1 }] : []];
    this.alters.push(sql); have.add(/ADD COLUMN (\w+)/.exec(sql)[1]); return [{}];
  } };
  assert.deepEqual((await alter.ensure(fake, 'db', () => {})).added, ['acceptance_document_snapshot']);
  const again = await alter.ensure(fake, 'db', () => {});
  assert.deepEqual(again.added, []); assert.equal(fake.alters.length, 1);
  assert.match(fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8'), /acceptance_document_snapshot MEDIUMTEXT NULL/);
});

// ---- S11 -----------------------------------------------------------------------------------------------------------------------------
test('S11: the audit log is CRM Admin only, shows the Customer Hub rows newest first, filters by what, who, which record and dates, and pages', async () => {
  db.exec('DELETE FROM school_audit_log');
  const put = (action, entityType, entityId, at, f = {}) => db.prepare(`INSERT INTO school_audit_log (actor_type, actor_id, actor_email, action, entity_type, entity_id, prev_value, new_value, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(f.actorType || 'admin_user', f.actorId === undefined ? admin : f.actorId, f.email || null, action, entityType, entityId, f.prev || null, f.next || null, f.reason || null, at);
  put('crm_opportunity_created', 'crm_opportunity', 7, '2026-11-01 09:00:00', { next: '{"name":"A deal"}' });
  put('crm_opportunity_updated', 'crm_opportunity', 7, '2026-11-02 09:00:00', { prev: '{"source":"Web"}', next: '{"source":"Referral"}', reason: 'fixed the source' });
  put('crm_file_deleted', 'crm_file', 3, '2026-11-03 09:00:00', { actorId: sales });
  put('crm_opportunity_more_quotes_accepted', 'crm_opportunity', 8, '2026-11-04 09:00:00', { actorType: 'system', actorId: null });
  put('quote_accepted_by_admin', 'quote_request', 5, '2026-11-05 09:00:00');           // not a CRM row: left out
  put('school_login', 'school', 2, '2026-11-05 10:00:00');                              // not a CRM row: left out
  put('crm_staff_role_changed', null, null, '2026-11-06 09:00:00');                     // CRM by its action name even with no entity type
  assert.equal((await call('GET', '/api/crm/audit', undefined, sales)).status, 403);
  assert.equal((await call('GET', '/api/crm/audit', undefined, viewer)).status, 403);
  assert.equal((await call('GET', '/api/crm/audit')).status, 401);
  const r = await call('GET', '/api/crm/audit', undefined, admin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.entries.map(e => e.action), ['crm_staff_role_changed', 'crm_opportunity_more_quotes_accepted', 'crm_file_deleted', 'crm_opportunity_updated', 'crm_opportunity_created']);
  assert.equal(r.json.total, 5);
  const upd = r.json.entries.find(e => e.action === 'crm_opportunity_updated');
  assert.deepEqual(upd.before, { source: 'Web' }); assert.deepEqual(upd.after, { source: 'Referral' }); assert.equal(upd.reason, 'fixed the source'); assert.equal(upd.actor, 'owner');
  assert.equal(r.json.entries.find(e => e.action === 'crm_opportunity_more_quotes_accepted').actor, 'The system');
  const q = (s) => call('GET', `/api/crm/audit?${s}`, undefined, admin).then(x => x.json.entries.map(e => e.action));
  assert.deepEqual(await q('action=crm_file_deleted'), ['crm_file_deleted']);
  assert.deepEqual(await q('entityType=crm_opportunity&entityId=7'), ['crm_opportunity_updated', 'crm_opportunity_created']);
  assert.deepEqual(await q('actor=rep'), ['crm_file_deleted']);
  assert.deepEqual(await q('from=2026-11-02&to=2026-11-03'), ['crm_file_deleted', 'crm_opportunity_updated']);
  assert.equal((await call('GET', '/api/crm/audit?from=nope', undefined, admin)).status, 400);
  const p1 = await call('GET', '/api/crm/audit?pageSize=2&page=1', undefined, admin), p3 = await call('GET', '/api/crm/audit?pageSize=2&page=3', undefined, admin);
  assert.equal(p1.json.entries.length, 2); assert.equal(p3.json.entries.length, 1); assert.equal(p3.json.total, 5);
  const acts = await call('GET', '/api/crm/audit/actions', undefined, admin);
  assert.deepEqual(acts.json.actions, ['crm_file_deleted', 'crm_opportunity_created', 'crm_opportunity_more_quotes_accepted', 'crm_opportunity_updated', 'crm_staff_role_changed']);
  assert.equal(all("SELECT id FROM school_audit_log WHERE action LIKE '%audit%'").length, 0, 'opening the log is not itself logged');
  env.enable(db, false);
  assert.equal((await call('GET', '/api/crm/audit', undefined, admin)).status, 404, 'a 404 while the Hub is off');
  env.enable(db, true);
});

test('S11: the page is for noindex admin use, loads the shared assets, escapes what it shows, and is linked from Hub Settings; app.js mounts the route', () => {
  const root = path.join(env.SERVER, '..');
  const html = fs.readFileSync(path.join(root, 'admin-crm-audit.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /admin-nav\.js\?v=41/); assert.match(html, /admin-common\.js\?v=18/); assert.match(html, /crm-common\.js\?v=3/); assert.match(html, /admin-shell\.js\?v=13/);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\.|unpkg|jsdelivr|cdnjs/i);
  assert.doesNotMatch(html.replace('onclick="fnToggleTheme()"', ''), /onclick=|onerror=/);
  assert.match(html, /esc\(e\.action\)/); assert.match(html, /esc\(pretty\(e\.before\)\)/);
  assert.match(fs.readFileSync(path.join(root, 'admin-crm-settings.html'), 'utf8'), /href="admin-crm-audit\.html"/);
  assert.match(fs.readFileSync(path.join(env.SERVER, 'app.js'), 'utf8'), /app\.use\('\/api\/crm\/audit', crmAuditRoutes\)/);
});

// ---- S12 -----------------------------------------------------------------------------------------------------------------------------
test('S12: a meeting that was sent and is still on calendars must be cancelled before it can be deleted; then only a CRM Admin deletes it, and it is audited', async () => {
  const mk = (status, sent) => Number(db.prepare("INSERT INTO crm_appointments (opportunity_id, title, starts_at, ends_at, status, uid, invite_sent_at) VALUES (?, 'Demo', '2026-12-01 10:00:00', '2026-12-01 11:00:00', ?, ?, ?)")
    .run(deal, status, Math.random().toString(36).slice(2), sent).lastInsertRowid);
  const live = mk('scheduled', '2026-11-10 10:00:00'), cancelled = mk('cancelled', '2026-11-10 10:00:00'), draft = mk('scheduled', null);
  assert.equal((await call('DELETE', `/api/crm/meetings/${draft}`, {}, sales)).status, 403);
  assert.equal((await call('DELETE', `/api/crm/meetings/${draft}`, {}, viewer)).status, 403);
  const refused = await call('DELETE', `/api/crm/meetings/${live}`, {}, admin);
  assert.equal(refused.status, 409); assert.equal(refused.json.code, 'cancel_first');
  assert.ok(get('SELECT id FROM crm_appointments WHERE id = ?', live));
  assert.equal((await call('DELETE', `/api/crm/meetings/${cancelled}`, {}, admin)).status, 200);
  assert.equal((await call('DELETE', `/api/crm/meetings/${draft}`, {}, admin)).status, 200);
  assert.equal(get('SELECT id FROM crm_appointments WHERE id IN (?, ?)', cancelled, draft), undefined);
  assert.equal(all("SELECT id FROM school_audit_log WHERE action = 'crm_meeting_deleted'").length, 2);
  assert.equal((await call('DELETE', '/api/crm/meetings/99999', {}, admin)).status, 404);
});

test('S12: a person with CRM notes, tasks, files or meetings is still refused by default; a CRM Admin can erase them together, files included, and the log holds counts only', async () => {
  const F = R('lib/crm-files.js');
  const person = env.addContact(db, 'erase-me@school.test', 'Erase Me');
  const stored = F.newStoredName();
  fs.writeFileSync(path.join(FILES, stored), 'file body');
  db.prepare("INSERT INTO crm_notes (contact_id, body) VALUES (?, 'a note')").run(person);
  db.prepare("INSERT INTO crm_tasks (contact_id, title) VALUES (?, 'a task')").run(person);
  db.prepare("INSERT INTO crm_attachments (contact_id, original_name, stored_name, kind, mime, size_bytes) VALUES (?, 'x.pdf', ?, 'pdf', 'application/pdf', 9)").run(person, stored);
  db.prepare("INSERT INTO crm_appointments (contact_id, title, starts_at, ends_at, status, uid) VALUES (?, 'Call', '2026-12-01 10:00:00', '2026-12-01 11:00:00', 'cancelled', 'uid-erase')").run(person);
  const plain = await call('DELETE', `/api/newsletter/contacts/${person}`, {}, admin);
  assert.equal(plain.status, 409); assert.equal(plain.json.code, 'contact_has_crm_items'); assert.equal(plain.json.items, 4);
  assert.ok(get('SELECT id FROM newsletter_contacts WHERE id = ?', person));
  const asSales = await call('DELETE', `/api/newsletter/contacts/${person}`, { confirmEraseCrmItems: true }, sales);
  // Since the older contact routes follow the role matrix, Sales is stopped by the route's own gate (delete is an erase action) before the second check inside the delete code is reached.
  assert.equal(asSales.status, 403); assert.match(asSales.json.error, /does not allow this/);
  assert.ok(fs.existsSync(path.join(FILES, stored)), 'nothing was touched');
  const done = await call('DELETE', `/api/newsletter/contacts/${person}`, { confirmEraseCrmItems: true }, admin);
  assert.equal(done.status, 200, JSON.stringify(done.json)); assert.equal(done.json.erasedItems, 4);
  assert.equal(get('SELECT id FROM newsletter_contacts WHERE id = ?', person), undefined);
  assert.equal(get('SELECT COUNT(*) n FROM crm_notes WHERE contact_id = ?', person).n + get('SELECT COUNT(*) n FROM crm_attachments WHERE contact_id = ?', person).n, 0, 'the rows are gone');
  assert.equal(fs.existsSync(path.join(FILES, stored)), false, 'the stored file is gone from disk');
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_contact_erased_with_items'");
  assert.deepEqual(JSON.parse(row.new_value), { items: 4, files: 1 });
  assert.doesNotMatch(JSON.stringify(row), /erase-me|Erase Me/, 'no name or email in the log');
});

test('S12: the old merge audit rows can be cleaned of the removed person\'s name and email (dry run by default), and a re-run changes nothing', async () => {
  const scrub = R('scripts/scrub-crm-merge-audit.js');
  db.exec("DELETE FROM school_audit_log");
  const ins = db.prepare("INSERT INTO school_audit_log (actor_type, action, entity_type, entity_id, prev_value) VALUES ('admin_user', 'crm_contact_merged', 'crm_contact', 1, ?)");
  const withPii = Number(ins.run('{"removedId":5,"name":"Old Name","email":"old@school.test","classification":"prospect","status":"Subscribed"}').lastInsertRowid);
  ins.run('{"removedId":6,"classification":"suspect","status":"Unsubscribed"}');
  const db2 = { query: (sql, params) => pool.query(sql, params) };
  const dry = await scrub.run(db2, { apply: false });
  assert.deepEqual({ examined: dry.examined, changed: dry.changed }, { examined: 2, changed: 1 });
  assert.match(get('SELECT prev_value FROM school_audit_log WHERE id = ?', withPii).prev_value, /old@school\.test/, 'a dry run changes nothing');
  await scrub.run(db2, { apply: true });
  const first = JSON.parse(get('SELECT prev_value FROM school_audit_log WHERE id = ?', withPii).prev_value);
  assert.deepEqual(first, { removedId: 5, classification: 'prospect', status: 'Subscribed' });
  assert.equal((await scrub.run(db2, { apply: true })).changed, 0);
});

// ---- S14 -----------------------------------------------------------------------------------------------------------------------------
test('S14: merging keeps an unsubscribe or a bounce from the duplicate, and never turns a kept unsubscribe back on', async () => {
  const merge = async (keepStatus, dupeStatus, n) => {
    const keep = env.addContact(db, `keep${n}@s14.test`, 'Keep', { status: keepStatus });
    const dupe = env.addContact(db, `dupe${n}@s14.test`, 'Dupe', { status: dupeStatus });
    const r = await call('POST', `/api/crm/contacts/${dupe}/merge`, { intoId: keep }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return get('SELECT status FROM newsletter_contacts WHERE id = ?', keep).status;
  };
  assert.equal(await merge('Subscribed', 'Unsubscribed', 1), 'Unsubscribed');
  assert.equal(await merge('Subscribed', 'Bounced', 2), 'Bounced');
  assert.equal(await merge('Subscribed', 'Subscribed', 3), 'Subscribed');
  assert.equal(await merge('Unsubscribed', 'Subscribed', 4), 'Unsubscribed', 'a kept opt-out stays an opt-out');
});

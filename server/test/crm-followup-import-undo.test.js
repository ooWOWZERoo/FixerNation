// Customer Hub follow-up to G22: undo a prospect import. Removes only the people THAT import created and nobody has touched since; everyone else stays. CRM Admin only, once, counts-only audit.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/import', R('crm-import.js')]]);
test.after(() => server.close());
const U = require(path.join(env.SERVER, 'lib/crm-import-undo.js'));

const admin = env.addAdmin(db, 'unboss', 'admin'), sales = env.addAdmin(db, 'unrep', 'sales'), viewer = env.addAdmin(db, 'unviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const acct = (name) => Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES (?, 'school')").run(name).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_import_people; DELETE FROM crm_import_review; DELETE FROM crm_import_batches; DELETE FROM crm_account_contacts; DELETE FROM crm_accounts; DELETE FROM newsletter_contacts; DELETE FROM crm_tasks; DELETE FROM crm_notes; DELETE FROM crm_opportunity_contacts; DELETE FROM crm_opportunities; DELETE FROM purchases; DELETE FROM invoices; DELETE FROM quote_requests; DELETE FROM campaign_sends; DELETE FROM contact_group_members; DELETE FROM site_users; DELETE FROM crm_appointments; DELETE FROM crm_classification_events; DELETE FROM school_audit_log');
const importRows = (rows, name = 'Spring list', who = sales) => call('POST', '/api/crm/import/run', { batchName: name, rows }, who);
const idOf = (email) => (get('SELECT id FROM newsletter_contacts WHERE email = ?', email) || {}).id;
const preview = (batch, who = admin) => call('POST', `/api/crm/import/batches/${batch}/undo-preview`, {}, who);
const undo = (batch, who = admin, body = { confirm: true }) => call('POST', `/api/crm/import/batches/${batch}/undo`, body, who);
const reasons = (r) => Object.fromEntries(r.json.keptByReason.map(k => [k.reason, k.count]));

test('RECORDING: every person an import creates is listed against it, with what the import wrote; people who were already there and queued rows are not', async () => {
  reset();
  const school = acct('Undo School');
  env.addContact(db, 'already@school.org', 'Already Here');
  const r = await importRows([{ email: 'a@school.org', name: 'Ann One', organization: 'Undo School', title: 'Principal' }, { email: 'b@school.org', name: 'Bo Two' }, { email: 'already@school.org', name: 'Al', company: 'X' }, { email: 'c@school.org', name: 'Already Here' }]);
  assert.equal(r.status, 201); assert.deepEqual([r.json.counts.added, r.json.counts.already_there, r.json.counts.queued], [2, 1, 1]);
  const led = all('SELECT * FROM crm_import_people ORDER BY id');
  assert.deepEqual(led.map(x => x.email_norm), ['a@school.org', 'b@school.org']); assert.equal(led[0].batch_id, r.json.batchId);
  assert.equal(led[0].account_id, school); assert.equal(led[1].account_id, null);
  const snap = JSON.parse(led[0].snapshot_json); assert.equal(snap.status, 'Unsubscribed'); assert.equal(snap.label, 'suspect'); assert.equal(snap.adminId, sales); assert.equal(snap.title, 'Principal');
  // a queued row that a person later adds as a different person is listed too, against ITS import, and knows which review item made it
  const item = all('SELECT id FROM crm_import_review')[0].id;
  assert.equal((await call('POST', `/api/crm/import/review/${item}/resolve`, { action: 'different_person' }, sales)).status, 200);
  const later = all('SELECT * FROM crm_import_people ORDER BY id')[2];
  assert.equal(later.email_norm, 'c@school.org'); assert.equal(later.batch_id, r.json.batchId); assert.equal(later.via_review_id, item);
});

test('UNDO REMOVES UNTOUCHED PEOPLE: the people the import made go (with their place on the account); the person who was already there, and their filled blanks, stay; a count-only audit row', async () => {
  reset();
  const school = acct('Undo School');
  const before = env.addContact(db, 'already@school.org', ''); // no name: the import fills it in
  const r = await importRows([{ email: 'a@school.org', name: 'Ann One', organization: 'Undo School' }, { email: 'b@school.org', name: 'Bo Two' }, { email: 'already@school.org', name: 'Filled In' }]);
  const batch = r.json.batchId;
  assert.equal(get('SELECT name FROM newsletter_contacts WHERE id = ?', before).name, 'Filled In');
  const p = await preview(batch);
  assert.equal(p.status, 200); assert.deepEqual([p.json.people, p.json.removable, p.json.kept], [2, 2, 0]);
  assert.equal(all('SELECT id FROM newsletter_contacts').length, 3, 'a preview removes nothing');
  const u = await undo(batch);
  assert.equal(u.status, 200); assert.deepEqual([u.json.removed, u.json.kept, u.json.gone], [2, 0, 0]);
  assert.deepEqual(all('SELECT email FROM newsletter_contacts').map(x => x.email), ['already@school.org']);
  assert.equal(get('SELECT name FROM newsletter_contacts WHERE id = ?', before).name, 'Filled In', 'the blanks the import filled in are left as they are');
  assert.equal(all('SELECT * FROM crm_account_contacts').length, 0, 'their place on the account went with them');
  assert.equal(all('SELECT id FROM crm_accounts WHERE id = ?', school).length, 1, 'the account is untouched');
  const b = get('SELECT undone_at, undone_by_admin_id, undo_removed, undo_kept FROM crm_import_batches WHERE id = ?', batch);
  assert.deepEqual([!!b.undone_at, b.undone_by_admin_id, b.undo_removed, b.undo_kept], [true, admin, 2, 0]);
  const rows = all("SELECT * FROM school_audit_log WHERE action = 'crm_import_undone'");
  assert.equal(rows.length, 1); assert.equal(rows[0].entity_type, 'crm_import'); assert.equal(rows[0].actor_type, 'admin_user');
  assert.doesNotMatch(JSON.stringify(rows[0]), /school\.org|Ann One|Bo Two|Filled In/, 'counts only');
  assert.deepEqual(JSON.parse(rows[0].new_value), { removed: 2, kept: 0, gone: 0, keptByReason: {} });
});

// One person per way of being touched. Each must be KEPT, with the reason named, and nobody else's people removed.
const TOUCHES = [
  ['edited', (id) => db.prepare("UPDATE newsletter_contacts SET company = 'Changed Co' WHERE id = ?").run(id)],
  ['edited', (id) => db.prepare("UPDATE newsletter_contacts SET name = 'Someone Else' WHERE id = ?").run(id)],
  ['email_changed', (id) => db.prepare("UPDATE newsletter_contacts SET email = 'new@school.org' WHERE id = ?").run(id)],
  ['subscribed', (id) => db.prepare("UPDATE newsletter_contacts SET status = 'Subscribed' WHERE id = ?").run(id)],
  ['label_changed', (id) => db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(id)],
  ['label_changed', (id) => db.prepare('UPDATE newsletter_contacts SET classification_locked = 1 WHERE id = ?').run(id)],
  ['label_changed', (id) => db.prepare("INSERT INTO crm_classification_events (contact_id, from_classification, to_classification, event_type) VALUES (?, 'suspect', 'prospect', 'manual')").run(id)],
  ['owner_changed', (id) => db.prepare('UPDATE newsletter_contacts SET assigned_admin_id = ? WHERE id = ?').run(admin, id)],
  ['contacted', (id) => db.prepare("UPDATE newsletter_contacts SET last_contacted_at = '2026-11-16 10:00:00' WHERE id = ?").run(id)],
  ['work', (id) => db.prepare("INSERT INTO crm_notes (contact_id, body) VALUES (?, 'hello')").run(id)],
  ['work', (id) => db.prepare("INSERT INTO crm_tasks (contact_id, title, state) VALUES (?, 'call', 'open')").run(id)],
  ['work', (id) => db.prepare("INSERT INTO crm_appointments (contact_id, title, starts_at, ends_at, status, uid) VALUES (?, 'Meeting', '2026-12-01 10:00:00', '2026-12-01 10:30:00', 'scheduled', 'u1')").run(id)],
  ['work', (id) => db.prepare("INSERT INTO crm_appointments (title, starts_at, ends_at, status, uid, attendees_json) VALUES ('Invites', '2026-12-01 10:00:00', '2026-12-01 10:30:00', 'scheduled', 'u2', ?)").run(JSON.stringify({ staffIds: [], contactIds: [id] }))],
  ['on_deal', (id) => { const a = acct('Deal Co'); const d = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id) VALUES (?, 'D', 1)").run(a).lastInsertRowid); db.prepare("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'champion')").run(d, id); }],
  ['money', (id) => env.addPurchase(db, id, {})],
  ['money', (id) => db.prepare("INSERT INTO invoices (invoice_number, contact_id) VALUES ('INV-1', ?)").run(id)],
  ['quote', (id) => env.addQuote(db, get('SELECT email FROM newsletter_contacts WHERE id = ?', id).email, { school: 'Their School' })],
  ['emailed', (id) => db.prepare("INSERT INTO campaign_sends (campaign_id, contact_id, email) VALUES (1, ?, 'x@y.z')").run(id)],
  ['in_group', (id) => db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, 1)').run(id)],
  ['has_account', (id) => db.prepare('INSERT INTO site_users (email) VALUES (?)').run(get('SELECT email FROM newsletter_contacts WHERE id = ?', id).email.toUpperCase())],
  ['in_review', (id) => db.prepare("INSERT INTO crm_import_review (batch_id, email, reason, candidates_json, state, resolved_contact_id) VALUES (999, 'z@z.org', 'same_name', '[]', 'same_person', ?)").run(id)],
  ['account_changed', (id) => db.prepare('UPDATE crm_account_contacts SET is_primary = 1 WHERE contact_id = ?').run(id)],
  ['account_changed', (id) => db.prepare("UPDATE crm_account_contacts SET ended_on = '2026-11-16' WHERE contact_id = ?").run(id)],
  ['account_changed', (id) => db.prepare('INSERT INTO crm_account_contacts (account_id, contact_id) VALUES (?, ?)').run(acct('Another School'), id)],
  ['account_changed', (id) => db.prepare("UPDATE crm_account_contacts SET title = 'Superintendent' WHERE contact_id = ?").run(id)],
];

test('UNDO KEEPS ANYONE WHO HAS ANYTHING OF THEIR OWN: every kind of change since the import keeps that person, with the reason, and the untouched one still goes', async () => {
  for (const [reason, touch] of TOUCHES) {
    reset();
    acct('Undo School');
    const r = await importRows([{ email: 'touched@school.org', name: 'Touched Person', organization: 'Undo School', title: 'Principal' }, { email: 'clean@school.org', name: 'Clean Person' }]);
    const id = idOf('touched@school.org');
    touch(id);
    const p = await preview(r.json.batchId);
    assert.deepEqual([p.json.removable, p.json.kept], [1, 1], reason);
    assert.deepEqual(reasons(p), { [reason]: 1 }, `${reason}: ${touch}`);
    const u = await undo(r.json.batchId);
    assert.deepEqual([u.json.removed, u.json.kept], [1, 1], reason);
    assert.equal(all('SELECT id FROM newsletter_contacts WHERE id = ?', id).length, 1, `${reason}: kept`);
    assert.equal(idOf('clean@school.org'), undefined, `${reason}: the untouched person went`);
  }
});

test('ONCE ONLY, AND NOT WITHOUT A LOOK: a second undo is refused, undo needs { confirm: true }, a bad id is 404, and a person removed or merged since is "gone", not an error', async () => {
  reset();
  const r = await importRows([{ email: 'a@school.org', name: 'Ann One' }, { email: 'b@school.org', name: 'Bo Two' }]); const batch = r.json.batchId;
  assert.equal((await undo(batch, admin, {})).status, 400); assert.equal((await undo(batch, admin, { confirm: 'yes' })).status, 400);
  assert.equal(all('SELECT id FROM newsletter_contacts').length, 2);
  db.prepare('DELETE FROM newsletter_contacts WHERE email = ?').run('b@school.org'); // removed by hand since
  const u = await undo(batch); assert.deepEqual([u.json.removed, u.json.gone], [1, 1]);
  const again = await undo(batch); assert.equal(again.status, 409); assert.equal(again.json.code, 'undone');
  assert.equal((await preview(batch)).status, 409);
  assert.equal((await undo(99999)).status, 404); assert.equal((await undo('abc')).status, 404); assert.equal((await preview(99999)).status, 404);
  assert.equal(all("SELECT id FROM school_audit_log WHERE action = 'crm_import_undone'").length, 1, 'one undo, one audit row');
});

test('ONLY ITS OWN PEOPLE: another import’s people, people added by hand afterwards and a person with the same email from another import are never touched', async () => {
  reset();
  const a = await importRows([{ email: 'one@school.org', name: 'One Person' }], 'First'), b = await importRows([{ email: 'two@school.org', name: 'Two Person' }], 'Second');
  env.addContact(db, 'byhand@school.org', 'By Hand');
  const u = await undo(a.json.batchId);
  assert.equal(u.json.removed, 1);
  assert.deepEqual(all('SELECT email FROM newsletter_contacts ORDER BY email').map(x => x.email), ['byhand@school.org', 'two@school.org']);
  // the person is re-imported later under a NEW import; the old (undone) import cannot reach them
  const c = await importRows([{ email: 'one@school.org', name: 'One Person' }], 'Third');
  assert.equal(c.json.counts.added, 1);
  assert.equal((await undo(a.json.batchId)).status, 409);
  assert.equal(idOf('one@school.org') !== undefined, true);
  void b;
});

test('AN IMPORT FROM BEFORE UNDO EXISTED CANNOT BE UNDONE: no list of who it made, so nothing is guessed', async () => {
  reset();
  const batch = Number(db.prepare("INSERT INTO crm_import_batches (name, total_rows, added) VALUES ('Old import', 3, 3)").run().lastInsertRowid);
  env.addContact(db, 'old@school.org', 'Old Person'); db.prepare("UPDATE newsletter_contacts SET source = 'Sales CRM import' WHERE email = 'old@school.org'").run();
  const p = await preview(batch); assert.equal(p.status, 409); assert.equal(p.json.code, 'nothing_to_undo');
  assert.equal((await undo(batch)).status, 409);
  assert.equal(all('SELECT id FROM newsletter_contacts').length, 1);
  assert.equal(get('SELECT undone_at FROM crm_import_batches WHERE id = ?', batch).undone_at, null, 'a refusal claims nothing');
  const list = (await call('GET', '/api/crm/import/batches', undefined, admin)).json;
  assert.equal(list.batches.find(x => x.id === batch).undoable, false);
});

test('WHO MAY: CRM Admin only; Sales and Read-only cannot preview or undo; signed out 401; Hub off 404; everyone can read the list, which says what can be undone', async () => {
  reset();
  const r = await importRows([{ email: 'a@school.org', name: 'Ann One' }]); const batch = r.json.batchId;
  for (const who of [sales, viewer]) { assert.equal((await preview(batch, who)).status, 403); assert.equal((await undo(batch, who)).status, 403); }
  assert.equal((await preview(batch, null)).status, 401); assert.equal((await undo(batch, null)).status, 401);
  const list = (await call('GET', '/api/crm/import/batches', undefined, viewer)).json;
  assert.equal(list.undoAvailable, true); assert.equal(list.batches[0].undoable, true); assert.equal(list.batches[0].undoneAt, null);
  assert.equal(all('SELECT id FROM newsletter_contacts').length, 1);
  env.enable(db, false);
  try { assert.equal((await preview(batch)).status, 404); } finally { env.enable(db, true); }
  await undo(batch);
  const after = (await call('GET', '/api/crm/import/batches', undefined, viewer)).json.batches[0];
  assert.equal(after.undoable, false); assert.deepEqual([after.undoRemoved, after.undoKept], [1, 0]); assert.ok(after.undoneAt);
});

test('BEFORE THE ALTER SCRIPT: an import still works and the list still shows; undo says it is not available yet; nothing breaks', async () => {
  reset();
  db.exec('DROP TABLE crm_import_people; ALTER TABLE crm_import_batches DROP COLUMN undone_at; ALTER TABLE crm_import_batches DROP COLUMN undone_by_admin_id; ALTER TABLE crm_import_batches DROP COLUMN undo_removed; ALTER TABLE crm_import_batches DROP COLUMN undo_kept;');
  try {
    const r = await importRows([{ email: 'a@school.org', name: 'Ann One' }]);
    assert.equal(r.status, 201); assert.equal(r.json.counts.added, 1);
    const list = await call('GET', '/api/crm/import/batches', undefined, admin);
    assert.equal(list.status, 200); assert.equal(list.json.undoAvailable, false); assert.equal(list.json.batches[0].undoable, false);
    const p = await preview(r.json.batchId); assert.equal(p.status, 503); assert.equal(p.json.code, 'not_available');
    assert.equal((await undo(r.json.batchId)).status, 503);
    assert.equal(all('SELECT id FROM newsletter_contacts').length, 1);
  } finally {
    db.exec("CREATE TABLE crm_import_people (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, email_norm TEXT NOT NULL, account_id INTEGER, via_review_id INTEGER, snapshot_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP); ALTER TABLE crm_import_batches ADD COLUMN undone_at TEXT; ALTER TABLE crm_import_batches ADD COLUMN undone_by_admin_id INTEGER; ALTER TABLE crm_import_batches ADD COLUMN undo_removed INTEGER; ALTER TABLE crm_import_batches ADD COLUMN undo_kept INTEGER;");
  }
});

test('A FAILURE PART WAY RELEASES THE CLAIM so the undo can be tried again, and what was removed is simply "gone" the second time', async () => {
  reset();
  const r = await importRows([{ email: 'a@school.org', name: 'Ann One' }, { email: 'b@school.org', name: 'Bo Two' }]); const batch = r.json.batchId;
  const realQuery = pool.query; let n = 0;
  const failing = { query: pool.query, getConnection: async () => { const c = await pool.getConnection(); const q = c.query; return { ...c, query: async (sql, p) => { if (/DELETE FROM newsletter_contacts/.test(sql) && ++n === 2) throw new Error('boom'); return q(sql, p); }, beginTransaction: c.beginTransaction, commit: c.commit, rollback: c.rollback, release: c.release }; } };
  await assert.rejects(() => U.undo(failing, batch, { adminId: admin, now: '2026-11-17 10:00:00' }), /boom/);
  assert.equal(get('SELECT undone_at FROM crm_import_batches WHERE id = ?', batch).undone_at, null, 'the claim was released');
  const u = await undo(batch);
  assert.equal(u.status, 200); assert.deepEqual([u.json.removed, u.json.gone], [1, 1]);
  assert.equal(all('SELECT id FROM newsletter_contacts').length, 0); void realQuery;
});

test('FILES AND PAGES: schema, alter script and test DDL agree; the alter script only adds; the page escapes names and asks first; the code parses', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  for (const c of ['crm_import_people', 'undone_at', 'undone_by_admin_id', 'undo_removed', 'undo_kept']) { assert.match(read('db/schema.sql'), new RegExp(c)); assert.match(read('scripts/alter-add-crm-import-undo.js'), new RegExp(c)); }
  const alter = read('scripts/alter-add-crm-import-undo.js').replace(/\/\/.*$/gm, '');
  assert.match(alter, /information_schema\.COLUMNS/); assert.match(alter, /information_schema\.TABLES/); assert.doesNotMatch(alter, /DROP|RENAME|TRUNCATE|DELETE FROM|UPDATE\s+\w+\s+SET/i, 'additive only');
  const page = read('../admin-crm-contacts.html');
  assert.match(page, /esc\(b\.name\)/); assert.match(page, /undo-preview/); assert.match(page, /confirm: true/); assert.match(page, /C\.can\('erase'\)/);
  const lib = read('lib/crm-import-undo.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(lib, /DELETE FROM (purchases|invoices|quote_requests|crm_opportunities|crm_tasks|crm_notes|campaign_sends)/, 'it removes people, their account place and label history, nothing else');
  assert.doesNotMatch(lib, /school\.org|\bemail\b.*audit/i);
  for (const f of ['lib/crm-import-undo.js', 'lib/crm-import.js', 'routes/crm-import.js', 'scripts/alter-add-crm-import-undo.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  for (const s of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s));
  assert.ok(Object.keys(U.REASONS).length >= 15);
});

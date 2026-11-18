// Sales CRM punch list G22 (PRD FR-CON-05): the prospect import and its review queue. Suspects, not subscribed; exact email fills blanks only; a look-alike waits for a person; the organization
// links to an existing account by exact name and never makes one; nothing is merged or overwritten. Real routes and SQL (node:sqlite). Run:  cd server && npm test
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
const I = require(path.join(env.SERVER, 'lib/crm-import.js'));

const admin = env.addAdmin(db, 'g22boss', 'admin'), sales = env.addAdmin(db, 'g22rep', 'sales'), viewer = env.addAdmin(db, 'g22viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const person = (name, email, f = {}) => { const id = env.addContact(db, email, name); if (f.company !== undefined) db.prepare('UPDATE newsletter_contacts SET company = ? WHERE id = ?').run(f.company, id); if (f.label) db.prepare('UPDATE newsletter_contacts SET crm_classification = ? WHERE id = ?').run(f.label, id); return id; };
const acct = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, archived_at) VALUES (?, ?, ?)').run(name, 'school', f.archived || null).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_import_review; DELETE FROM crm_import_batches; DELETE FROM crm_account_contacts; DELETE FROM crm_accounts; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log; DELETE FROM crm_classification_events');
const run = (rows, who = sales, name = 'Spring list') => call('POST', '/api/crm/import/run', { batchName: name, rows }, who);
const preview = (rows, who = sales) => call('POST', '/api/crm/import/preview', { rows }, who);
const snap = () => JSON.stringify(['newsletter_contacts', 'crm_account_contacts', 'crm_import_review', 'crm_import_batches'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`)));

test('A ROW IS CLEANED: a usable email is required, a test address is refused, control characters go, every field is cut to its length, and a row that is not an object is a problem not a crash', () => {
  assert.equal(I.cleanRow({ email: ' Pat@School.ORG ' }).email, 'pat@school.org');
  for (const bad of [{}, { email: 'nope' }, { email: 'a@b' }, { email: 'a b@c.com' }, { email: 'x@example.com' }, { email: ['a@b.com'] }, null, 'a@b.com', []]) assert.ok(I.cleanRow(bad).problem, JSON.stringify(bad));
  const long = I.cleanRow({ email: 'a@b.com', name: 'N'.repeat(400), company: 'C'.repeat(400), phone: '1'.repeat(80), state: 'S'.repeat(90), title: 'T'.repeat(200) });
  assert.deepEqual([long.name.length, long.company.length, long.phone.length, long.state.length, long.title.length], [255, 255, 32, 64, 128]);
  assert.equal(I.cleanRow({ email: 'a@b.com', name: 'Pat\u0000\n  Lee' }).name, 'Pat Lee');
});

test('THE PLAN: invalid, repeated, already there, look-alike, new; a shared email domain is never a match; a test address in the CRM is never a match; the organization links only on one exact live account; a preview writes nothing', async () => {
  reset();
  const pat = person('Pat Lee', 'pat.lee@school.org'), tag = person('Sam Rowe', 'sam@school.org'); person('Qa Person', 'qa@example.com'); person('Ann Kim', 'ann@elsewhere.org');
  const maple = acct('Maple Elementary'); acct('Twin'); acct('Twin'); acct('Old School', { archived: '2026-01-01 00:00:00' });
  const rows = [
    { email: 'PAT.LEE@school.org', name: 'P Lee' },                                   // exact
    { email: 'sam+news@school.org', name: 'S Rowe' },                                 // same mailbox once the tag is removed
    { email: 'a.kim@other.org', name: 'ann  KIM' },                                   // same full name
    { email: 'newbie@school.org', name: 'New Bee', organization: 'maple elementary' }, // new, links to Maple
    { email: 'third@school.org', name: 'Third', organization: 'Twin' },               // new, two accounts with that name
    { email: 'fourth@school.org', name: 'Fourth', organization: 'Old School' },       // new, only an archived one
    { email: 'fifth@school.org', name: 'Fifth', organization: 'Nowhere Academy' },    // new, no account
    { email: 'newbie@school.org', name: 'Again' },                                    // repeated in the file
    { email: '' }, { email: 'qa-new@example.com' },
    { email: 'one@school.org', name: 'Qa Person' },                                   // the test address in the CRM is not a match
    { email: 'solo@school.org', name: 'Lee' },                                        // one-word names never match
  ];
  const before = snap();
  const p = (await preview(rows)).json;
  assert.equal(snap(), before, 'a preview writes nothing');
  const d = p.rows.map(r => r.decision);
  assert.deepEqual(d, ['exists', 'review', 'review', 'new', 'new', 'new', 'new', 'repeated', 'invalid', 'invalid', 'new', 'new']);
  assert.deepEqual(p.counts, { total: 12, new: 6, exists: 1, review: 2, left_out: 3 });
  assert.equal(p.rows[1].candidates[0].reason, 'same_mailbox'); assert.equal(p.rows[2].candidates[0].reason, 'same_name');
  assert.equal(p.rows[3].linksToAccount, true); for (const i of [4, 5, 6]) { assert.equal(p.rows[i].linksToAccount, false); assert.ok(p.rows[i].accountNote); }
  assert.match(p.rows[4].accountNote, /More than one account/); assert.match(p.rows[6].accountNote, /No account has that exact name/);
  void [pat, tag, maple];
  assert.equal((await preview([])).status, 400); assert.equal((await preview('x')).status, 400); assert.equal((await preview(Array.from({ length: I.MAX_ROWS + 1 }, (_, i) => ({ email: `m${i}@s.org` })))).status, 400);
});

test('THE IMPORT: new people are Suspects, not subscribed, with an import source, an owner and their place on the matched account; the counts and one audit row (no names or emails) are kept', async () => {
  reset();
  const maple = acct('Maple Elementary');
  const r = await run([{ email: 'new1@school.org', name: 'New One', organization: 'Maple Elementary', title: 'Principal', phone: '555-1', state: 'NY' }, { email: 'new2@school.org', name: 'New Two', company: 'Oak Co' }], sales, 'Spring list');
  assert.equal(r.status, 201); assert.deepEqual(r.json.counts, { total: 2, added: 2, already_there: 0, queued: 0, left_out: 0 });
  const a = get("SELECT * FROM newsletter_contacts WHERE email = 'new1@school.org'");
  assert.equal(a.crm_classification, 'suspect'); assert.equal(a.status, 'Unsubscribed'); assert.equal(a.crm_source, 'crm_import'); assert.equal(a.source, 'Sales CRM import'); assert.equal(a.assigned_admin_id, sales);
  assert.equal(a.name, 'New One'); assert.equal(a.phone, '555-1'); assert.equal(a.state, 'NY'); assert.equal(a.company, 'Maple Elementary', 'the organization text is kept as the company when none was given');
  const m = get('SELECT * FROM crm_account_contacts WHERE contact_id = ?', a.id); assert.equal(m.account_id, maple); assert.equal(m.title, 'Principal'); assert.equal(m.started_on, new Date().toISOString().slice(0, 10));
  assert.equal(get("SELECT company c FROM newsletter_contacts WHERE email = 'new2@school.org'").c, 'Oak Co'); assert.equal(all('SELECT * FROM crm_account_contacts').length, 1, 'no account made, none linked for the second');
  assert.equal(all('SELECT * FROM crm_accounts').length, 1, 'an import never creates an account');
  const b = get('SELECT * FROM crm_import_batches'); assert.equal(b.name, 'Spring list'); assert.equal(b.added, 2); assert.equal(b.total_rows, 2);
  const log = all("SELECT * FROM school_audit_log WHERE action = 'crm_import_run'"); assert.equal(log.length, 1); assert.doesNotMatch(JSON.stringify(log), /@|New One|school\.org/);
  assert.equal((await run([{ email: 'x@y.org' }], sales, '   ')).status, 400, 'a name for the import is required');
  assert.equal((await call('GET', '/api/crm/import/batches', undefined, viewer)).json.batches[0].added, 2);
});

test('AN EXISTING PERSON IS ONLY GIVEN WHAT WAS BLANK: nothing is overwritten, their label, subscription and owner are not touched, they are not added to an account, and a second import changes nothing', async () => {
  reset();
  const maple = acct('Maple Elementary');
  const id = person('Pat Lee', 'pat@school.org', { company: '', label: 'customer' }); db.prepare("UPDATE newsletter_contacts SET status = 'Subscribed', phone = '', state = 'PA', assigned_admin_id = ? WHERE id = ?").run(admin, id);
  const row = { email: 'PAT@school.org', name: 'Someone Else', company: 'Maple School', phone: '555-9', state: 'NY', organization: 'Maple Elementary' };
  const r = await run([row]); assert.deepEqual(r.json.counts, { total: 1, added: 0, already_there: 1, queued: 0, left_out: 0 });
  const c = get('SELECT * FROM newsletter_contacts WHERE id = ?', id);
  assert.equal(c.name, 'Pat Lee', 'a name already there is kept'); assert.equal(c.company, 'Maple School', 'a blank company is filled'); assert.equal(c.phone, '555-9'); assert.equal(c.state, 'PA', 'a state already there is kept');
  assert.equal(c.crm_classification, 'customer'); assert.equal(c.status, 'Subscribed'); assert.equal(c.assigned_admin_id, admin);
  assert.equal(all('SELECT * FROM crm_account_contacts WHERE contact_id = ?', id).length, 0, 'an import does not add an existing person to an account'); void maple;
  const again = snap(); await run([row]); assert.equal(JSON.stringify(['newsletter_contacts', 'crm_account_contacts', 'crm_import_review'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`))), JSON.stringify(JSON.parse(again).slice(0, 3)), 'the same import again changes nothing');
});

test('LOOK-ALIKES WAIT: they are queued, not added; the queue shows them beside who they might be; same person fills blanks; different person adds them; skip leaves them out; each can be decided once', async () => {
  reset();
  const sam = person('Sam Rowe', 'sam@school.org', { company: '' });
  await run([{ email: 'sam+tag@school.org', name: 'Sam Rowe', company: 'Maple School', title: 'Teacher' }, { email: 'srowe@other.org', name: 'sam rowe' }, { email: 'neither@x.org', name: 'Pat Lee', company: 'X' }, { email: 'also@x.org', name: 'Sam  Rowe' }], sales, 'Queue test');
  assert.equal(all("SELECT * FROM newsletter_contacts WHERE email LIKE '%sam+tag%' OR email = 'srowe@other.org'").length, 0, 'queued rows are not added');
  const q = (await call('GET', '/api/crm/import/review', undefined, viewer)).json; assert.equal(q.total, 3);
  const item = (email) => q.items.find(i => i.row.email === email);
  const a = item('sam+tag@school.org'), b = item('srowe@other.org'), c = item('also@x.org');
  assert.equal(a.reason, 'same_mailbox'); assert.deepEqual(a.candidates.map(x => x.id), [sam]); assert.equal(a.batchName, 'Queue test'); assert.equal(b.reason, 'same_name');
  const dec = (id, body, who = sales) => call('POST', `/api/crm/import/review/${id}/resolve`, body, who);
  assert.equal((await dec(a.id, { action: 'same_person', contactId: sam }, viewer)).status, 403);
  assert.equal((await dec(a.id, { action: 'same_person' })).status, 400); assert.equal((await dec(a.id, { action: 'same_person', contactId: 99999 })).status, 400); assert.equal((await dec(a.id, { action: 'merge' })).status, 400);
  assert.equal(get('SELECT state s FROM crm_import_review WHERE id = ?', a.id).s, 'waiting', 'a refused decision changes nothing');
  assert.equal((await dec(a.id, { action: 'same_person', contactId: sam })).status, 200);
  assert.equal(get('SELECT company c FROM newsletter_contacts WHERE id = ?', sam).c, 'Maple School', 'blank filled'); assert.equal(get('SELECT name n FROM newsletter_contacts WHERE id = ?', sam).n, 'Sam Rowe');
  const diff = await dec(b.id, { action: 'different_person' }); assert.equal(diff.status, 200);
  const created = get("SELECT * FROM newsletter_contacts WHERE email = 'srowe@other.org'"); assert.ok(created); assert.equal(created.crm_classification, 'suspect'); assert.equal(created.status, 'Unsubscribed'); assert.equal(diff.json.contactId, created.id);
  assert.equal((await dec(c.id, { action: 'skip' })).status, 200); assert.equal(all("SELECT * FROM newsletter_contacts WHERE email = 'also@x.org'").length, 0);
  for (const x of [a, b, c]) assert.equal((await dec(x.id, { action: 'skip' })).status, 409, 'decided once');
  assert.equal((await call('GET', '/api/crm/import/review', undefined, viewer)).json.total, 0);
  assert.equal((await call('GET', '/api/crm/import/review?state=skipped', undefined, viewer)).json.total, 1);
  assert.equal((await dec(99999, { action: 'skip' })).status, 404);
  assert.ok(all("SELECT new_value FROM school_audit_log WHERE action = 'crm_import_review_decided'").length === 3);
});

test('WHO CAN DO WHAT: CRM Admin and Sales preview, import and decide; Read-only reads the queue and history but never writes; signed out gets nothing; the Hub being off answers 404', async () => {
  reset();
  for (const who of [admin, sales]) { assert.equal((await preview([{ email: 'p@s.org' }], who)).status, 200); assert.equal((await run([{ email: `w${who}@s.org` }], who)).status, 201); }
  assert.equal((await preview([{ email: 'p@s.org' }], viewer)).status, 403); assert.equal((await run([{ email: 'v@s.org' }], viewer)).status, 403);
  assert.equal(all("SELECT * FROM newsletter_contacts WHERE email = 'v@s.org'").length, 0);
  for (const m of [['POST', '/api/crm/import/preview'], ['POST', '/api/crm/import/run'], ['GET', '/api/crm/import/review'], ['GET', '/api/crm/import/batches']]) assert.equal((await call(m[0], m[1], {})).status, 401, m[1]);
  for (const who of [admin, sales, viewer]) { assert.equal((await call('GET', '/api/crm/import/review', undefined, who)).status, 200); assert.equal((await call('GET', '/api/crm/import/batches', undefined, who)).status, 200); }
  env.enable(db, false); assert.equal((await call('GET', '/api/crm/import/review', undefined, admin)).status, 404); env.enable(db, true);
});

test('BEFORE THE ALTER SCRIPT: the import and the queue say "not available yet" instead of failing, and nobody is added without a batch record', async () => {
  reset();
  db.exec('DROP TABLE crm_import_review; DROP TABLE crm_import_batches');
  try {
    const r = await run([{ email: 'x@school.org', name: 'X Y' }]); assert.equal(r.status, 503); assert.equal(r.json.code, 'not_available'); assert.equal(all("SELECT * FROM newsletter_contacts WHERE email = 'x@school.org'").length, 0);
    assert.equal((await call('GET', '/api/crm/import/review', undefined, admin)).status, 503); assert.equal((await call('GET', '/api/crm/import/batches', undefined, admin)).status, 503);
  } finally {
    db.exec("CREATE TABLE crm_import_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, total_rows INTEGER NOT NULL DEFAULT 0, added INTEGER NOT NULL DEFAULT 0, already_there INTEGER NOT NULL DEFAULT 0, queued INTEGER NOT NULL DEFAULT 0, left_out INTEGER NOT NULL DEFAULT 0, created_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE crm_import_review (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, name TEXT, email TEXT NOT NULL, company TEXT, state_text TEXT, phone TEXT, title TEXT, account_id INTEGER, reason TEXT NOT NULL, candidates_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'waiting', resolved_contact_id INTEGER, decided_by_admin_id INTEGER, decided_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  }
});

test('THE PAGE AND THE FILES: the Import people dialog and the Import review tab are wired and escaped, the library never merges or deletes, and the alter script and schema match', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const page = read('../admin-crm-contacts.html');
  for (const k of ['importPeople', 'parseCsv', '/api/crm/import/preview', '/api/crm/import/run', 'fetchReview', 'view=review', 'data-same', 'data-diff', 'Suspect', 'not subscribed']) assert.ok(page.includes(k), k);
  assert.match(page, /esc\(it\.row\.name \|\| it\.row\.email\)/); assert.match(page, /esc\(c\.name \|\| c\.email\)/); assert.match(page, /esc\(it\.batchName\)/);
  const lib = read('lib/crm-import.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(lib, /DELETE FROM|UPDATE crm_opportunities|UPDATE newsletter_contacts SET (crm_classification|status|assigned_admin_id)|INSERT INTO crm_accounts|mailer|sendMail/i);
  for (const t of ['crm_import_batches', 'crm_import_review']) { assert.match(read('db/schema.sql'), new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`)); assert.match(read('scripts/alter-create-crm-import.js'), new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`)); }
  assert.match(read('scripts/alter-create-crm-import.js'), /information_schema\.TABLES/); assert.match(read('app.js'), /\/api\/crm\/import/);
  for (const f of ['lib/crm-import.js', 'routes/crm-import.js', 'scripts/alter-create-crm-import.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});

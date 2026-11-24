// Merged Contacts screen, phase 5 (docs/reference/contact-pages-merge-requirements.md): ONE importer. The Customer Hub's importer (not subscribed, review queue, undo) now also reads the
// older CRM page's columns (street, city, ZIP, signup date, source, notes, email groups), works through /api/admin/contacts/import with the Hub switched off, and is undone cleanly.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
db.exec('ALTER TABLE crm_import_review ADD COLUMN extra_json TEXT');
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/admin/contacts', R('contact-screens.js')], ['/api/crm/import', R('crm-import.js')]]);
test.after(() => server.close());
const I = require(path.join(env.SERVER, 'lib/crm-import.js'));

const boss = env.addAdmin(db, 'impboss', 'admin'), rep = env.addAdmin(db, 'imprep', 'sales'), viewer = env.addAdmin(db, 'impviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
const BASE = '/api/admin/contacts/import';
const run = (rows, who = rep, extra = {}) => call('POST', `${BASE}/run`, { batchName: 'Spring list', rows, ...extra }, who);
const byEmail = (e) => get('SELECT * FROM newsletter_contacts WHERE email = ?', e);
const groupsOf = (id) => all('SELECT g.name FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id WHERE m.contact_id = ? ORDER BY g.name', id).map(r => r.name);
const reset = () => db.exec('DELETE FROM crm_import_review; DELETE FROM crm_import_people; DELETE FROM crm_import_batches; DELETE FROM contact_group_members; DELETE FROM contact_groups; DELETE FROM crm_account_contacts; DELETE FROM crm_accounts; DELETE FROM newsletter_contacts; DELETE FROM school_audit_log;');

const FULL = { name: 'Jamie Lee', email: 'jamie@school.org', phone: '555-0101', company: 'Acme Elementary', street: '123 Oak St', city: 'Denver', state: 'CO', zip: '80202', signupDate: '2026-09-05', source: 'Event', notes: 'Met at the conference', groups: 'Teachers|FNE Suspect' };

test('A ROW READS THE OLDER PAGE\'S COLUMNS: street, city, ZIP, signup date, source, notes and groups (a list, or names separated by |); a bad date is ignored, not fatal', () => {
  const r = I.cleanRow(FULL);
  assert.deepEqual([r.street, r.city, r.zip, r.signup, r.source, r.notes, r.groups], ['123 Oak St', 'Denver', '80202', '2026-09-05 00:00:00', 'Event', 'Met at the conference', ['Teachers', 'FNE Suspect']]);
  assert.deepEqual(I.cleanRow({ email: 'a@b.com', groups: ['A', 'a', ' B ', '', 5] }).groups, ['A', 'B'], 'repeats in any capitalisation and blanks drop; a non-text entry is not a name');
  assert.equal(I.cleanRow({ email: 'a@b.com', groups: Array.from({ length: 40 }, (_, i) => 'G' + i) }).groups.length, 20);
  for (const bad of ['not a date', '1999-01-01', '2999-01-01', '', 5, null]) assert.equal(I.cleanRow({ email: 'a@b.com', signupDate: bad }).signup, null, String(bad));
  const long = I.cleanRow({ email: 'a@b.com', street: 'S'.repeat(400), city: 'C'.repeat(400), zip: 'Z'.repeat(40), source: 'x'.repeat(300), notes: 'n'.repeat(20000) });
  assert.deepEqual([long.street.length, long.city.length, long.zip.length, long.source.length, long.notes.length], [255, 128, 16, 100, 15000]);
  assert.equal(I.cleanRow({ email: 'a@b.com', notes: 'line one\nline two\u0000' }).notes, 'line one\nline two', 'a note keeps its line breaks');
});

test('A NEW PERSON gets every column and is NOT subscribed whatever the file says; groups are created only when asked; the label is Suspect, the owner is who ran it (Hub on)', async () => {
  reset();
  const noGroups = await run([{ ...FULL, status: 'Subscribed' }], rep);
  assert.equal(noGroups.status, 201); assert.deepEqual([noGroups.json.counts.added, noGroups.json.groupsCreated, noGroups.json.groupsSkipped], [1, [], ['Teachers', 'FNE Suspect']]);
  let p = byEmail('jamie@school.org');
  assert.deepEqual([p.name, p.phone, p.company, p.street, p.city, p.state, p.zip, p.source, p.notes, p.status, p.crm_source, p.assigned_admin_id, p.crm_classification], ['Jamie Lee', '555-0101', 'Acme Elementary', '123 Oak St', 'Denver', 'CO', '80202', 'Event', 'Met at the conference', 'Unsubscribed', 'crm_import', rep, 'suspect']);
  assert.match(p.signup_date, /^2026-09-05/);
  assert.deepEqual(groupsOf(p.id), [], 'no group was created, so no tag');
  reset();
  const withGroups = await run([FULL], rep, { createMissingGroups: true });
  assert.deepEqual([withGroups.json.groupsCreated.sort(), withGroups.json.groupsSkipped], [['FNE Suspect', 'Teachers'], []]);
  p = byEmail('jamie@school.org'); assert.deepEqual(groupsOf(p.id), ['FNE Suspect', 'Teachers']);
  assert.equal(get('SELECT COUNT(*) AS n FROM contact_groups').n, 2);
  assert.equal(I.cleanRow({ email: 'a@b.com', status: 'Subscribed' }).status, undefined, 'a status column is never read');
  const a = all("SELECT * FROM school_audit_log WHERE action = 'crm_import_run'").pop();
  assert.doesNotMatch(`${a.new_value}${a.reason}`, /jamie|school\.org|Teachers|Oak/i, 'the audit row has counts only');
});

test('AN EXISTING PERSON only has blanks filled (street, city, ZIP, notes too) and is added to the groups named; nothing they already have is changed and no group is taken away', async () => {
  reset();
  const id = env.addContact(db, 'jamie@school.org', 'Jamie Original');
  db.prepare("UPDATE newsletter_contacts SET city = 'Boulder', status = 'Subscribed', source = 'Homepage' WHERE id = ?").run(id);
  db.prepare('INSERT INTO contact_groups (name) VALUES (?)').run('Already In'); const keep = get('SELECT id FROM contact_groups').id;
  db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)').run(id, keep);
  const r = await run([FULL], rep, { createMissingGroups: true });
  assert.deepEqual([r.json.counts.added, r.json.counts.already_there], [0, 1]);
  const p = byEmail('jamie@school.org');
  assert.deepEqual([p.name, p.city, p.street, p.zip, p.notes, p.status, p.source], ['Jamie Original', 'Boulder', '123 Oak St', '80202', 'Met at the conference', 'Subscribed', 'Homepage'], 'blanks filled, everything else as it was');
  assert.deepEqual(groupsOf(id), ['Already In', 'FNE Suspect', 'Teachers']);
});

test('THE PREVIEW reports the groups that do not exist, writes nothing, and the same file run twice adds nobody twice', async () => {
  reset();
  const before = all('SELECT * FROM contact_groups').length + all('SELECT * FROM newsletter_contacts').length;
  const pv = await call('POST', `${BASE}/preview`, { rows: [FULL] }, rep);
  assert.equal(pv.status, 200); assert.deepEqual(pv.json.missingGroups.sort(), ['FNE Suspect', 'Teachers']); assert.deepEqual(pv.json.rows[0].groups, ['Teachers', 'FNE Suspect']); assert.equal(pv.json.rows[0].city, 'Denver');
  assert.equal(all('SELECT * FROM contact_groups').length + all('SELECT * FROM newsletter_contacts').length, before, 'a preview writes nothing');
  await run([FULL], rep, { createMissingGroups: true });
  const again = await run([FULL], rep, { createMissingGroups: true });
  assert.deepEqual([again.json.counts.added, again.json.counts.already_there], [0, 1]);
  assert.equal(get('SELECT COUNT(*) AS n FROM newsletter_contacts').n, 1);
  assert.equal(all('SELECT * FROM contact_group_members').length, 2, 'no membership is doubled');
  assert.equal((await call('POST', `${BASE}/run`, { batchName: 'x', rows: Array.from({ length: 401 }, (_, i) => ({ email: `p${i}@school.org` })) }, rep)).status, 400, 'at most 400 rows');
});

test('WITH THE HUB OFF the importer still works through the merged routes: same consent rule, the organization becomes the company text, no owner, no label work, no account link', async () => {
  reset();
  const maple = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Maple Elementary', 'school')").run().lastInsertRowid);
  env.enable(db, false);
  try {
    assert.equal((await call('POST', '/api/crm/import/run', { batchName: 'x', rows: [{ email: 'a@school.org' }] }, boss)).status, 404, 'the Hub\'s own route is dark');
    const pv = await call('POST', `${BASE}/preview`, { rows: [{ email: 'org@school.org', name: 'Org Person', organization: 'Maple Elementary', city: 'Medina' }] }, rep);
    assert.equal(pv.status, 200); assert.equal(pv.json.rows[0].linksToAccount, false);
    const r = await run([{ email: 'org@school.org', name: 'Org Person', organization: 'Maple Elementary', city: 'Medina' }], rep);
    assert.equal(r.status, 201); assert.equal(r.json.counts.added, 1);
    const p = byEmail('org@school.org');
    assert.deepEqual([p.company, p.city, p.status, p.source, p.crm_source, p.assigned_admin_id], ['Maple Elementary', 'Medina', 'Unsubscribed', 'Bulk Import', null, null]);
    assert.equal(get('SELECT COUNT(*) AS n FROM crm_account_contacts WHERE account_id = ?', maple).n, 0, 'no account link with the Hub off');
    assert.equal((await call('GET', `${BASE}/batches`, undefined, viewer)).status, 200);
    assert.equal((await call('GET', `${BASE}/review`, undefined, viewer)).status, 200);
  } finally { env.enable(db, true); }
  const on = await run([{ email: 'org2@school.org', organization: 'Maple Elementary' }], rep);
  assert.equal(on.json.counts.added, 1);
  assert.equal(get('SELECT COUNT(*) AS n FROM crm_account_contacts WHERE account_id = ?', maple).n, 1, 'with the Hub on the exact organization still links');
});

test('ROLES: Read-only may read the history and the queue and nothing else; Sales and CRM Admin may import and decide; only a CRM Admin may undo; signed out is 401', async () => {
  reset();
  for (const [m, u] of [['POST', '/preview'], ['POST', '/run'], ['GET', '/review'], ['POST', '/review/1/resolve'], ['GET', '/batches'], ['POST', '/batches/1/undo-preview'], ['POST', '/batches/1/undo']]) assert.equal((await call(m, BASE + u, m === 'GET' ? undefined : {})).status, 401, `${m} ${u}`);
  assert.equal((await call('POST', `${BASE}/preview`, { rows: [FULL] }, viewer)).status, 403);
  assert.equal((await run([FULL], viewer)).status, 403);
  assert.equal((await call('GET', `${BASE}/batches`, undefined, viewer)).status, 200);
  assert.equal((await call('GET', `${BASE}/review`, undefined, viewer)).status, 200);
  const r = await run([FULL], rep, { createMissingGroups: true });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', `${BASE}/batches/${r.json.batchId}/undo-preview`, {}, rep)).status, 403);
  assert.equal((await call('POST', `${BASE}/batches/${r.json.batchId}/undo`, { confirm: true }, rep)).status, 403);
  assert.equal((await call('POST', `${BASE}/batches/${r.json.batchId}/undo-preview`, {}, boss)).status, 200);
  const src = read('server/routes/contact-screens.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.equal([...src.matchAll(/router\.(get|post)\('\/import\/[^']*', requireAuth, requireCrmRole\('(view|write|erase)'\), IH\.\w+\)/g)].length, 7, 'all seven import routes are guarded the same way');
});

test('THE REVIEW QUEUE keeps the rest of the row: a look-alike waits with its address, notes and groups, and "different person" or "same person" uses them', async () => {
  reset();
  const pat = env.addContact(db, 'pat@school.org', 'Pat Lee');
  db.prepare('INSERT INTO contact_groups (name) VALUES (?)').run('Teachers');
  // same mailbox once a +tag is removed: waits for a person to decide
  const row = { email: 'pat+spring@school.org', name: 'Pat Lee', street: '9 Elm', city: 'Albion', zip: '14411', notes: 'Spring list', source: 'Event', groups: 'Teachers|Nope', signupDate: '2026-02-01' };
  const r = await run([row], rep);
  assert.deepEqual([r.json.counts.added, r.json.counts.queued], [0, 1]);
  const q = (await call('GET', `${BASE}/review`, undefined, viewer)).json;
  assert.equal(q.total, 1); assert.deepEqual([q.items[0].row.street, q.items[0].row.city, q.items[0].row.groups], ['9 Elm', 'Albion', ['Teachers', 'Nope']]);
  const same = await call('POST', `${BASE}/review/${q.items[0].id}/resolve`, { action: 'same_person', contactId: pat }, rep);
  assert.equal(same.status, 200);
  const p = get('SELECT * FROM newsletter_contacts WHERE id = ?', pat);
  assert.deepEqual([p.street, p.city, p.zip, p.notes], ['9 Elm', 'Albion', '14411', 'Spring list'], 'blanks filled from the queued row');
  assert.deepEqual(groupsOf(pat), ['Teachers'], 'a group that does not exist is not made when deciding a queued row');
  // different person: added with everything
  const r2 = await run([{ ...row, email: 'pat+fall@school.org' }], rep);
  const q2 = (await call('GET', `${BASE}/review`, undefined, viewer)).json.items[0];
  const diff = await call('POST', `${BASE}/review/${q2.id}/resolve`, { action: 'different_person' }, rep);
  assert.equal(diff.status, 200);
  const np = byEmail('pat+fall@school.org');
  assert.deepEqual([np.street, np.city, np.source, np.status, np.assigned_admin_id], ['9 Elm', 'Albion', 'Event', 'Unsubscribed', rep]);
  assert.match(np.signup_date, /^2026-02-01/); assert.deepEqual(groupsOf(np.id), ['Teachers']);
  assert.equal(r2.status, 201);
});

test('A QUEUED ROW IS NOT LOST before the extra_json update has been run: the row still waits, without its extras', async () => {
  reset();
  db.exec('ALTER TABLE crm_import_review RENAME COLUMN extra_json TO extra_json_off');
  try {
    env.addContact(db, 'sam@school.org', 'Sam Rowe');
    const r = await run([{ email: 'sam+x@school.org', name: 'Sam Rowe', city: 'Albion' }], rep);
    assert.deepEqual([r.status, r.json.counts.queued], [201, 1]);
    const q = (await call('GET', `${BASE}/review`, undefined, viewer));
    assert.equal(q.status, 200); assert.equal(q.json.items[0].row.city, '', 'no extras, but the person is there');
  } finally { db.exec('ALTER TABLE crm_import_review RENAME COLUMN extra_json_off TO extra_json'); }
});

test('UNDO still works for a person imported with groups: the import\'s own groups do not keep them; a group added later does; the tags go with the person', async () => {
  reset();
  const r = await run([FULL, { email: 'second@school.org', name: 'Second Person', groups: 'Teachers' }], rep, { createMissingGroups: true });
  assert.equal(r.json.counts.added, 2);
  const second = byEmail('second@school.org').id;
  db.prepare('INSERT INTO contact_groups (name) VALUES (?)').run('Added Later');
  db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)').run(second, get("SELECT id FROM contact_groups WHERE name = 'Added Later'").id);
  const pv = await call('POST', `${BASE}/batches/${r.json.batchId}/undo-preview`, {}, boss);
  assert.deepEqual([pv.json.people, pv.json.removable, pv.json.kept], [2, 1, 1]);
  assert.deepEqual(pv.json.keptByReason.map(k => k.reason), ['in_group']);
  const u = await call('POST', `${BASE}/batches/${r.json.batchId}/undo`, { confirm: true }, boss);
  assert.deepEqual([u.json.removed, u.json.kept], [1, 1]);
  assert.equal(byEmail('jamie@school.org'), undefined, 'the untouched import person is gone');
  assert.equal(get('SELECT COUNT(*) AS n FROM contact_group_members WHERE contact_id = ?', second).n, 2, 'the kept person keeps their tags');
  assert.equal(all('SELECT * FROM contact_group_members WHERE contact_id NOT IN (SELECT id FROM newsletter_contacts)').length, 0, 'no orphaned tags');
  // editing an address after the import is a touch too
  reset();
  const r2 = await run([FULL], rep, { createMissingGroups: true });
  db.prepare("UPDATE newsletter_contacts SET city = 'Elsewhere' WHERE email = 'jamie@school.org'").run();
  assert.deepEqual((await call('POST', `${BASE}/batches/${r2.json.batchId}/undo-preview`, {}, boss)).json.keptByReason.map(k => k.reason), ['edited']);
});

test('THE PAGE: the importer is asked through the merged routes, reads every column, offers to create missing groups, and Import review and Imports show with the Hub off', () => {
  const page = read('admin-crm-contacts.html');
  for (const k of ['street:', 'city:', 'zip:', 'signupDate:', 'source:', 'notes:', 'groups:', 'createMissingGroups', 'ipMakeGroups', 'missingGroups', "'/api/admin/contacts/import/preview'", "'/api/admin/contacts/import/run'", 'groupsCreated']) assert.ok(page.includes(k), k);
  assert.doesNotMatch(page, /\/api\/crm\/import/);
  assert.match(page, /st\.view === 'duplicates'\) st\.view = 'list'/, 'only Possible duplicates is Hub-only');
  assert.ok(read('server/scripts/alter-add-import-review-extra.js').includes('information_schema.COLUMNS')); assert.match(read('server/db/schema.sql'), /extra_json TEXT NULL/);
  for (const f of ['lib/crm-import.js', 'lib/crm-import-http.js', 'lib/crm-import-undo.js', 'routes/crm-import.js', 'routes/contact-screens.js', 'scripts/alter-add-import-review-extra.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  for (const s of [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s));
});

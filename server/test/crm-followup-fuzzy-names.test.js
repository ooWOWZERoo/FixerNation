// Customer Hub follow-up: similar-name SUGGESTIONS for accounts and people. Nothing is ever linked, merged or added because two names look alike. Real routes and SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/import', R('crm-import.js')], ['/api/crm/accounts', R('crm-accounts.js')], ['/api/crm/quotes', R('crm-quotes.js')]]);
test.after(() => server.close());
const NM = require(path.join(env.SERVER, 'lib/crm-name-match.js'));
const I = require(path.join(env.SERVER, 'lib/crm-import.js'));

const admin = env.addAdmin(db, 'fzboss', 'admin'), sales = env.addAdmin(db, 'fzrep', 'sales'), viewer = env.addAdmin(db, 'fzviewer', 'readonly');
env.enable(db, true);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const acct = (name, f = {}) => Number(db.prepare('INSERT INTO crm_accounts (name, account_type, state, website_domain, archived_at) VALUES (?, ?, ?, ?, ?)').run(name, f.type || 'school', f.state || null, f.web || null, f.archived || null).lastInsertRowid);
const reset = () => db.exec('DELETE FROM crm_import_review; DELETE FROM crm_import_batches; DELETE FROM crm_account_contacts; DELETE FROM crm_opportunities; DELETE FROM crm_account_not_duplicates; DELETE FROM crm_accounts; DELETE FROM newsletter_contacts; DELETE FROM quote_requests; DELETE FROM school_audit_log; DELETE FROM crm_classification_events');
const like = (a, b, ra = {}, rb = {}) => NM.compare(NM.prepare({ id: 1, name: a, ...ra }), NM.prepare({ id: 2, name: b, ...rb }));
const snap = () => JSON.stringify(['crm_accounts', 'newsletter_contacts', 'crm_account_contacts', 'crm_opportunities'].map(t => all(`SELECT * FROM ${t} ORDER BY 1`)));

test('THE NAME RULES: same words in any order, short forms spelled out, one spelling slip, same type and state; never a different level, a different number, a different type or state, or two short words', () => {
  const yes = [['Lincoln Elementary', 'Lincoln Elementary School'], ['Lincoln Elementary', 'LINCOLN  ELEM.'], ['Maple Valley SD', 'Maple Valley School District'], ['Maple Valley ISD', 'The Maple Valley Independent School District'],
    ['St. Mary\'s Elementary', 'Saint Marys Elem'], ['Smith & Jones Academy', 'Jones and Smith Academy'], ['Washington Elementary', 'Washingtn Elementary'], ['Éclair Middle School', 'Eclair Middle'], ['Maple', 'Maple Elementary']];
  for (const [a, b] of yes) assert.ok(like(a, b), `${a} / ${b}`);
  const no = [['Maple Elementary', 'Maple High School'], ['Maple Elementary', 'Maple Middle'], ['Lincoln 2', 'Lincoln 3'], ['Oak A', 'Oak B'], ['Oak Valley', 'Oak Hill'], ['Jackson Elementary', 'Johnson Elementary'], ['Maple School District', 'Maple High'], ['Ab', 'Ab'], ['', 'Maple Elementary']];
  for (const [a, b] of no) assert.equal(like(a, b), null, `${a} / ${b}`);
  assert.equal(like('Maple Elementary', 'Maple Elementary', { accountType: 'school' }, { accountType: 'district' }), null, 'a school is never a district');
  assert.ok(like('Maple Elementary', 'Maple Elem', { accountType: 'school' }, { accountType: 'school' }));
  assert.equal(like('Maple Elementary', 'Maple Elementary', { state: 'PA' }, { state: 'Ohio' }), null, 'two states');
  assert.ok(like('Maple Elementary', 'Maple Elementary', { state: 'PA' }, { state: 'Pennsylvania' }), 'PA is Pennsylvania');
  assert.ok(like('Maple Elementary', 'Maple Elementary', { state: 'PA' }, {}), 'a blank state matches any');
  assert.equal(NM.compare(NM.prepare({ id: 5, name: 'Maple Elementary' }), NM.prepare({ id: 5, name: 'Maple Elementary' })), null, 'an account is not like itself');
  assert.equal(like('Maple Elementary', 'Maple Elementary').reason, 'same_words'); assert.equal(like('Washington Elementary', 'Washingtn Elementary').reason, 'close_spelling');
});

test('SUGGESTIONS: best first, at most the limit, never the excluded ones; a person: one letter off with the same last word, never a one-word name', () => {
  const list = ['Maple Elementary', 'Maple Elem School', 'Maplle Elementary', 'Oak Elementary'].map((name, i) => NM.prepare({ id: i + 1, name }));
  const s = NM.suggestFor({ name: 'Maple Elementary' }, list, { limit: 2, excludeIds: [1] });
  assert.deepEqual(s.map(x => x.id), [2, 3], 'same words first, then the spelling slip');
  assert.equal(NM.suggestFor({ name: 'Ab' }, list).length, 0);
  assert.ok(NM.similarPersonName('Jon Smith', 'John Smith')); assert.ok(!NM.similarPersonName('Jon Smith', 'Jon Smythe')); assert.ok(!NM.similarPersonName('Smith', 'Smyth')); assert.ok(!NM.similarPersonName('Ann Lee', 'Ann Lee'));
});

test('DUPLICATES TAB: accounts with like names are listed as "similar names", a pair already listed for its website is not listed twice, nothing changes, and "not a duplicate" removes the pair', async () => {
  reset();
  const a = acct('Lincoln Elementary', { state: 'PA' }), b = acct('Lincoln Elem School', { state: 'PA' }), c = acct('Lincoln Elementary', { state: 'OH' });
  const d = acct('Maple Elementary', { web: 'maple.example.org' }), e = acct('Maple Elem', { web: 'www.maple.example.org' });
  const f = acct('Oak A'), g = acct('Oak B'), h = acct('Maple High'), i = acct('Lincoln Elementary', { archived: '2026-01-01 00:00:00' });
  const before = snap();
  const r = await call('GET', '/api/crm/accounts/review/duplicates', undefined, viewer);
  assert.equal(r.status, 200);
  const ids = (g2) => g2.accounts.map(x => x.id).sort((x, y) => x - y);
  const names = r.json.groups.filter(x => x.reason === 'similar_name'), web = r.json.groups.filter(x => x.reason === 'website');
  assert.deepEqual(names.map(ids), [[a, b]], 'Lincoln PA twice; the Ohio one, Oak A and B, Maple High and the archived one are not like them');
  assert.deepEqual(web.map(ids), [[d, e]], 'the two Maples share a website: listed once, for that');
  assert.equal(names[0].domain, null);
  assert.equal(snap(), before, 'read only');
  assert.equal((await call('POST', '/api/crm/accounts/review/not-duplicates', { accountIds: [a, b] }, sales)).status, 201);
  assert.equal((await call('GET', '/api/crm/accounts/review/duplicates', undefined, viewer)).json.groups.filter(x => x.reason === 'similar_name').length, 0, 'a remembered pair is not suggested again');
  void [c, f, g, h, i];
});

test('A SIMILAR-NAME GROUP: A like B and B like C does not make A like C, so marking A-B separate leaves B-C and not A-C', async () => {
  reset();
  const a = acct('Maplewood Elementary'), b = acct('Maplewod Elementary'), c = acct('Maplewd Elementary'); // each one slip from the next; a and c are two slips apart (not alike)
  const r = await call('GET', '/api/crm/accounts/review/duplicates', undefined, viewer);
  const g1 = r.json.groups.find(x => x.reason === 'similar_name'); assert.ok(g1);
  assert.equal(NM.compare(NM.prepare({ id: 1, name: 'Maplewood Elementary' }), NM.prepare({ id: 3, name: 'Maplewd Elementary' })), null);
  assert.deepEqual(g1.accounts.map(x => x.id).sort((x, y) => x - y), [a, b, c]);
  await call('POST', '/api/crm/accounts/review/not-duplicates', { accountIds: [a, b] }, sales);
  const g2 = (await call('GET', '/api/crm/accounts/review/duplicates', undefined, viewer)).json.groups.filter(x => x.reason === 'similar_name');
  assert.equal(g2.length, 1); assert.deepEqual(g2[0].accounts.map(x => x.id).sort((x, y) => x - y), [b, c], 'only B and C are still alike; A is not pulled in through B');
});

test('CREATING AN ACCOUNT: a like name is a warning you can go past; the same name still asks too; a different level or state does not warn', async () => {
  reset();
  const a = acct('Lincoln Elementary', { state: 'PA' });
  const warn = await call('POST', '/api/crm/accounts', { name: 'Lincoln Elem School', accountType: 'school', state: 'PA' }, admin);
  assert.equal(warn.status, 409); assert.equal(warn.json.code, 'possible_duplicate'); assert.equal(warn.json.kind, 'similar_name'); assert.equal(warn.json.existingAccountId, a);
  assert.deepEqual(warn.json.similarAccounts.map(x => x.id), [a]); assert.match(warn.json.error, / Open it, or send allowDuplicate to create another\.$/, 'the accounts page strips this ending');
  assert.equal((await call('POST', '/api/crm/accounts', { name: 'Lincoln Elem School', accountType: 'school', state: 'PA', allowDuplicate: true }, admin)).status, 201);
  const same = await call('POST', '/api/crm/accounts', { name: 'lincoln elementary', accountType: 'school', state: 'PA' }, admin);
  assert.equal(same.status, 409); assert.equal(same.json.kind, 'same_name');
  assert.equal((await call('POST', '/api/crm/accounts', { name: 'Lincoln High', accountType: 'school', state: 'PA' }, admin)).status, 201);
  assert.equal((await call('POST', '/api/crm/accounts', { name: 'Lincoln Elem', accountType: 'school', state: 'Ohio' }, admin)).status, 201, 'another state: a different school');
});

test('MAKING A DEAL FROM A QUOTE: a like account name is pointed out once and "make it anyway" (allowDuplicate) goes ahead; the same name is still refused; nothing is linked by a guess', async () => {
  reset();
  const existing = acct('Maple Valley Elementary');
  const q = env.addQuote(db, 'someone@maple-valley.test', { school: 'Maple Valley Elem School' });
  const warn = await call('POST', `/api/crm/quotes/${q}/create-deal`, { createAccount: true }, admin);
  assert.equal(warn.status, 409); assert.equal(warn.json.kind, 'similar_name'); assert.equal(warn.json.existingAccountId, existing);
  assert.equal(get('SELECT opportunity_id FROM quote_requests WHERE id = ?', q).opportunity_id, null, 'nothing was linked on a warning');
  assert.equal(all('SELECT id FROM crm_accounts').length, 1, 'and no account was made');
  const go = await call('POST', `/api/crm/quotes/${q}/create-deal`, { createAccount: true, allowDuplicate: true }, admin);
  assert.equal(go.status, 201); assert.equal(go.json.createdAccount, true); assert.equal(all('SELECT id FROM crm_accounts').length, 2);
  const q2 = env.addQuote(db, 'two@maple-valley.test', { school: 'maple   valley elementary' });
  const exact = await call('POST', `/api/crm/quotes/${q2}/create-deal`, { createAccount: true, allowDuplicate: true }, admin);
  assert.equal(exact.status, 409); assert.equal(exact.json.kind, 'same_name', 'the exact name is still refused even with allowDuplicate');
});

test('THE IMPORT: an organization with no exact match is offered look-alikes; it is linked only when a person picked one of them; an id that is not a suggestion links nothing; an exact name still links by itself; no account is ever made', async () => {
  reset();
  const exact = acct('Maple Elementary', { state: 'PA' }), alike = acct('Oak Valley Elementary', { state: 'PA' }), other = acct('Birch Hill High');
  const rows = [
    { email: 'a1@school.org', name: 'Ann One', organization: 'maple elementary' },                 // exact
    { email: 'a2@school.org', name: 'Bo Two', organization: 'Oak Valley Elem School', state: 'PA' }, // like
    { email: 'a3@school.org', name: 'Cy Three', organization: 'Oak Valley Elem School', state: 'PA', pickedAccountId: alike }, // picked
    { email: 'a4@school.org', name: 'Di Four', organization: 'Oak Valley Elem School', state: 'PA', pickedAccountId: other },  // an id that is not a suggestion
    { email: 'a5@school.org', name: 'Ed Five', organization: 'Oak Valley Elem School', state: 'Ohio', pickedAccountId: alike }, // like, but another state: not suggested, so the pick is ignored
  ];
  const before = snap();
  const p = (await call('POST', '/api/crm/import/preview', { rows }, sales)).json;
  assert.equal(snap(), before, 'a preview writes nothing');
  assert.equal(p.rows[0].linksToAccount, true); assert.deepEqual(p.rows[0].suggestedAccounts, []);
  assert.equal(p.rows[1].linksToAccount, false); assert.deepEqual(p.rows[1].suggestedAccounts.map(x => x.id), [alike]); assert.match(p.rows[1].accountNote, /Pick one of the similar accounts/);
  assert.equal(p.rows[2].linksToAccount, true); assert.equal(p.rows[2].pickedAccountId, alike);
  assert.equal(p.rows[3].linksToAccount, false, 'another account\'s id is not a pick'); assert.equal(p.rows[3].pickedAccountId, null);
  assert.equal(p.rows[4].linksToAccount, false); assert.deepEqual(p.rows[4].suggestedAccounts, []);
  const run = await call('POST', '/api/crm/import/run', { batchName: 'Names', rows }, sales);
  assert.equal(run.status, 201);
  const placed = all('SELECT c.email, ac.account_id FROM crm_account_contacts ac JOIN newsletter_contacts c ON c.id = ac.contact_id ORDER BY c.email').map(r => [r.email, r.account_id]);
  assert.deepEqual(placed, [['a1@school.org', exact], ['a3@school.org', alike]], 'only the exact name and the picked suggestion were linked');
  assert.equal(all('SELECT id FROM crm_accounts').length, 3, 'an import never makes an account');
});

test('THE IMPORT, PEOPLE: a full name one letter off someone already here (same last word) waits for review; it is never added by itself, never merged; a one-word name and a different last name do not', async () => {
  reset();
  const john = env.addContact(db, 'john.smith@elsewhere.org', 'John Smith'); env.addContact(db, 'amy.lee@elsewhere.org', 'Amy Lee');
  const rows = [{ email: 'jon@school.org', name: 'Jon Smith' }, { email: 'joan@school.org', name: 'Joan Smythe' }, { email: 'am@school.org', name: 'Amy Leigh' }, { email: 'smith@school.org', name: 'Smith' }];
  const p = (await call('POST', '/api/crm/import/preview', { rows }, sales)).json;
  assert.deepEqual(p.rows.map(r => r.decision), ['review', 'new', 'new', 'new']);
  assert.equal(p.rows[0].candidates[0].reason, 'similar_name');
  const before = get('SELECT name, email, company FROM newsletter_contacts WHERE id = ?', john);
  const run = await call('POST', '/api/crm/import/run', { batchName: 'People', rows }, sales);
  assert.equal(run.json.counts.queued, 1); assert.equal(run.json.counts.added, 3);
  assert.equal(all('SELECT id FROM newsletter_contacts WHERE email = ?', 'jon@school.org').length, 0, 'not added');
  assert.deepEqual({ ...get('SELECT name, email, company FROM newsletter_contacts WHERE id = ?', john) }, { ...before }, 'John Smith is untouched');
  const q = all('SELECT reason FROM crm_import_review'); assert.deepEqual(q.map(x => x.reason), ['similar_name']);
  const list = (await call('GET', '/api/crm/import/review', undefined, viewer)).json;
  assert.equal(list.items[0].reason, 'similar_name');
});

test('FILES AND PAGES: the lib is pure (no database, no writes, no new dependency); the pages escape what they show; the import never creates an account; the code parses', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const lib = read('lib/crm-name-match.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(lib, /require\(|\.query\(|INSERT|UPDATE|DELETE/, 'pure JavaScript');
  assert.doesNotMatch(read('lib/crm-import.js').replace(/\/\/.*$/gm, ''), /INSERT INTO crm_accounts/);
  assert.doesNotMatch(read('package.json'), /levenshtein|string-similarity|fuse\.js|fuzzy/i);
  const contacts = read('../admin-crm-contacts.html'), accounts = read('../admin-crm-accounts.html'), overview = read('../admin-crm-overview.html');
  assert.match(contacts, /esc\(a\.name\)/); assert.match(contacts, /data-pick-row="/); assert.match(contacts, /esc\(r\.organization\)/);
  assert.match(accounts, /similar_name/); assert.match(overview, /makeAnyway/); assert.match(overview, /kind === 'similar_name'/);
  for (const f of ['lib/crm-name-match.js', 'lib/crm-import.js', 'lib/crm-account-rollups.js', 'routes/crm-accounts.js', 'routes/crm-quotes.js', 'routes/crm-import.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  for (const f of ['../admin-crm-contacts.html', '../admin-crm-accounts.html', '../admin-crm-overview.html']) for (const s of [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s), f);
  assert.ok(I.plan);
});

// Merged Contacts screen, phase 2 (docs/reference/contact-pages-merge-requirements.md): the list with server paging and the older page's filters and sorts, the Customer Hub
// working with its switch off (decision D7), groups, the subscribe toggle, resend verification, delete (every rule kept), the CSV export, and the page that uses them.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['first_name TEXT', 'last_name TEXT', 'role TEXT', 'email_verified INTEGER DEFAULT 0', 'is_fne_staff INTEGER DEFAULT 0']) db.exec(`ALTER TABLE site_users ADD COLUMN ${col}`);
env.install(pool, { [path.join(env.SERVER, 'lib/site-tokens.js')]: { createToken: async () => 'tok' } });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/admin/contacts', R('contact-screens.js')], ['/api/crm/contacts', R('crm-contacts.js')]]);
test.after(() => server.close());

const boss = env.addAdmin(db, 'listboss', 'admin'), rep = env.addAdmin(db, 'listrep', 'sales'), viewer = env.addAdmin(db, 'listviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const audits = (action) => db.prepare('SELECT * FROM school_audit_log WHERE action = ?').all(action);
const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');

let n = 0;
function person(f = {}) {
  n++;
  const email = f.email || `lp${n}-${Math.random().toString(36).slice(2, 6)}@school${n}.org`;
  const id = env.addContact(db, email, f.name === undefined ? `Person ${n}` : f.name, { status: f.status });
  db.prepare('UPDATE newsletter_contacts SET phone = ?, company = ?, street = ?, city = ?, state = ?, zip = ?, source = ?, signup_date = ?, notes = ? WHERE id = ?')
    .run(f.phone || null, f.company || null, f.street || null, f.city || null, f.state || null, f.zip || null, f.source || 'Homepage', f.signup || '2026-03-01 00:00:00', f.notes || null, id);
  return id;
}
function group(name, system) { return Number(db.prepare('INSERT INTO contact_groups (name, system_key) VALUES (?, ?)').run(name, system || null).lastInsertRowid); }
const join = (c, g) => db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)').run(c, g);
function account(email, f = {}) {
  const r = db.prepare('INSERT INTO site_users (email, first_name, last_name, role, email_verified, is_fne_staff) VALUES (?, ?, ?, ?, ?, ?)').run(email, f.first || 'Pat', f.last || 'Lee', f.role || 'teacher', f.verified ? 1 : 0, f.staff ? 1 : 0);
  for (const a of f.audiences || []) db.prepare('INSERT INTO site_user_audiences (site_user_id, audience) VALUES (?, ?)').run(r.lastInsertRowid, a);
  return Number(r.lastInsertRowid);
}
const list = (q, who = viewer) => call('GET', '/api/admin/contacts' + (q ? '?' + q : ''), undefined, who);
const names = (r) => r.json.contacts.map(c => c.name);

// A small, known set of people for the filter and sort tests.
const gTeachers = group('Teachers Spring'), gOrleans = group('Orleans County');
const alice = person({ name: 'Alice Adams', company: 'Zephyr Elementary', phone: '716-555-0101', source: 'Event', status: 'Subscribed', signup: '2026-01-05 00:00:00', street: '1 Oak St', city: 'Medina', state: 'NY', zip: '14103', notes: 'Met at the conference' });
const bob = person({ name: 'Bob Brown', company: 'Acme Middle', phone: '585-555-0202', source: 'Homepage', status: 'Unsubscribed', signup: '2026-02-05 00:00:00' });
const cara = person({ name: 'Cara Cole', company: 'Mid High School', phone: '315-555-0303', source: 'Event', status: 'Subscribed', signup: '2026-04-05 00:00:00' });
join(alice, gTeachers); join(alice, gOrleans); join(bob, gOrleans);
const aliceEmail = get('SELECT email FROM newsletter_contacts WHERE id = ?', alice).email;
const caraEmail = get('SELECT email FROM newsletter_contacts WHERE id = ?', cara).email;
account(aliceEmail, { role: 'teacher', verified: true, audiences: ['High School', 'Elementary School'] });
account(caraEmail, { role: 'school_license_admin', verified: false, audiences: ['Middle School'] });

test('ACCESS: every route in the merged screen is (path, requireAuth, requireCrmRole(action)), and the file is not a crm-* file (those answer 404 with the Hub off)', () => {
  const src = read('server/routes/contact-screens.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const all = [...src.matchAll(/\brouter\.(get|post|put|patch|delete|all)\(/g)];
  const guarded = [...src.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*'[^']*'\s*,\s*requireAuth\s*,\s*requireCrmRole\('[a-z_]+'\)/g)];
  assert.ok(all.length >= 10, `${all.length} routes`);
  assert.equal(guarded.length, all.length, 'every route names requireAuth then requireCrmRole(action)');
  assert.doesNotMatch(src, /requireCrm\(/, 'requireCrm answers 404 with the Hub off');
  assert.match(read('server/app.js'), /app\.use\('\/api\/admin\/contacts', require\('\.\/routes\/contact-screens'\)\)/);
  assert.ok(!fs.existsSync(path.join(env.SERVER, 'routes', 'crm-contact-screens.js')));
});

test('SIGNED OUT: every route answers 401', async () => {
  for (const [m, u] of [['GET', ''], ['GET', '/access'], ['GET', '/facets'], ['GET', '/export'], ['GET', '/groups'], ['POST', '/groups'], ['DELETE', '/groups/1'], ['PUT', '/1/subscription'], ['POST', '/1/resend-verification'], ['DELETE', '/1']]) {
    const r = await call(m, '/api/admin/contacts' + u, m === 'GET' ? undefined : {});
    assert.equal(r.status, 401, `${m} ${u}`);
  }
});

test('HUB OFF: the merged screen still answers (list, who-am-I, filters, groups) while the Hub routes answer 404; the roles still count', async () => {
  env.enable(db, false);
  try {
    const me = await call('GET', '/api/admin/contacts/access', undefined, rep);
    assert.equal(me.status, 200); assert.equal(me.json.hubEnabled, false); assert.equal(me.json.role, 'sales'); assert.equal(me.json.permissions.write, true); assert.equal(me.json.permissions.export, false);
    assert.equal((await list('', rep)).status, 200);
    assert.equal((await call('GET', '/api/admin/contacts/facets', undefined, viewer)).status, 200);
    assert.equal((await call('POST', '/api/admin/contacts/groups', { name: 'Off switch group' }, rep)).status, 201);
    assert.equal((await call('POST', '/api/admin/contacts/groups', { name: 'Nope' }, viewer)).status, 403, 'Read-only still cannot write with the Hub off');
    assert.equal((await call('GET', '/api/crm/contacts', undefined, boss)).status, 404, 'the Hub list is dark');
  } finally { env.enable(db, true); }
  assert.equal((await call('GET', '/api/admin/contacts/access', undefined, boss)).json.hubEnabled, true);
});

test('ROLES: Read-only looks only; Sales edits groups, subscriptions and resends but cannot export or delete; a CRM Admin does everything', async () => {
  const p = person();
  assert.equal((await call('PUT', `/api/admin/contacts/${p}/subscription`, { status: 'Unsubscribed' }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/admin/contacts/${p}/resend-verification`, {}, viewer)).status, 403);
  assert.equal((await call('DELETE', `/api/admin/contacts/${p}`, {}, viewer)).status, 403);
  assert.equal((await call('GET', '/api/admin/contacts/export', undefined, viewer)).status, 403);
  assert.equal((await call('PUT', `/api/admin/contacts/${p}/subscription`, { status: 'Unsubscribed' }, rep)).status, 200);
  assert.equal((await call('DELETE', `/api/admin/contacts/${p}`, {}, rep)).status, 403, 'Sales cannot delete a contact');
  assert.equal((await call('GET', '/api/admin/contacts/export', undefined, rep)).status, 403, 'Sales cannot export');
  assert.equal((await call('GET', '/api/admin/contacts/export', undefined, boss)).status, 200);
  assert.equal((await call('DELETE', `/api/admin/contacts/${p}`, {}, boss)).status, 200);
  assert.equal(get('SELECT id FROM newsletter_contacts WHERE id = ?', p), undefined);
});

test('LIST: one page at a time from the server, with the total, the cards and every column the older page showed; no notes and no test addresses', async () => {
  for (let i = 0; i < 7; i++) person({ name: `Filler ${i}` });
  person({ email: 'qa-tester@example.com', name: 'QA Tester' });
  const r = await list('pageSize=5&page=2&sort=name&dir=asc');
  assert.equal(r.status, 200);
  assert.equal(r.json.contacts.length, 5); assert.equal(r.json.pageSize, 5); assert.equal(r.json.page, 2); assert.ok(r.json.total >= 10);
  assert.ok(!names(r).includes('QA Tester'), 'test addresses are left out by default');
  assert.ok((await list('includeTest=true&q=QA%20Tester')).json.contacts.length === 1, 'and come back when asked for');
  const one = (await list('q=Alice%20Adams')).json.contacts[0];
  assert.deepEqual(one.address, { street: '1 Oak St', city: 'Medina', state: 'NY', zip: '14103' });
  assert.deepEqual(one.groups.map(g => g.name), ['Orleans County', 'Teachers Spring']);
  assert.deepEqual([one.phone, one.company, one.source, one.status, one.role, one.hasAccount, one.accountVerified], ['716-555-0101', 'Zephyr Elementary', 'Event', 'Subscribed', 'teacher', true, true]);
  assert.deepEqual(one.gradeLevels, ['Elementary School', 'High School'], 'grade levels come back in school order');
  assert.equal(one.notes, undefined, 'the list never carries a person\'s notes');
  assert.equal(one.classification, 'suspect');
  assert.equal(typeof r.json.stats.total, 'number'); assert.ok(r.json.stats.subscribed >= 2); assert.ok(r.json.stats.thisWeek >= 0);
  const noAccount = (await list('q=Bob%20Brown')).json.contacts[0];
  assert.deepEqual([noAccount.hasAccount, noAccount.role, noAccount.gradeLevels], [false, null, []]);
});

test('SEARCH: name, email, phone and company; a * or ? makes it a whole-field wildcard like the older page; typed % and _ are literal', async () => {
  assert.deepEqual(names(await list('q=zephyr')), ['Alice Adams'], 'company');
  assert.deepEqual(names(await list('q=585-555')), ['Bob Brown'], 'phone');
  assert.deepEqual(names(await list(`q=${encodeURIComponent(caraEmail.slice(0, 6))}`)), ['Cara Cole'], 'email');
  assert.deepEqual(names(await list('q=Bob*')), ['Bob Brown'], 'the whole field starts with Bob');
  assert.deepEqual(names(await list('q=Zephyr')), ['Alice Adams']);
  assert.deepEqual(names(await list('q=Bo%3F%20Brown')), ['Bob Brown'], '? is one letter');
  assert.equal((await list('q=ephyr*')).json.contacts.length, 0, 'a wildcard search must match the whole field, so a leading part that is not there finds nothing');
  assert.equal((await list('q=%25')).json.contacts.length, 0, 'a typed % matches only a real % ');
  assert.equal((await list('q=nobody-by-this-name')).json.total, 0);
});

test('FILTERS: email group, subscription status, source and Customer Hub label, alone and together', async () => {
  assert.deepEqual(names(await list(`group=${gTeachers}`)), ['Alice Adams']);
  assert.deepEqual(names(await list(`group=${gOrleans}&sort=name&dir=asc`)), ['Alice Adams', 'Bob Brown']);
  assert.deepEqual(names(await list(`group=${gOrleans}&status=Unsubscribed`)), ['Bob Brown']);
  assert.ok(!names(await list('status=Unsubscribed')).includes('Alice Adams'));
  assert.deepEqual(names(await list('source=Event&sort=name&dir=asc')).filter(x => ['Alice Adams', 'Cara Cole', 'Bob Brown'].includes(x)), ['Alice Adams', 'Cara Cole']);
  assert.deepEqual(names(await list('source=Event&status=Subscribed&q=Cara')), ['Cara Cole']);
  assert.equal((await list('status=Bounced')).json.total, (await list('')).json.total, 'a status that is not one of the two is no filter');
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'prospect' WHERE id = ?").run(cara);
  assert.deepEqual(names(await list('classification=prospect')), ['Cara Cole']);
  assert.equal((await list('classification=hot')).json.total, (await list('')).json.total, 'only Suspect, Prospect and Customer exist');
  db.prepare("UPDATE newsletter_contacts SET crm_classification = 'suspect' WHERE id = ?").run(cara);
});

test('SORT: name, email, company, source, status, signed up, role and grade levels, both ways; an unknown sort is ignored', async () => {
  const three = (q) => list(q + '&q=a').then(r => names(r).filter(x => ['Alice Adams', 'Bob Brown', 'Cara Cole'].includes(x)));
  assert.deepEqual(await three('sort=name&dir=asc'), ['Alice Adams', 'Bob Brown', 'Cara Cole']);
  assert.deepEqual(await three('sort=name&dir=desc'), ['Cara Cole', 'Bob Brown', 'Alice Adams']);
  assert.deepEqual(await three('sort=company&dir=asc'), ['Bob Brown', 'Cara Cole', 'Alice Adams'], 'Acme, Mid, Zephyr');
  assert.deepEqual(await three('sort=signup&dir=desc'), ['Cara Cole', 'Bob Brown', 'Alice Adams']);
  assert.deepEqual(await three('sort=status&dir=asc'), ['Alice Adams', 'Cara Cole', 'Bob Brown'], 'Subscribed, then Unsubscribed');
  assert.deepEqual(await three('sort=role&dir=asc'), ['Bob Brown', 'Cara Cole', 'Alice Adams'], 'no account (blank), school_license_admin, teacher');
  assert.deepEqual(await three('sort=source&dir=asc'), ['Alice Adams', 'Cara Cole', 'Bob Brown'], 'Event, Event, Homepage');
  assert.deepEqual(await three('sort=grade&dir=asc'), ['Bob Brown', 'Alice Adams', 'Cara Cole'], 'none, then elementary (lowest), then middle');
  assert.deepEqual(await three('sort=grade&dir=desc'), ['Cara Cole', 'Alice Adams', 'Bob Brown']);
  assert.equal((await list('sort=password_hash')).status, 200, 'an unknown sort falls back to the default instead of reaching the SQL');
  assert.equal((await list('sort=email&dir=asc')).status, 200);
  assert.equal((await list('sort=source&dir=asc')).status, 200);
});

test('FACETS: every group with its head count, and every source in use', async () => {
  const f = (await call('GET', '/api/admin/contacts/facets', undefined, viewer)).json;
  const orleans = f.groups.find(g => g.name === 'Orleans County');
  assert.equal(orleans.memberCount, 2);
  assert.ok(f.sources.includes('Event') && f.sources.includes('Homepage'));
  assert.deepEqual(f.sources, [...f.sources].sort());
});

test('GROUPS: add, a repeat name is refused, delete; a built-in group cannot be deleted; each change is audited without a name', async () => {
  const add = await call('POST', '/api/admin/contacts/groups', { name: '  Spring 2027  ' }, rep);
  assert.equal(add.status, 201); assert.equal(add.json.group.name, 'Spring 2027');
  assert.equal((await call('POST', '/api/admin/contacts/groups', { name: 'Spring 2027' }, rep)).status, 409);
  assert.equal((await call('POST', '/api/admin/contacts/groups', { name: '   ' }, rep)).status, 400);
  assert.equal((await call('POST', '/api/admin/contacts/groups', { name: ['x'] }, rep)).status, 400, 'typeof checked: an array is not a name');
  const sys = group('Teachers', 'teachers');
  const refused = await call('DELETE', `/api/admin/contacts/groups/${sys}`, {}, rep);
  assert.equal(refused.status, 409); assert.equal(refused.json.code, 'system_group');
  assert.ok(get('SELECT id FROM contact_groups WHERE id = ?', sys));
  assert.equal((await call('DELETE', `/api/admin/contacts/groups/${add.json.group.id}`, {}, rep)).status, 200);
  assert.equal((await call('DELETE', `/api/admin/contacts/groups/${add.json.group.id}`, {}, rep)).status, 404);
  assert.ok(audits('crm_contact_group_created').length >= 1 && audits('crm_contact_group_deleted').length >= 1);
  assert.ok(audits('crm_contact_group_created').every(a => !/Spring/.test(JSON.stringify(a))), 'no group name in the audit log');
});

test('SUBSCRIBE TOGGLE: only Subscribed or Unsubscribed; unchanged writes nothing; a change is audited', async () => {
  const p = person({ status: 'Subscribed' });
  assert.equal((await call('PUT', `/api/admin/contacts/${p}/subscription`, { status: 'Bounced' }, rep)).status, 400);
  assert.equal((await call('PUT', `/api/admin/contacts/${p}/subscription`, {}, rep)).status, 400);
  assert.equal((await call('PUT', '/api/admin/contacts/99999/subscription', { status: 'Unsubscribed' }, rep)).status, 404);
  const before = audits('crm_contact_subscription_changed').length;
  const r = await call('PUT', `/api/admin/contacts/${p}/subscription`, { status: 'Unsubscribed' }, rep);
  assert.deepEqual([r.status, r.json.changed], [200, true]);
  assert.equal(get('SELECT status FROM newsletter_contacts WHERE id = ?', p).status, 'Unsubscribed');
  assert.equal(audits('crm_contact_subscription_changed').length, before + 1);
  const again = await call('PUT', `/api/admin/contacts/${p}/subscription`, { status: 'Unsubscribed' }, rep);
  assert.equal(again.json.changed, false); assert.equal(audits('crm_contact_subscription_changed').length, before + 1);
  assert.equal((await call('PUT', `/api/admin/contacts/${p}/subscription`, { status: 'Subscribed' }, rep)).status, 200);
});

test('RESEND VERIFICATION: no account, already verified, and the one that sends', async () => {
  const none = person();
  assert.equal((await call('POST', `/api/admin/contacts/${none}/resend-verification`, {}, rep)).status, 404);
  assert.equal((await call('POST', `/api/admin/contacts/${alice}/resend-verification`, {}, rep)).status, 400, 'Alice is verified');
  const ok = await call('POST', `/api/admin/contacts/${cara}/resend-verification`, {}, rep);
  assert.deepEqual([ok.status, ok.json.ok], [200, true]);
  assert.equal((await call('POST', '/api/admin/contacts/99999/resend-verification', {}, rep)).status, 404);
});

test('DELETE: a buyer, a person on a deal, a staff account and CRM notes are all refused as on the older page; a CRM Admin can erase the notes with the person; a plain contact goes and is audited', async () => {
  const buyer = person(); env.addPurchase(db, buyer);
  const b = await call('DELETE', `/api/admin/contacts/${buyer}`, {}, boss);
  assert.deepEqual([b.status, b.json.code], [409, 'contact_owns_purchases']);
  assert.ok(get('SELECT id FROM newsletter_contacts WHERE id = ?', buyer), 'still there');

  const staff = person(); account(get('SELECT email FROM newsletter_contacts WHERE id = ?', staff).email, { role: 'admin' });
  assert.equal((await call('DELETE', `/api/admin/contacts/${staff}`, {}, boss)).json.code, 'staff_account');

  const acct = db.prepare("INSERT INTO crm_accounts (name) VALUES ('Some School')").run().lastInsertRowid;
  const stage = get('SELECT id FROM crm_pipeline_stages LIMIT 1').id;
  const onDeal = person();
  const opp = db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, primary_contact_id) VALUES (?, 'A deal', ?, ?)").run(acct, stage, onDeal).lastInsertRowid;
  assert.equal((await call('DELETE', `/api/admin/contacts/${onDeal}`, {}, boss)).json.code, 'contact_on_deals');
  db.prepare('UPDATE crm_opportunities SET primary_contact_id = NULL WHERE id = ?').run(opp);

  const withNotes = person();
  db.prepare("INSERT INTO crm_notes (contact_id, body) VALUES (?, 'Called about the pilot')").run(withNotes);
  const refused = await call('DELETE', `/api/admin/contacts/${withNotes}`, {}, boss);
  assert.deepEqual([refused.status, refused.json.code, refused.json.items], [409, 'contact_has_crm_items', 1]);
  const erased = await call('DELETE', `/api/admin/contacts/${withNotes}`, { confirmEraseCrmItems: true }, boss);
  assert.deepEqual([erased.status, erased.json.erasedItems], [200, 1]);
  assert.equal(get('SELECT COUNT(*) AS n FROM crm_notes WHERE contact_id = ?', withNotes).n, 0);

  const plain = person();
  const done = await call('DELETE', `/api/admin/contacts/${plain}`, {}, boss);
  assert.deepEqual([done.status, done.json.ok, done.json.accountClosed], [200, true, false]);
  assert.ok(audits('crm_contact_deleted').some(a => a.entity_id === plain));
  assert.ok(audits('crm_contact_deleted').every(a => !/@/.test(`${a.prev_value || ''}${a.new_value || ''}${a.reason || ''}`)), 'no contact email in what the audit row records');
  assert.equal((await call('DELETE', `/api/admin/contacts/${plain}`, {}, boss)).status, 404);
  assert.equal((await call('DELETE', '/api/admin/contacts/abc', {}, boss)).status, 404);
});

test('EXPORT: the older page\'s 14 columns, everyone matching the filters (not one page), CRM Admin only, audited with the filter names and a count', async () => {
  const r = await new Promise((resolve, reject) => {
    const http = require('node:http');
    const port = server.address().port;
    http.get({ port, path: `/api/admin/contacts/export?group=${gOrleans}&sort=name&dir=asc&pageSize=1&page=2`, headers: { 'x-admin': String(boss) } }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); }).on('error', reject);
  });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/csv/); assert.match(r.headers['content-disposition'], /attachment; filename="fixer-nation-newsletter-contacts\.csv"/);
  const lines = r.body.split('\n');
  assert.equal(lines[0], '"Name","Email","Phone","Company","Street","City","State","Zip","Signup Date","Source","Status","Groups","Grade Levels","Notes"');
  assert.equal(lines.length, 3, 'a header and BOTH people in the group, whatever page the screen was on');
  assert.match(lines[1], /^"Alice Adams","[^"]+","716-555-0101","Zephyr Elementary","1 Oak St","Medina","NY","14103","2026-01-05","Event","Subscribed","Orleans County; Teachers Spring","ES; HS","Met at the conference"$/);
  assert.match(lines[2], /^"Bob Brown",/); assert.equal(r.headers['x-export-count'], '2');
  const a = audits('crm_contacts_exported').pop();
  const next = JSON.parse(a.new_value);
  assert.deepEqual([next.count, next.filters], [2, ['group']]);
});

test('EXPORT is safe to open in a spreadsheet: a name that starts like a formula is written as text, but phone numbers and dates are left alone', async () => {
  const L = require(path.join(env.SERVER, 'lib/contact-list.js'));
  assert.equal(L.csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(L.csvCell('@SUM(A1)'), `"'@SUM(A1)"`);
  assert.equal(L.csvCell('+1 (716) 555-0100'), '"+1 (716) 555-0100"');
  assert.equal(L.csvCell('-5'), '"-5"');
  assert.equal(L.csvCell('-cmd|calc'), `"'-cmd|calc"`);
  assert.equal(L.csvCell('She said "hi"'), '"She said ""hi"""');
  assert.equal(L.csvCell(null), '""');
  assert.equal(L.csvCell('2026-01-05'), '"2026-01-05"');
});

test('THE HUB LIST still works and now shares the filters and sort: group and status filters apply there too', async () => {
  assert.deepEqual((await call('GET', `/api/crm/contacts?group=${gTeachers}`, undefined, viewer)).json.contacts.map(c => c.name), ['Alice Adams']);
  const hubList = await call('GET', '/api/crm/contacts?sort=name&dir=asc&pageSize=3', undefined, viewer);
  assert.equal(hubList.status, 200); assert.equal(hubList.json.contacts.length, 3);
  assert.ok(hubList.json.contacts.every(c => c.phone === undefined && c.street === undefined), 'the Hub list still carries no phone or street');
});

test('PAGE: the Contacts list asks the merged routes (not the older page\'s), keeps every older column, keeps the Hub list\'s extras, and reads the older saved columns once', () => {
  const page = read('admin-crm-contacts.html');
  assert.match(page, /\/api\/admin\/contacts\/access/); assert.match(page, /\/api\/admin\/contacts' \+ C\.qstr\(req\)/); assert.match(page, /\/api\/admin\/contacts\/export/);
  assert.doesNotMatch(page, /\/api\/newsletter/, 'the new list does not depend on the older routes');
  assert.doesNotMatch(page, /C\.boot\(/, 'the list starts from the merged screen\'s own who-am-I, which answers with the Hub off');
  for (const key of ['name', 'email', 'phone', 'company', 'address', 'signupDate', 'source', 'status', 'role', 'gradeLevels', 'groups']) assert.match(page, new RegExp(`key: '${key}'`), `the older page's ${key} column`);
  for (const key of ['label', 'owner', 'contacted']) assert.match(page, new RegExp(`key: '${key}'[^}]*hub: true`), `the Hub's ${key} column is Hub-only`);
  assert.match(page, /fnContactsVisibleColumns/, 'the older saved column choice is read once (decision D8)');
  for (const id of ['fQ', 'fGroup', 'fStatus', 'fSource', 'fClass', 'fRole', 'fLicense', 'fOrg', 'fSort', 'fDir', 'fTest', 'columnsBtn', 'manageGroups', 'exportCsv']) assert.match(page, new RegExp(`id="${id}"`), id);
  for (const a of ['data-resend', 'data-sub', 'data-del', '#purchases', '&amp;edit=1']) assert.ok(page.includes(a), `row action ${a}`);
  assert.match(page, /confirm_close/); assert.match(page, /contact_has_crm_items/);
  assert.match(page, /C\.can\('export'\)/); assert.match(page, /C\.can\('erase'\)/);
  assert.match(page, /hub && C\.can\('write'\)[^;]*importPeople/s, 'Import people is Hub-only for now');
  // Every handler string with data in it travels in data- attributes, never an inline onclick.
  assert.doesNotMatch(page, /onclick="[a-z]+\(\$\{/);
  const person = read('admin-crm-contact.html');
  assert.match(person, /id="purchases"/); assert.match(person, /get\('edit'\) === '1'/);
  for (const f of ['admin-crm-contacts.html', 'admin-crm-contact.html']) for (const s of [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s), f);
});

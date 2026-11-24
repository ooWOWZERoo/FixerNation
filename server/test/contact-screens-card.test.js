// Merged Contacts screen, phase 3 (docs/reference/contact-pages-merge-requirements.md): the person's whole card works through /api/admin/contacts (with the Hub off too): read the card,
// edit every field (email moves the sign-in email), add a person with every field, send a password reset, delete a sign-in account, read roles. Real routes and real SQL (node:sqlite).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['first_name TEXT', 'last_name TEXT', 'role TEXT', 'email_verified INTEGER DEFAULT 0', 'is_fne_staff INTEGER DEFAULT 0']) db.exec(`ALTER TABLE site_users ADD COLUMN ${col}`);
for (const col of ['ship_to_name', 'ship_to_company', 'ship_to_street', 'ship_to_city', 'ship_to_state', 'ship_to_zip']) db.exec(`ALTER TABLE newsletter_contacts ADD COLUMN ${col} TEXT`);
db.exec(`CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT DEFAULT 'pending', registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, invited_email TEXT, status TEXT DEFAULT 'sent', seat_id INTEGER, grade_level TEXT, role_title TEXT, department TEXT, subject_area TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
db.exec('ALTER TABLE purchases ADD COLUMN school_domain TEXT');
const sent = [];
const mailer = new Proxy({}, { get: (_, name) => async (a) => { sent.push([name, a]); } });
env.install(pool, {
  [path.join(env.SERVER, 'lib/site-tokens.js')]: { createToken: async () => 'tok' },
  [path.join(env.SERVER, 'lib/mailer.js')]: mailer,
});
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/admin/contacts', R('contact-screens.js')], ['/api/newsletter', R('newsletter.js').router]]);
test.after(() => server.close());

const boss = env.addAdmin(db, 'cardboss', 'admin'), rep = env.addAdmin(db, 'cardrep', 'sales'), viewer = env.addAdmin(db, 'cardviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const audits = (action) => db.prepare('SELECT * FROM school_audit_log WHERE action = ?').all(action);
const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
let n = 0;
const person = (name = 'Card Person') => env.addContact(db, `cp${++n}-${Math.random().toString(36).slice(2, 6)}@school${n}.org`, name);
const emailOf = (id) => get('SELECT email FROM newsletter_contacts WHERE id = ?', id).email;
const account = (email, f = {}) => Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, role, email_verified, is_fne_staff) VALUES (?, ?, ?, ?, ?, ?)').run(email, 'Pat', 'Lee', f.role || 'teacher', f.verified ? 1 : 0, f.staff ? 1 : 0).lastInsertRowid);
const grp = (name) => Number(db.prepare('INSERT INTO contact_groups (name) VALUES (?)').run(name).lastInsertRowid);

test('CARD: every field the older Edit Contact box showed, readable with the Hub on or off, by any role', async () => {
  const id = person('Dana Cole');
  const g = grp('Orleans County');
  db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)').run(id, g);
  db.prepare("UPDATE newsletter_contacts SET phone='716-555-0100', company='Orleans BOCES', street='1 Main', city='Medina', state='NY', zip='14103', ship_to_name='Receiving', ship_to_city='Albion', source='Event', notes='Met at the expo' WHERE id = ?").run(id);
  for (const hub of [true, false]) {
    env.enable(db, hub);
    const r = await call('GET', `/api/admin/contacts/${id}/card`, undefined, viewer);
    assert.equal(r.status, 200); assert.equal(r.json.hubEnabled, hub);
    const c = r.json.contact;
    assert.deepEqual([c.name, c.phone, c.company, c.source, c.status, c.notes], ['Dana Cole', '716-555-0100', 'Orleans BOCES', 'Event', 'Subscribed', 'Met at the expo']);
    assert.deepEqual(c.address, { street: '1 Main', city: 'Medina', state: 'NY', zip: '14103' });
    assert.equal(c.shipTo.name, 'Receiving'); assert.equal(c.shipTo.city, 'Albion');
    assert.deepEqual(c.groups.map(x => x.name), ['Orleans County']);
    assert.equal(c.hasAccount, false);
  }
  env.enable(db, true);
  assert.equal((await call('GET', '/api/admin/contacts/99999/card', undefined, viewer)).status, 404);
  assert.equal((await call('GET', '/api/admin/contacts/abc/card', undefined, viewer)).status, 404);
});

test('EDIT: every field saves, only what is sent changes, text is cut to the column size, and the audit row names fields but never values', async () => {
  const id = person('Before Name'), g1 = grp('Edit G1'), g2 = grp('Edit G2');
  const r = await call('PUT', `/api/admin/contacts/${id}`, {
    name: '  After Name ', phone: '555-0199', company: 'New Co', address: { street: '9 Elm', city: 'Albion', state: 'NY', zip: '14411' },
    shipTo: { name: 'Dock', company: 'New Co', street: '2 Dock Rd', city: 'Albion', state: 'NY', zip: '14411' }, source: 'Referral', status: 'Unsubscribed', notes: 'Prefers email', groupIds: [g1, g2],
  }, rep);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.changed.sort(), ['company', 'groups', 'name', 'notes', 'phone', 'shipTo', 'source', 'state', 'status', 'street', 'city', 'zip'].sort());
  const row = get('SELECT * FROM newsletter_contacts WHERE id = ?', id);
  assert.deepEqual([row.name, row.phone, row.street, row.ship_to_street, row.source, row.status, row.notes], ['After Name', '555-0199', '9 Elm', '2 Dock Rd', 'Referral', 'Unsubscribed', 'Prefers email']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_group_members WHERE contact_id = ?').get(id).n, 2);
  const a = audits('crm_contact_details_changed').pop();
  assert.ok(JSON.parse(a.new_value).fields.includes('shipTo')); assert.doesNotMatch(a.new_value, /Prefers email|Dock|555-0199/, 'no values in the audit row');

  const same = await call('PUT', `/api/admin/contacts/${id}`, { name: 'After Name', groupIds: [g2, g1] }, rep);
  assert.deepEqual(same.json.changed, [], 'the same values change nothing');
  const before = audits('crm_contact_details_changed').length;
  await call('PUT', `/api/admin/contacts/${id}`, { name: 'After Name' }, rep);
  assert.equal(audits('crm_contact_details_changed').length, before, 'and write no audit row');

  const partial = await call('PUT', `/api/admin/contacts/${id}`, { phone: '' }, rep);
  assert.deepEqual(partial.json.changed, ['phone']);
  assert.equal(get('SELECT company FROM newsletter_contacts WHERE id = ?', id).company, 'New Co', 'a field that is not sent is left alone');
  await call('PUT', `/api/admin/contacts/${id}`, { name: 'x'.repeat(400) }, rep);
  assert.equal(get('SELECT name FROM newsletter_contacts WHERE id = ?', id).name.length, 255);
  await call('PUT', `/api/admin/contacts/${id}`, { groupIds: [] }, rep);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_group_members WHERE contact_id = ?').get(id).n, 0, 'an empty list clears the groups');
});

test('EDIT REFUSES bad input before it reaches the database: wrong types, a bad email or status, a group that does not exist is ignored', async () => {
  const id = person(), put = (b) => call('PUT', `/api/admin/contacts/${id}`, b, rep);
  assert.equal((await put({})).status, 400);
  assert.equal((await put({ name: 7 })).status, 400);
  assert.equal((await put({ email: 'not-an-email' })).status, 400);
  assert.equal((await put({ email: ['a@b.co'] })).status, 400, 'typeof checked first: an array is not an email');
  assert.equal((await put({ status: 'Bounced' })).status, 400);
  assert.equal((await put({ address: 'NY' })).status, 400);
  assert.equal((await put({ address: { city: 5 } })).status, 400);
  assert.equal((await put({ groupIds: 'all' })).status, 400);
  const ok = await put({ groupIds: [99999] });
  assert.equal(ok.status, 200); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_group_members WHERE contact_id = ?').get(id).n, 0);
  assert.equal((await call('PUT', '/api/admin/contacts/99999', { name: 'x' }, rep)).status, 404);
});

test('EDIT ROLES: Read-only cannot edit; Sales can; the Hub being off changes nothing', async () => {
  const id = person();
  assert.equal((await call('PUT', `/api/admin/contacts/${id}`, { name: 'Nope' }, viewer)).status, 403);
  env.enable(db, false);
  try { assert.equal((await call('PUT', `/api/admin/contacts/${id}`, { name: 'Works off' }, rep)).status, 200); } finally { env.enable(db, true); }
  assert.equal(get('SELECT name FROM newsletter_contacts WHERE id = ?', id).name, 'Works off');
});

test('EMAIL: changing it moves the sign-in account\'s email, open seats and invitations with it; a taken address is refused with the older page\'s messages', async () => {
  const id = person(), old = emailOf(id), acct = account(old, { verified: true });
  db.prepare('INSERT INTO license_seats (invited_email) VALUES (?)').run(old);
  db.prepare("INSERT INTO school_invitations (invited_email, status) VALUES (?, 'sent')").run(old);
  const r = await call('PUT', `/api/admin/contacts/${id}`, { email: 'moved-address@school.org' }, rep);
  assert.deepEqual([r.status, r.json.accountEmailUpdated], [200, true]);
  assert.equal(get('SELECT email FROM site_users WHERE id = ?', acct).email, 'moved-address@school.org');
  assert.equal(get('SELECT invited_email FROM license_seats WHERE id = 1').invited_email, 'moved-address@school.org');
  assert.equal(get('SELECT invited_email FROM school_invitations WHERE id = 1').invited_email, 'moved-address@school.org');
  assert.ok(JSON.parse(audits('crm_contact_details_changed').pop().new_value).accountEmailUpdated);

  const other = person(), otherEmail = emailOf(other);
  account(otherEmail); account('taken-by-account@school.org'); // the person has an account, and another account already uses the new address
  const clash = await call('PUT', `/api/admin/contacts/${other}`, { email: 'taken-by-account@school.org' }, rep);
  assert.equal(clash.status, 409); assert.equal(clash.json.code, 'account_email_in_use');
  assert.equal(emailOf(other), otherEmail, 'nothing changed');
  const third = person(), dup = await call('PUT', `/api/admin/contacts/${third}`, { email: otherEmail }, rep);
  assert.equal(dup.status, 409); assert.equal(dup.json.code, 'email_in_use'); assert.equal(dup.json.existingContactId, other);
  assert.match(dup.json.error, new RegExp(`contact #${other}`));
});

test('ADD A PERSON: every field, a new person starts Unsubscribed, groups and ship-to are saved; a repeat email in any capitalisation is refused with the existing id (a +tag address is a different mailbox for this check; the Possible duplicates tab looks for those)', async () => {
  const g = grp('Add G');
  const r = await call('POST', '/api/admin/contacts', { name: 'New Person', email: 'New.Person@School.org', phone: '555-0101', company: 'Acme', address: { street: '5 Oak', city: 'Medina', state: 'NY', zip: '14103' },
    shipTo: { name: 'Dock', street: '6 Dock' }, source: 'Event', notes: 'Hello', groupIds: [g] }, rep);
  assert.equal(r.status, 201);
  const row = get('SELECT * FROM newsletter_contacts WHERE id = ?', r.json.id);
  assert.deepEqual([row.status, row.source, row.street, row.ship_to_name, row.notes, row.crm_source, row.assigned_admin_id], ['Unsubscribed', 'Event', '5 Oak', 'Dock', 'Hello', 'crm_manual', rep], 'Hub on: owned by whoever added them');
  assert.equal(r.json.classification, 'suspect');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_group_members WHERE contact_id = ?').get(r.json.id).n, 1);
  assert.equal(get('SELECT COUNT(*) AS n FROM newsletter_contacts WHERE email = ?', 'New.Person@School.org').n, 1);
  for (const email of ['new.person@school.org', 'NEW.PERSON@SCHOOL.ORG', '  new.person@school.org ']) {
    const d = await call('POST', '/api/admin/contacts', { email }, rep);
    assert.equal(d.status, 409, email); assert.deepEqual([d.json.code, d.json.existingContactId], ['duplicate_email', r.json.id]);
  }
  assert.equal((await call('POST', '/api/admin/contacts', { name: 'No email' }, rep)).status, 400);
  assert.equal((await call('POST', '/api/admin/contacts', { email: 'bad' }, rep)).status, 400);
  assert.equal((await call('POST', '/api/admin/contacts', { email: 'x@y.co', name: 5 }, rep)).status, 400);
  assert.equal((await call('POST', '/api/admin/contacts', { email: 'ro@y.co' }, viewer)).status, 403);
  const subscribed = await call('POST', '/api/admin/contacts', { email: 'agreed@school.org', status: 'Subscribed' }, rep);
  assert.equal(get('SELECT status FROM newsletter_contacts WHERE id = ?', subscribed.json.id).status, 'Subscribed');
  assert.ok(audits('crm_contact_created').length >= 2);
  assert.ok(audits('crm_contact_created').every(a => !/@/.test(`${a.prev_value || ''}${a.new_value || ''}`)), 'no email in the audit row');
});

test('ADD A PERSON with the Hub off: it still works, and the Hub-only columns are left alone', async () => {
  env.enable(db, false);
  try {
    const r = await call('POST', '/api/admin/contacts', { email: 'hub-off-add@school.org', name: 'Off Add' }, rep);
    assert.equal(r.status, 201); assert.equal(r.json.classification, null);
    const row = get('SELECT * FROM newsletter_contacts WHERE id = ?', r.json.id);
    assert.deepEqual([row.crm_source, row.assigned_admin_id], [null, null]);
  } finally { env.enable(db, true); }
});

test('SIGN-IN ACCOUNT: send a password reset (Sales may), delete the account (CRM Admin only; a seat it held reopens; a staff account is refused); a person with no account gets a plain 404', async () => {
  const id = person(), acct = account(emailOf(id));
  db.prepare("INSERT INTO license_seats (status, registered_site_user_id, registered_at) VALUES ('registered', ?, '2026-01-01')").run(acct);
  const before = sent.length;
  assert.equal((await call('POST', `/api/admin/contacts/${id}/send-password-reset`, {}, viewer)).status, 403);
  const reset = await call('POST', `/api/admin/contacts/${id}/send-password-reset`, {}, rep);
  assert.equal(reset.status, 200); assert.equal(sent.length, before + 1); assert.equal(sent[sent.length - 1][0], 'sendPasswordResetEmail');
  assert.ok(audits('admin_reset_email_sent').length >= 1);
  assert.equal((await call('DELETE', `/api/admin/contacts/${id}/site-account`, {}, rep)).status, 403, 'Sales cannot delete an account');
  assert.ok(get('SELECT id FROM site_users WHERE id = ?', acct));
  const del = await call('DELETE', `/api/admin/contacts/${id}/site-account`, {}, boss);
  assert.equal(del.status, 200);
  assert.equal(get('SELECT id FROM site_users WHERE id = ?', acct), undefined);
  const seat = get('SELECT * FROM license_seats WHERE registered_at IS NULL OR registered_site_user_id IS NULL ORDER BY id DESC');
  assert.deepEqual([seat.status, seat.registered_site_user_id], ['pending', null], 'the seat reopens');
  assert.ok(get('SELECT id FROM newsletter_contacts WHERE id = ?', id), 'the contact stays');
  assert.ok(audits('crm_contact_site_account_deleted').some(a => a.entity_id === id));
  assert.equal((await call('DELETE', `/api/admin/contacts/${id}/site-account`, {}, boss)).status, 404, 'no account now');
  assert.equal((await call('POST', `/api/admin/contacts/${id}/send-password-reset`, {}, rep)).status, 404);
  const staff = person(); const sa = account(emailOf(staff), { role: 'admin' });
  const refused = await call('DELETE', `/api/admin/contacts/${staff}/site-account`, {}, boss);
  assert.deepEqual([refused.status, refused.json.code], [409, 'staff_account']); assert.ok(get('SELECT id FROM site_users WHERE id = ?', sa));
});

test('ROLES: a person with no account has none; a teacher with a seat and a school administrator role show them; Read-only may look', async () => {
  const none = person();
  const r0 = await call('GET', `/api/admin/contacts/${none}/roles`, undefined, viewer);
  assert.deepEqual([r0.status, r0.json.role, r0.json.teacherSeats], [200, null, []]);
  const id = person(), acct = account(emailOf(id), { role: 'school_license_admin' });
  const p = env.addPurchase(db, id); db.prepare("UPDATE purchases SET school_domain = 'lincoln.edu' WHERE id = ?").run(p);
  db.prepare("INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level) VALUES (?, ?, 'full')").run(acct, p);
  db.prepare("INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, 'registered', ?)").run(p, acct);
  db.prepare("INSERT INTO site_user_audiences (site_user_id, audience) VALUES (?, 'High School')").run(acct);
  const r = await call('GET', `/api/admin/contacts/${id}/roles`, undefined, viewer);
  assert.equal(r.status, 200); assert.equal(r.json.schoolAdminRoles.length, 1); assert.equal(r.json.schoolAdminRoles[0].school_domain, 'lincoln.edu');
  assert.equal(r.json.teacherSeats.length, 1); assert.deepEqual(r.json.audiences, ['High School']);
  assert.equal((await call('GET', '/api/admin/contacts/99999/roles', undefined, viewer)).status, 404);
  // The older route answers the same thing from the same code.
  const old = await call('GET', `/api/newsletter/contacts/${id}/roles`, undefined, viewer);
  assert.deepEqual(old.json, r.json);
});

test('THE OLDER ROUTES still behave the same through the shared code: edit, with the same messages', async () => {
  const id = person(), r = await call('PUT', `/api/newsletter/contacts/${id}`, { name: 'Older Page Edit', address: { city: 'Lockport' } }, rep);
  assert.equal(r.status, 200); assert.equal(r.json.contact.name, 'Older Page Edit'); assert.equal(r.json.contact.address.city, 'Lockport'); assert.equal(r.json.accountEmailUpdated, false);
  assert.equal((await call('PUT', '/api/newsletter/contacts/99999', { name: 'x' }, rep)).status, 404);
});

test('ACCESS: every route in the merged screen, including the card routes, is (path, requireAuth, requireCrmRole(action)); signed out they all answer 401', async () => {
  const src = read('server/routes/contact-screens.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const all = [...src.matchAll(/\brouter\.(get|post|put|patch|delete|all)\(/g)];
  const guarded = [...src.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*'[^']*'\s*,\s*requireAuth\s*,\s*requireCrmRole\('[a-z_]+'\)/g)];
  assert.ok(all.length >= 16, `${all.length} routes`); assert.equal(guarded.length, all.length);
  for (const [m, u] of [['GET', '/1/card'], ['GET', '/1/roles'], ['POST', ''], ['PUT', '/1'], ['POST', '/1/send-password-reset'], ['DELETE', '/1/site-account']]) {
    assert.equal((await call(m, '/api/admin/contacts' + u, m === 'GET' ? undefined : {})).status, 401, `${m} ${u}`);
  }
});

test('THE PAGES: the person page starts from the merged routes (works with the Hub off), has the whole card, the sign-in account block and Delete; the list\'s Add a person uses the shared form; the Hub-only parts are gated', () => {
  const page = read('admin-crm-contact.html'), list = read('admin-crm-contacts.html'), form = read('contact-form.js');
  assert.match(page, /\/api\/admin\/contacts\/access/); assert.match(page, /\/api\/admin\/contacts\/' \+ id \+ '\/card/); assert.doesNotMatch(page, /C\.boot\(/);
  for (const id of ['editDetails', 'toggleSub', 'deleteC', 'resendV', 'resetPw', 'delAcct', 'rolesBox']) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /if \(d\) \{\n\s+var subject/, 'the Hub\'s panels are drawn only when the Hub is on');
  assert.match(page, /contact-form\.js\?v=1/); assert.match(list, /contact-form\.js\?v=1/);
  assert.match(list, /C\.api\('POST', '\/api\/admin\/contacts', body\)/); assert.match(list, /C\.can\('write'\) \? '<button type="button" class="a-btn a-btn-primary" id="addContact"/);
  for (const id of ['cfName', 'cfEmail', 'cfPhone', 'cfCompany', 'cfStreet', 'cfCity', 'cfState', 'cfZip', 'cfShipName', 'cfShipCompany', 'cfShipStreet', 'cfShipCity', 'cfShipState', 'cfShipZip', 'cfSource', 'cfStatus', 'cfNotes', 'cfGroupFind']) assert.match(form, new RegExp(`'${id}'|id="${id}"`), id);
  assert.match(form, /Unsubscribed/);
  assert.doesNotMatch(read('admin-crm-contact.html'), /onclick="[a-z]+\(\$\{/);
  for (const f of ['admin-crm-contact.html', 'admin-crm-contacts.html']) for (const s of [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s), f);
  assert.doesNotThrow(() => new (require('node:vm').Script)(form), 'contact-form.js parses');
  assert.doesNotMatch(form, /https?:\/\/(?!localhost)/, 'no CDN');
});

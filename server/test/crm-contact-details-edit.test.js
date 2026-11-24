// Edit details on the Customer Hub person page: PUT /api/crm/contacts/:id now also changes name, phone, company, street, city, state, ZIP (the owner still works). Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/contacts', R('crm-contacts.js')]]);
test.after(() => server.close());

const boss = env.addAdmin(db, 'detailboss', 'admin'), rep = env.addAdmin(db, 'detailrep', 'sales'), viewer = env.addAdmin(db, 'detailviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const audits = (action) => db.prepare('SELECT * FROM school_audit_log WHERE action = ?').all(action);
const person = () => env.addContact(db, `p${Math.random().toString(36).slice(2, 8)}@example.com`, 'Original Name');

test('EDIT: staff who can write change the details; the email is never touched; the page then reads them back', async () => {
  const id = person();
  const r = await call('PUT', `/api/crm/contacts/${id}`, { name: '  New Name ', company: 'Orleans-Niagara Teacher Center', phone: '716-555-0100', street: '1 Main St', city: 'Medina', state: 'NY', zip: '14103', email: 'sneaky@example.com' }, rep);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.changed.sort(), ['city', 'company', 'name', 'phone', 'state', 'street', 'zip']);
  const row = get('SELECT * FROM newsletter_contacts WHERE id = ?', id);
  assert.equal(row.name, 'New Name', 'trimmed'); assert.equal(row.state, 'NY'); assert.equal(row.zip, '14103');
  assert.match(row.email, /@example\.com$/); assert.notEqual(row.email, 'sneaky@example.com', 'the email is not changed from here');
  const page = await call('GET', `/api/crm/contacts/${id}`, undefined, viewer);
  assert.equal(page.status, 200);
  assert.deepEqual([page.json.contact.phone, page.json.contact.street, page.json.contact.city, page.json.contact.zip, page.json.contact.state], ['716-555-0100', '1 Main St', 'Medina', '14103', 'NY']);
  const list = await call('GET', '/api/crm/contacts', undefined, viewer);
  assert.ok(list.json.contacts.every(c => c.phone === undefined && c.street === undefined), 'the list never carries a phone number or a street address');
});

test('PARTIAL AND UNCHANGED: only what is sent changes; sending the same values changes nothing and writes no audit row; text can be cleared', async () => {
  const id = person();
  await call('PUT', `/api/crm/contacts/${id}`, { state: 'PA', phone: '555' }, rep);
  const before = audits('crm_contact_details_changed').length;
  const same = await call('PUT', `/api/crm/contacts/${id}`, { state: 'PA', phone: '555' }, rep);
  assert.equal(same.status, 200); assert.deepEqual(same.json.changed, []);
  assert.equal(audits('crm_contact_details_changed').length, before, 'nothing changed, nothing logged');
  await call('PUT', `/api/crm/contacts/${id}`, { phone: '' }, rep);
  const row = get('SELECT name, state, phone FROM newsletter_contacts WHERE id = ?', id);
  assert.equal(row.name, 'Original Name'); assert.equal(row.state, 'PA'); assert.equal(row.phone, '');
});

test('LIMITS AND SHAPE: text is cut at each column\'s size; a value that is not text is refused; an empty request is refused', async () => {
  const id = person();
  await call('PUT', `/api/crm/contacts/${id}`, { name: 'N'.repeat(400), phone: '1'.repeat(80), state: 'S'.repeat(100), zip: 'Z'.repeat(40), city: 'C'.repeat(300) }, rep);
  const row = get('SELECT name, phone, state, zip, city FROM newsletter_contacts WHERE id = ?', id);
  assert.deepEqual([row.name.length, row.phone.length, row.state.length, row.zip.length, row.city.length], [255, 32, 64, 16, 128]);
  for (const bad of [{ name: 5 }, { state: ['PA'] }, { company: null }, { street: { a: 1 } }]) assert.equal((await call('PUT', `/api/crm/contacts/${id}`, bad, rep)).status, 400, JSON.stringify(bad));
  assert.equal((await call('PUT', `/api/crm/contacts/${id}`, {}, rep)).status, 400);
  assert.equal((await call('PUT', `/api/crm/contacts/${id}`, { email: 'x@example.com' }, rep)).status, 400, 'an email alone is "nothing to change"');
  assert.equal((await call('PUT', '/api/crm/contacts/999999', { name: 'x' }, rep)).status, 404);
});

test('ACCESS: Read-only cannot edit; the owner change still works, alone or together with details; the audit row names the fields and never the values', async () => {
  const id = person();
  assert.equal((await call('PUT', `/api/crm/contacts/${id}`, { name: 'Nope' }, viewer)).status, 403);
  assert.equal(get('SELECT name FROM newsletter_contacts WHERE id = ?', id).name, 'Original Name');
  const both = await call('PUT', `/api/crm/contacts/${id}`, { assignedAdminId: rep.adminId || rep.id || rep, state: 'OH' }, boss);
  assert.equal(both.status, 200); assert.equal(both.json.ownerChanged, true);
  assert.equal(get('SELECT state FROM newsletter_contacts WHERE id = ?', id).state, 'OH');
  assert.equal((await call('PUT', `/api/crm/contacts/${id}`, { assignedAdminId: 987654 }, boss)).status, 400, 'owner must be a real admin');
  assert.equal((await call('PUT', `/api/crm/contacts/${id}`, { assignedAdminId: null }, boss)).status, 200);
  const a = audits('crm_contact_details_changed').find(x => x.entity_id === id || String(x.entity_id) === String(id));
  assert.ok(a, 'a details audit row exists'); assert.match(String(a.new_value), /state/); assert.doesNotMatch(String(a.new_value), /OH/, 'no values in the log');
  assert.ok(audits('crm_contact_owner_changed').length >= 2);
});

test('THE PAGE: an Edit details button opens a pop-up with the whole card and saves through the merged Contacts route (phase 3); the older CRM page is no longer linked from here', () => {
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-contact.html'), 'utf8');
  assert.match(page, /C\.can\('write'\) \? '<button type="button" class="a-btn a-btn-outline a-btn-sm" id="editDetails">Edit details…<\/button>'/);
  assert.match(page, /C\.api\('PUT', '\/api\/admin\/contacts\/' \+ id, body\)/);
  assert.doesNotMatch(page, /admin-newsletter/, 'every field is here now, so nothing points at the older page');
  assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
});

test('THE OLD ADDRESS (phase 6): admin-newsletter.html?edit=<id> sends a whole-number id to that person\'s page with Edit details open, and anything else to the Contacts list', () => {
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-newsletter.html'), 'utf8');
  assert.match(page, /Number\(new URLSearchParams\(window\.location\.search\)\.get\('edit'\)\)/);
  assert.match(page, /Number\.isInteger\(edit\) && edit > 0 \? 'admin-crm-contact\.html\?id=' \+ edit \+ '&edit=1' : 'admin-crm-contacts\.html'/);
  // Run the stub's script for real: the address it would go to.
  const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  const go = (search) => { const out = {}; new (require('node:vm').Script)(script).runInNewContext({ window: { location: { search, replace: (u) => { out.to = u; } } }, URLSearchParams, Number, document: { getElementById: () => ({ setAttribute() {} }) } }); return out.to; };
  assert.equal(go('?edit=42'), 'admin-crm-contact.html?id=42&edit=1');
  for (const bad of ['', '?edit=0', '?edit=-3', '?edit=4.5', '?edit=abc', '?edit=1;alert(1)', '?edit=%3Cscript%3E']) assert.equal(go(bad), 'admin-crm-contacts.html', bad);
  assert.doesNotMatch(page, /fetch\(|fnRequireAuth|innerHTML/, 'the stub does no work and writes no HTML');
});

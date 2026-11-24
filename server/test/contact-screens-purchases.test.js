// Merged Contacts screen, phase 4 (docs/reference/contact-pages-merge-requirements.md): a person's purchases and license seats through /api/admin/contacts: list, add, change, mark paid,
// delete, and the three seat actions (save an invited email, register an account directly, free a seat). CRM Admin only to change; every id checked against the person in the URL.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['first_name TEXT', 'last_name TEXT', 'role TEXT', 'email_verified INTEGER DEFAULT 0', 'is_fne_staff INTEGER DEFAULT 0', 'session_invalidated_at TEXT']) db.exec(`ALTER TABLE site_users ADD COLUMN ${col}`);
for (const col of ['book_id INTEGER', 'seat_count INTEGER', 'source TEXT', 'notes TEXT', 'stripe_session_id TEXT', 'stripe_invoice_id TEXT', 'school_domain TEXT', 'trial_library_limit INTEGER', 'conversion_credit_cents INTEGER',
  'license_duration_days INTEGER', 'effective_date TEXT', 'expiration_date TEXT', 'conversion_credit_redeemed_at TEXT', 'converted_to_purchase_id INTEGER']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec('ALTER TABLE license_products ADD COLUMN auto_assign_group_id INTEGER');
db.exec('ALTER TABLE license_products ADD COLUMN duration_days INTEGER');
db.exec(`CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT DEFAULT 'available', registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);`);
const sent = [];
const mailer = new Proxy({}, { get: (_, name) => async (a) => { sent.push([name, a]); } });
env.install(pool, { [path.join(env.SERVER, 'lib/mailer.js')]: mailer });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/admin/contacts', R('contact-screens.js')], ['/api/newsletter', R('newsletter.js').router]]);
test.after(() => server.close());

const boss = env.addAdmin(db, 'purchboss', 'admin'), rep = env.addAdmin(db, 'purchrep', 'sales'), viewer = env.addAdmin(db, 'purchviewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const audits = (action) => db.prepare('SELECT * FROM school_audit_log WHERE action = ?').all(action);
const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
let n = 0;
const person = () => env.addContact(db, `pp${++n}-${Math.random().toString(36).slice(2, 6)}@school${n}.org`, `Buyer ${n}`);
const account = (email, first = 'Sam') => Number(db.prepare('INSERT INTO site_users (email, first_name, last_name, role, email_verified) VALUES (?, ?, ?, ?, 1)').run(email, first, 'Teach', 'teacher').lastInsertRowid);
const base = (id) => `/api/admin/contacts/${id}/purchases`;
const addGroup = async (id, seats = 3, domain = '@Lincoln.edu ') => (await call('POST', base(id), { productType: 'group_license', seatCount: seats, schoolDomain: domain, notes: 'Phone order' }, boss)).json.purchase;

test('ACCESS: every purchase route is requireCrmRole(view | manage_purchases), manage_purchases is CRM Admin only, signed out is 401', async () => {
  const perms = require(path.join(env.SERVER, 'lib/crm-permissions.js'));
  assert.deepEqual(perms.ALLOWED.manage_purchases, ['admin']);
  const src = read('server/routes/contact-screens.js').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const all = [...src.matchAll(/\brouter\.(get|post|put|patch|delete|all)\(/g)];
  const guarded = [...src.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*'[^']*'\s*,\s*requireAuth\s*,\s*requireCrmRole\('[a-z_]+'\)/g)];
  assert.equal(guarded.length, all.length);
  const purchaseRoutes = [...src.matchAll(/\brouter\.(post|put|delete)\(\s*'(\/:id\/purchases[^']*)'\s*,\s*requireAuth\s*,\s*requireCrmRole\('([a-z_]+)'\)/g)];
  assert.ok(purchaseRoutes.length >= 6); assert.ok(purchaseRoutes.every(m => m[3] === 'manage_purchases'), 'every change needs manage_purchases');
  for (const [m, u] of [['GET', '/1/purchases'], ['POST', '/1/purchases'], ['PUT', '/1/purchases/1'], ['DELETE', '/1/purchases/1'], ['PUT', '/1/purchases/1/seats/1'], ['POST', '/1/purchases/1/seats/1/register'], ['POST', '/1/purchases/1/seats/1/unregister']]) {
    assert.equal((await call(m, '/api/admin/contacts' + u, m === 'GET' ? undefined : {})).status, 401, `${m} ${u}`);
  }
});

test('LIST: anyone who can see the person sees their purchases and seats; only a CRM Admin is told they can manage; works with the Hub off', async () => {
  const id = person();
  const p = await addGroup(id, 3);
  for (const [who, can] of [[viewer, false], [rep, false], [boss, true]]) {
    const r = await call('GET', base(id), undefined, who);
    assert.equal(r.status, 200); assert.equal(r.json.canManage, can);
    assert.equal(r.json.purchases.length, 1); assert.equal(r.json.purchases[0].seats.length, 3); assert.equal(r.json.purchases[0].schoolDomain, 'lincoln.edu');
  }
  env.enable(db, false);
  try { assert.equal((await call('GET', base(id), undefined, viewer)).status, 200); } finally { env.enable(db, true); }
  assert.equal((await call('GET', '/api/admin/contacts/99999/purchases', undefined, viewer)).status, 404);
  assert.equal(p.paymentStatus, 'paid');
});

test('ADD: a single or group license by hand; the book type is not offered (D10); input is checked; Sales and Read-only cannot; each add is audited without the school or the notes', async () => {
  const id = person();
  const single = await call('POST', base(id), { productType: 'single_license' }, boss);
  assert.equal(single.status, 201); assert.equal(single.json.purchase.seatCount, 1);
  assert.equal(get('SELECT invited_email, status FROM license_seats WHERE purchase_id = ?', single.json.purchase.id).status, 'pending', 'the buyer\'s own seat is held for them');
  const group = await call('POST', base(id), { productType: 'group_license', seatCount: 4, schoolDomain: ' @Lincoln.EDU', notes: 'PO by phone' }, boss);
  assert.equal(group.status, 201); assert.equal(group.json.purchase.seats.length, 4); assert.equal(group.json.purchase.seats.every(s => s.status === 'available'), true);
  const row = get('SELECT * FROM purchases WHERE id = ?', group.json.purchase.id);
  assert.deepEqual([row.school_domain, row.notes, row.source, row.payment_status, row.payment_method], ['lincoln.edu', 'PO by phone', 'Manual Entry', 'paid', 'manual']);
  assert.equal((await call('POST', base(id), { productType: 'book', bookId: 1 }, boss)).status, 400, 'the dead book type is not carried over');
  for (const bad of [{}, { productType: 'group_license' }, { productType: 'group_license', seatCount: 0 }, { productType: 'group_license', seatCount: 2.5 }, { productType: 'group_license', seatCount: 99999 }, { productType: 'group_license', seatCount: 2, schoolDomain: 7 }, { productType: 'single_license', notes: ['x'] }, { productType: ['single_license'] }]) {
    assert.equal((await call('POST', base(id), bad, boss)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await call('POST', base(id), { productType: 'single_license' }, rep)).status, 403);
  assert.equal((await call('POST', base(id), { productType: 'single_license' }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/admin/contacts/99999/purchases', { productType: 'single_license' }, boss)).status, 404);
  const a = audits('crm_contact_purchase_added').pop();
  assert.doesNotMatch(`${a.prev_value}${a.new_value}`, /lincoln|PO by phone/i);
});

test('CHANGE: notes, seat count (open seats added or removed, never below the claimed ones) and school domain; Mark as paid for a pending purchase; an invoice-linked one is refused; bad values refused', async () => {
  const id = person(), p = await addGroup(id, 3);
  const up = await call('PUT', `${base(id)}/${p.id}`, { seatCount: 5, schoolDomain: 'Roosevelt.org', notes: 'Added two' }, boss);
  assert.equal(up.status, 200); assert.equal(up.json.purchase.seats.length, 5);
  assert.deepEqual([up.json.purchase.schoolDomain, up.json.purchase.notes, up.json.purchase.seatCount], ['roosevelt.org', 'Added two', 5]);
  // claim one seat, then try to shrink below it
  const acct = account('claimed@school.org');
  const seatId = up.json.purchase.seats[0].id;
  db.prepare("UPDATE license_seats SET status = 'registered', registered_site_user_id = ? WHERE id = ?").run(acct, seatId);
  db.prepare("UPDATE license_seats SET status = 'registered', registered_site_user_id = ? WHERE id = ?").run(acct, up.json.purchase.seats[1].id);
  assert.equal((await call('PUT', `${base(id)}/${p.id}`, { seatCount: 1 }, boss)).status, 400, 'cannot go below the seats in use');
  const shrink = await call('PUT', `${base(id)}/${p.id}`, { seatCount: 2 }, boss);
  assert.equal(shrink.status, 200); assert.equal(shrink.json.purchase.seats.length, 2); assert.ok(shrink.json.purchase.seats.every(s => s.status === 'registered'));
  // mark paid
  db.prepare("UPDATE purchases SET payment_status = 'pending' WHERE id = ?").run(p.id);
  const paid = await call('PUT', `${base(id)}/${p.id}`, { paymentStatus: 'paid' }, boss);
  assert.equal(paid.status, 200); assert.equal(paid.json.purchase.paymentStatus, 'paid');
  assert.equal(audits('crm_contact_purchase_paid').length, 1);
  assert.ok(audits('crm_contact_purchase_changed').length >= 1);
  db.prepare("UPDATE purchases SET payment_status = 'pending', invoice_id = 5 WHERE id = ?").run(p.id);
  const onInvoice = await call('PUT', `${base(id)}/${p.id}`, { paymentStatus: 'paid' }, boss);
  assert.deepEqual([onInvoice.status, onInvoice.json.code], [409, 'on_invoice']);
  assert.equal(get('SELECT payment_status FROM purchases WHERE id = ?', p.id).payment_status, 'pending');
  for (const bad of [{}, { paymentStatus: 'refunded' }, { paymentStatus: ['paid'] }, { seatCount: 0 }, { seatCount: 'many' }, { notes: 5 }, { schoolDomain: {} }]) assert.equal((await call('PUT', `${base(id)}/${p.id}`, bad, boss)).status, 400, JSON.stringify(bad));
  assert.equal((await call('PUT', `${base(id)}/${p.id}`, { notes: 'x' }, rep)).status, 403);
});

test('DELETE: the purchase and its seats go; the person\'s Customer label is re-derived; audited; only a CRM Admin', async () => {
  const id = person(), p = await addGroup(id, 2);
  assert.equal((await call('DELETE', `${base(id)}/${p.id}`, {}, rep)).status, 403);
  assert.ok(get('SELECT id FROM purchases WHERE id = ?', p.id));
  const r = await call('DELETE', `${base(id)}/${p.id}`, {}, boss);
  assert.equal(r.status, 200);
  assert.equal(get('SELECT id FROM purchases WHERE id = ?', p.id), undefined);
  assert.ok(audits('crm_contact_purchase_deleted').some(a => a.entity_id === id));
  assert.equal((await call('DELETE', `${base(id)}/${p.id}`, {}, boss)).status, 404);
});

test('SCOPE: one person\'s page can never change another person\'s purchase or seat (the ids are checked against the person in the URL)', async () => {
  const mine = person(), theirs = person();
  const p = await addGroup(theirs, 2), seatId = p.seats[0].id;
  assert.equal((await call('PUT', `${base(mine)}/${p.id}`, { notes: 'hijack' }, boss)).status, 404);
  assert.equal((await call('DELETE', `${base(mine)}/${p.id}`, {}, boss)).status, 404);
  assert.equal((await call('PUT', `${base(mine)}/${p.id}/seats/${seatId}`, { invitedEmail: 'x@y.co' }, boss)).status, 404);
  assert.equal((await call('POST', `${base(mine)}/${p.id}/seats/${seatId}/register`, { email: 'x@y.co' }, boss)).status, 404);
  assert.equal((await call('POST', `${base(mine)}/${p.id}/seats/${seatId}/unregister`, {}, boss)).status, 404);
  assert.equal(get('SELECT notes FROM purchases WHERE id = ?', p.id).notes, 'Phone order', 'untouched');
  // a seat id that belongs to a different purchase of the same person is also refused
  const other = await addGroup(theirs, 1);
  assert.equal((await call('PUT', `${base(theirs)}/${other.id}/seats/${seatId}`, { invitedEmail: 'x@y.co' }, boss)).status, 404);
});

test('SEATS: save an invited email (only an open seat); register an existing account directly; free a seat without touching the account and sign the teacher\'s old session out', async () => {
  const id = person(), p = await addGroup(id, 3), [s1, s2] = p.seats.map(s => s.id);
  const seat = (sid) => get('SELECT * FROM license_seats WHERE id = ?', sid);
  // an 'available' seat is not 'pending': saving an invite on it is refused the way the older page refused it
  assert.equal((await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: 'one@school.org' }, boss)).status, 409);
  db.prepare("UPDATE license_seats SET status = 'pending' WHERE id IN (?, ?)").run(s1, s2);
  assert.equal((await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: 'not an email' }, boss)).status, 400);
  assert.equal((await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: 7 }, boss)).status, 400);
  const ok = await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: ' one@school.org ' }, boss);
  assert.equal(ok.status, 200); assert.equal(seat(s1).invited_email, 'one@school.org');
  const cleared = await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: '' }, boss);
  assert.equal(cleared.status, 200); assert.equal(seat(s1).invited_email, null);
  assert.equal((await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: 'x@school.org' }, rep)).status, 403);
  assert.ok(audits('crm_contact_seat_invited').length >= 2); assert.ok(audits('crm_contact_seat_invited').every(a => !/@/.test(`${a.prev_value}${a.new_value}`)));

  // register directly
  assert.equal((await call('POST', `${base(id)}/${p.id}/seats/${s1}/register`, {}, boss)).status, 400, 'an email is required');
  assert.equal((await call('POST', `${base(id)}/${p.id}/seats/${s1}/register`, { email: 'nobody@school.org' }, boss)).status, 404, 'no such account');
  const acct = account('teacher@school.org', 'Tess');
  const reg = await call('POST', `${base(id)}/${p.id}/seats/${s1}/register`, { email: 'teacher@school.org' }, boss);
  assert.equal(reg.status, 200);
  assert.deepEqual([seat(s1).status, seat(s1).registered_site_user_id, seat(s1).invited_email], ['registered', acct, 'teacher@school.org']);
  const list = (await call('GET', base(id), undefined, boss)).json.purchases[0];
  assert.equal(list.seats.find(s => s.id === s1).registeredName, 'Tess Teach');
  assert.equal((await call('PUT', `${base(id)}/${p.id}/seats/${s1}`, { invitedEmail: 'x@school.org' }, boss)).status, 409, 'a claimed seat cannot be reassigned');
  assert.equal((await call('POST', `${base(id)}/${p.id}/seats/${s2}/unregister`, {}, rep)).status, 403);

  // free the seat
  const free = await call('POST', `${base(id)}/${p.id}/seats/${s1}/unregister`, {}, boss);
  assert.equal(free.status, 200);
  assert.deepEqual([seat(s1).status, seat(s1).registered_site_user_id], ['pending', null]);
  assert.ok(get('SELECT id FROM site_users WHERE id = ?', acct), 'the account is untouched');
  assert.ok(get('SELECT session_invalidated_at AS s FROM site_users WHERE id = ?', acct).s, 'the teacher\'s existing session is ended');
  assert.ok(audits('crm_contact_seat_registered').length === 1 && audits('crm_contact_seat_freed').length === 1);
});

test('THE OLDER ROUTES still behave the same through the shared code: add, change, delete, and the three seat actions', async () => {
  const id = person();
  const add = await call('POST', `/api/newsletter/contacts/${id}/purchases`, { productType: 'group_license', seatCount: 2, schoolDomain: 'old.edu' }, boss);
  assert.equal(add.status, 201); const pid = add.json.purchase.id, [a, b] = add.json.purchase.seats.map(s => s.id);
  assert.equal((await call('PUT', `/api/newsletter/purchases/${pid}`, { seatCount: 3 }, boss)).json.purchase.seats.length, 3);
  assert.equal((await call('PUT', `/api/newsletter/purchases/${pid}/seats/${a}`, { invitedEmail: 'x@y.co' }, boss)).status, 409);
  account('older@school.org');
  assert.equal((await call('POST', `/api/newsletter/purchases/${pid}/seats/${a}/register`, { email: 'older@school.org' }, boss)).status, 200);
  assert.equal((await call('POST', `/api/newsletter/purchases/${pid}/seats/${a}/unregister`, {}, boss)).status, 200);
  assert.equal((await call('GET', `/api/newsletter/contacts/${id}/purchases`, undefined, boss)).json.purchases.length, 1);
  assert.equal((await call('DELETE', `/api/newsletter/purchases/${pid}`, {}, boss)).status, 200);
  assert.equal((await call('DELETE', `/api/newsletter/purchases/${pid}`, {}, boss)).status, 404);
  assert.ok(b);
});

test('THE PAGE: the person page has the Purchases and licenses card, the pop-up with every action, and nothing inline; the list\'s receipt button opens it; the book type is gone', () => {
  const page = read('admin-crm-contact.html'), list = read('admin-crm-contacts.html');
  assert.match(page, /id="purchases"/); assert.match(page, /id="managePurch"/); assert.match(page, /C\.can\('manage_purchases'\)/);
  for (const a of ['add', 'paid', 'save', 'del', 'invite', 'regnow', 'free']) assert.match(page, new RegExp(`data-act="${a}"|act === '${a}'`), a);
  for (const f of ['/seats/', '/register', '/unregister', "'/api/admin/contacts/' + id + '/purchases'"]) assert.ok(page.includes(f), f);
  assert.doesNotMatch(page, /api\/books|value="book"/, 'no book purchase type'); assert.doesNotMatch(page, /\/api\/newsletter/);
  assert.match(page, /get\('purchases'\) === '1'/); assert.match(list, /purchases=1#purchases/);
  assert.doesNotMatch(page, /onclick="[a-z]+\(\$\{/);
  for (const f of ['admin-crm-contact.html', 'admin-crm-contacts.html']) for (const s of [...read(f).matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => x.trim())) assert.doesNotThrow(() => new (require('node:vm').Script)(s), f);
});

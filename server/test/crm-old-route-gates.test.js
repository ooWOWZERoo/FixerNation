// Punch list S1-S4 (docs/reference/sales-crm-punch-list.md): the OLDER admin routes (admin accounts, quotes, accept-for-customer) now honour the CRM role,
// whether the Hub is on or off, and nothing about a quote's accept link or a sent quote's price slips past a lowered role.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/crm-env');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.SITE_URL = 'https://example.test';
const { db, pool } = env.makeDb();
db.exec(`
CREATE TABLE IF NOT EXISTS school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER,
  purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT);
CREATE TABLE IF NOT EXISTS admin_invite_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, token TEXT, expires_at TEXT);
CREATE TABLE IF NOT EXISTS quote_content_profiles (id INTEGER PRIMARY KEY, is_default INTEGER DEFAULT 0);
`);
// SQLite cannot bind a Date; MariaDB can.
const rawQuery = pool.query;
pool.query = (sql, params = []) => rawQuery(sql, params.map(x => (x instanceof Date ? x.toISOString() : x)));
env.install(pool);
const R = (f) => require(path.join(env.SERVER, f));
const { server, call } = env.listen([['/api/auth', R('routes/auth.js').router], ['/api/contact', R('routes/contact.js')], ['/api/admin/concierge', R('routes/admin-concierge.js')]]);
test.after(() => server.close());

const owner = env.addAdmin(db, 'owner', 'admin');
const rep = env.addAdmin(db, 'rep', 'sales');
const viewer = env.addAdmin(db, 'viewer', 'readonly');
const audits = (action) => db.prepare('SELECT * FROM school_audit_log WHERE action = ?').all(action);

for (const hub of [true, false]) {
  test(`S1 admin accounts (Hub ${hub ? 'on' : 'off'}): only a CRM Admin can invite, edit, reset or delete an admin; Sales and Read-only get 403 and nothing changes`, async () => {
    env.enable(db, hub);
    const target = env.addAdmin(db, `target${hub}`, 'sales');
    const before = db.prepare('SELECT COUNT(*) n FROM admin_users').get().n;
    for (const who of [rep, viewer]) {
      assert.equal((await call('POST', '/api/auth/admins', { username: 'mint', email: 'mint@school.example.com' }, who)).status, 403);
      assert.equal((await call('PUT', `/api/auth/admins/${target}`, { username: 'taken', email: 'attacker@school.example.com' }, who)).status, 403);
      assert.equal((await call('POST', `/api/auth/admins/${target}/send-password-reset`, {}, who)).status, 403);
      assert.equal((await call('POST', `/api/auth/admins/${target}/resend-invite`, {}, who)).status, 403);
      assert.equal((await call('DELETE', `/api/auth/admins/${target}`, {}, who)).status, 403);
    }
    assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_users').get().n, before, 'no admin was made or removed');
    assert.equal(db.prepare('SELECT email FROM admin_users WHERE id = ?').get(target).email, `target${hub}@example.com`, 'the email was not changed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_invite_tokens').get().n, 0, 'no reset link was made');
  });
}

test('S1 a CRM Admin can still invite: the new admin is Read-only unless a role is named, a bad role is refused, and each action is audited', async () => {
  env.enable(db, true);
  let r = await call('POST', '/api/auth/admins', { username: 'newbie', email: 'newbie@school.example.com' }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(db.prepare("SELECT crm_role FROM admin_users WHERE username = 'newbie'").get().crm_role, 'readonly', 'least privilege by default');
  r = await call('POST', '/api/auth/admins', { username: 'seller', email: 'seller@school.example.com', crmRole: 'sales' }, owner);
  assert.equal(r.status, 201);
  assert.equal(db.prepare("SELECT crm_role FROM admin_users WHERE username = 'seller'").get().crm_role, 'sales');
  r = await call('POST', '/api/auth/admins', { username: 'bad', email: 'bad@school.example.com', crmRole: 'superuser' }, owner);
  assert.equal(r.status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admin_users WHERE username = 'bad'").get().n, 0);
  const id = db.prepare("SELECT id FROM admin_users WHERE username = 'newbie'").get().id;
  assert.equal((await call('PUT', `/api/auth/admins/${id}`, { username: 'newbie2', email: 'newbie2@school.example.com' }, owner)).status, 200);
  assert.equal((await call('DELETE', `/api/auth/admins/${id}`, {}, owner)).status, 200);
  assert.equal(audits('admin_invited').length, 2);
  assert.equal(audits('admin_edited').length, 1);
  assert.equal(audits('admin_deleted').length, 1);
  assert.equal(audits('admin_invited')[0].actor_id, owner);
});

test('S2 accepting a quote for the customer is CRM Admin only, Hub on or off', async () => {
  for (const hub of [true, false]) {
    env.enable(db, hub);
    const q = env.addQuote(db, 'buyer@school.example.com', { amountCents: 50000, sentAt: '2026-11-01 10:00:00' });
    for (const who of [rep, viewer]) {
      const r = await call('POST', `/api/admin/concierge/quotes/${q}/accept`, { poNumber: 'PO-1' }, who);
      assert.equal(r.status, 403, `Hub ${hub}`);
    }
    assert.equal(db.prepare('SELECT accepted_at FROM quote_requests WHERE id = ?').get(q).accepted_at, null);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM purchases WHERE quote_id = ?').get(q).n, 0, 'no purchase was made');
  }
  env.enable(db, true);
});

test('S4 the accept link never goes back to the browser: not in the list, not in an edit, not for any role', async () => {
  env.enable(db, true);
  const q = env.addQuote(db, 'tokens@school.example.com', { amountCents: 70000 });
  for (const who of [owner, rep, viewer]) {
    const list = await call('GET', '/api/contact/quotes', undefined, who);
    assert.equal(list.status, 200);
    const row = list.json.quotes.find(x => x.id === q);
    assert.ok(row);
    assert.equal('accept_token' in row, false, 'no token field');
    assert.doesNotMatch(JSON.stringify(list.json), /secret-token-value/);
    assert.equal(row.has_accept_link, true, 'the page can still tell a link exists');
  }
  const put = await call('PUT', `/api/contact/quotes/${q}`, { notes: 'hello' }, owner);
  assert.equal(put.status, 200);
  assert.doesNotMatch(JSON.stringify(put.json), /secret-token-value/);
});

test('S3 quote edits: Read-only cannot edit, create, revise or copy; Sales can edit a draft but not re-price a sent quote; a CRM Admin can, and it is audited', async () => {
  env.enable(db, true);
  const draft = env.addQuote(db, 'draft@school.example.com', { amountCents: 10000 });
  const sent = env.addQuote(db, 'sent@school.example.com', { amountCents: 90000, sentAt: '2026-11-01 10:00:00' });

  assert.equal((await call('PUT', `/api/contact/quotes/${draft}`, { notes: 'x' }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/contact/quotes', { email: 'new@school.example.com' }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/contact/quotes/${sent}/revise`, {}, viewer)).status, 403);
  assert.equal((await call('POST', `/api/contact/quotes/${sent}/copy`, {}, viewer)).status, 403);
  assert.equal((await call('POST', `/api/contact/quotes/${sent}/send`, { quotedAmountCents: 1, quotedProductName: 'x' }, viewer)).status, 403);
  assert.equal(db.prepare('SELECT quoted_amount_cents a FROM quote_requests WHERE id = ?').get(sent).a, 90000);

  // Sales: a draft is theirs to price; a sent quote is not.
  assert.equal((await call('PUT', `/api/contact/quotes/${draft}`, { quotedAmountCents: 12000 }, rep)).status, 200);
  let r = await call('PUT', `/api/contact/quotes/${sent}`, { quotedAmountCents: 1 }, rep);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'price_locked');
  assert.equal(db.prepare('SELECT quoted_amount_cents a FROM quote_requests WHERE id = ?').get(sent).a, 90000, 'price unchanged');
  // Sales can still change non-price fields of a sent quote, and re-saving the same price is not a change.
  assert.equal((await call('PUT', `/api/contact/quotes/${sent}`, { notes: 'called them', quotedAmountCents: 90000 }, rep)).status, 200);
  assert.equal(audits('quote_price_changed').length, 0);
  r = await call('POST', `/api/contact/quotes/${sent}/send`, { quotedAmountCents: 1, quotedProductName: 'Group license' }, rep);
  assert.equal(r.status, 403); assert.equal(r.json.code, 'price_locked');

  // CRM Admin: allowed, and the old and new price are written down.
  assert.equal((await call('PUT', `/api/contact/quotes/${sent}`, { quotedAmountCents: 85000 }, owner)).status, 200);
  const a = audits('quote_price_changed');
  assert.equal(a.length, 1);
  assert.equal(JSON.parse(a[0].prev_value).quoted_amount_cents, 90000);
  assert.equal(JSON.parse(a[0].new_value).quoted_amount_cents, 85000);
  assert.equal(a[0].actor_id, owner);
});

test('S3 an accepted quote cannot be re-priced or sent again by anyone, CRM Admin included', async () => {
  env.enable(db, true);
  const q = env.addQuote(db, 'accepted@school.example.com', { amountCents: 60000, sentAt: '2026-11-01 10:00:00' });
  db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-02 09:00:00' WHERE id = ?").run(q);
  let r = await call('PUT', `/api/contact/quotes/${q}`, { quotedAmountCents: 1 }, owner);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'already_accepted');
  r = await call('POST', `/api/contact/quotes/${q}/send`, { quotedAmountCents: 1, quotedProductName: 'x' }, owner);
  assert.equal(r.status, 409); assert.equal(r.json.code, 'already_accepted');
  assert.equal(db.prepare('SELECT quoted_amount_cents a FROM quote_requests WHERE id = ?').get(q).a, 60000);
  assert.equal((await call('PUT', `/api/contact/quotes/${q}`, { notes: 'a note is still fine' }, owner)).status, 200);
});

test('before the CRM role column exists nothing is locked out (deploy order is safe)', async () => {
  const perms = R('lib/crm-permissions.js');
  const gate = perms.requireCrmRole('write');
  const brokenPool = { query: async () => { const e = new Error('no such column'); e.code = 'ER_BAD_FIELD_ERROR'; throw e; } };
  const poolMod = R('db/pool.js');
  const saved = poolMod.query;
  poolMod.query = brokenPool.query;
  try {
    let passed = false;
    await gate({ user: { userId: 1 } }, { status: () => ({ json: () => { throw new Error('should not refuse'); } }) }, () => { passed = true; });
    assert.equal(passed, true);
  } finally { poolMod.query = saved; }
});

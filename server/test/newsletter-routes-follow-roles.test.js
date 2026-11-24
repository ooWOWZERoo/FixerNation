// The older /api/newsletter routes that only the retired CRM page used (contact edit and delete, resend verification, roles, email groups, a person's purchases, seats, the old import) now follow the
// CRM role matrix, so a Read-only admin who knows the addresses can no longer change anything through them (decision D5 of docs/reference/contact-pages-merge-requirements.md, closed for good).
// The routes other pages still call (the Licenses, Orders, Quotes, Campaigns and School Admins pages, the dashboard count, public sign-up, the unsubscribe link) are left exactly as they were.
// Real routes, real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['first_name TEXT', 'last_name TEXT', 'role TEXT', 'email_verified INTEGER DEFAULT 0', 'is_fne_staff INTEGER DEFAULT 0']) db.exec(`ALTER TABLE site_users ADD COLUMN ${col}`);
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/newsletter', R('newsletter.js').router]]);
test.after(() => server.close());
const perms = require(path.join(env.SERVER, 'lib/crm-permissions.js'));

const boss = env.addAdmin(db, 'gateboss', 'admin'), rep = env.addAdmin(db, 'gaterep', 'sales'), viewer = env.addAdmin(db, 'gateviewer', 'readonly');
env.enable(db, true);

// [method, path, action the route needs, body]. Ids that do not exist: a person allowed in answers 404 or 400, never 403 or 401.
const GATED = [
  ['PUT', '/contacts/99999', 'write', { name: 'x' }],
  ['DELETE', '/contacts/99999', 'erase', {}],
  ['POST', '/contacts/99999/resend-verification', 'write', {}],
  ['GET', '/contacts/99999/roles', 'view'],
  ['POST', '/groups', 'write', {}],
  ['DELETE', '/groups/99999', 'write', {}],
  ['GET', '/contacts/99999/purchases', 'view'],
  ['POST', '/contacts/99999/purchases', 'manage_purchases', { productType: 'single_license' }],
  ['DELETE', '/purchases/99999', 'manage_purchases', {}],
  ['PUT', '/purchases/99999/seats/1', 'manage_purchases', {}],
  ['POST', '/purchases/99999/seats/1/register', 'manage_purchases', {}],
  ['POST', '/purchases/99999/seats/1/unregister', 'manage_purchases', {}],
  ['POST', '/contacts/import', 'write', { rows: [] }],
];
const who = { admin: boss, sales: rep, readonly: viewer };

test('THE THIRTEEN: signed out is 401, and each role gets exactly what the matrix says for the action the route needs, with the Hub on or off', async () => {
  assert.equal(GATED.length, 13);
  for (const hub of [true, false]) {
    env.enable(db, hub);
    for (const [m, p, action, body] of GATED) {
      assert.equal((await call(m, '/api/newsletter' + p, m === 'GET' ? undefined : body)).status, 401, `${m} ${p} signed out`);
      for (const [role, id] of Object.entries(who)) {
        const r = await call(m, '/api/newsletter' + p, m === 'GET' ? undefined : body, id);
        const allowed = perms.can(role, action);
        if (allowed) assert.ok(![401, 403].includes(r.status), `${m} ${p} as ${role} (Hub ${hub ? 'on' : 'off'}) should be let in, got ${r.status}`);
        else assert.equal(r.status, 403, `${m} ${p} as ${role} (Hub ${hub ? 'on' : 'off'}) should be refused`);
      }
    }
  }
  env.enable(db, true);
});

test('A READ-ONLY ADMIN CAN NO LONGER CHANGE ANYTHING through them, and nothing was touched', async () => {
  const id = env.addContact(db, 'untouched@school.org', 'Untouched Person');
  assert.equal((await call('PUT', `/api/newsletter/contacts/${id}`, { name: 'Changed', status: 'Unsubscribed' }, viewer)).status, 403);
  assert.equal((await call('DELETE', `/api/newsletter/contacts/${id}`, {}, viewer)).status, 403);
  assert.equal((await call('POST', '/api/newsletter/groups', { name: 'Sneaky' }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/newsletter/contacts/${id}/purchases`, { productType: 'single_license' }, viewer)).status, 403);
  assert.equal((await call('POST', '/api/newsletter/contacts/import', { rows: [{ email: 'sneaky@school.org' }] }, viewer)).status, 403);
  const row = db.prepare('SELECT name, status FROM newsletter_contacts WHERE id = ?').get(id);
  assert.deepEqual([row.name, row.status], ['Untouched Person', 'Subscribed']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE contact_id = ?').get(id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM newsletter_contacts WHERE email = 'sneaky@school.org'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_groups').get().n, 0);
  // reading is still allowed
  assert.equal((await call('GET', `/api/newsletter/contacts/${id}/purchases`, undefined, viewer)).status, 200);
});

test('THE GATED SET IS EXACTLY THESE THIRTEEN: the routes other pages still call keep their old behavior, and a new route cannot be added ungated by accident', () => {
  const src = fs.readFileSync(path.join(env.SERVER, 'routes', 'newsletter.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const all = [...src.matchAll(/^router\.(get|post|put|delete)\('([^']+)',\s*([^\n]*)/gm)].map(m => ({ key: `${m[1].toUpperCase()} ${m[2]}`, gated: /requireCrmRole\('([a-z_]+)'\)/.exec(m[3]) }));
  const gated = all.filter(r => r.gated).map(r => `${r.key} ${r.gated[1]}`).sort();
  const want = GATED.map(([m, p, a]) => `${m} ${p.replace('99999', ':id').replace(/\/seats\/1/, '/seats/:seatId').replace(/^\/purchases\/:id\/seats/, '/purchases/:purchaseId/seats')} ${a}`).sort();
  assert.deepEqual(gated, want);
  // The routes with callers on other pages stay as they were.
  const KEEP = ['POST /contacts', 'GET /contacts', 'GET /contacts/search', 'GET /groups', 'GET /unsubscribe', 'GET /purchases', 'GET /purchases/by-domain', 'DELETE /purchases/by-domain', 'PUT /purchases/:id', 'PUT /purchases/:id/license-dates', 'PUT /seats/:seatId/audiences'];
  for (const k of KEEP) assert.ok(all.some(r => r.key === k && !r.gated), `${k} is still as it was (no role gate)`);
  assert.equal(all.length, 24, 'every route in the file is accounted for');
});

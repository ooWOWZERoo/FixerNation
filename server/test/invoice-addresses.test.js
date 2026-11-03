// Invoice Bill To / Ship To through the real routes on a real SQL engine (node:sqlite): editing one invoice changes only that invoice,
// older invoices keep reading the contact, new invoices save their own copy, every edit is audited, only an admin can edit.
// Rules: docs/reference/invoice-bill-ship-to-requirements.md
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
const SHIP = 'ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT';
db.exec(`
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY, name TEXT, email TEXT, company TEXT, street TEXT, city TEXT, state TEXT, zip TEXT, ${SHIP});
CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT, contact_id INTEGER, po_number TEXT, total_cents INTEGER, status TEXT DEFAULT 'unpaid',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, paid_at TEXT, po_received_date TEXT,
  bill_to_name TEXT, bill_to_company TEXT, bill_to_email TEXT, bill_to_street TEXT, bill_to_city TEXT, bill_to_state TEXT, bill_to_zip TEXT, bill_to_saved_at TEXT, ${SHIP});
CREATE TABLE purchases (id INTEGER PRIMARY KEY, invoice_id INTEGER, quote_id INTEGER, payment_method TEXT, license_duration_days INTEGER);
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY, quote_number TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER,
  purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT);
`);
function run(sql, params = []) {
  let s = sql.trim(); const flat = []; let i = 0;
  s = s.replace(/\?/g, () => { const p = params[i++]; if (Array.isArray(p)) { flat.push(...p); return p.map(() => '?').join(', ') || 'NULL'; } flat.push(p instanceof Date ? p.toISOString() : p); return '?'; });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...flat)];
  const r = db.prepare(s).run(...flat);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
}
const query = async (sql, params) => run(sql, params);
const pool = { query, async getConnection() { return { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }; } };

const emailed = [];
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: pool,
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => (req.get('x-admin') ? ((req.user = { userId: 1, username: 'staff' }), next()) : res.status(401).json({ error: 'no' })), getAuthUser: () => null },
  [path.join(SERVER, 'routes/newsletter.js')]: { attachPurchaseDetails: async () => [] },
  [path.join(SERVER, 'lib/mailer.js')]: { sendInvoiceEmail: async (m) => { emailed.push(m); } },
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async () => {} },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { approveForInvoice: async () => {}, reverseForInvoice: async () => {} },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
require('express-async-errors');
const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/invoices', require(path.join(SERVER, 'routes/invoices.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
const { insertInvoice } = require(path.join(SERVER, 'lib/invoice-parties.js'));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, body, admin = true) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = admin ? { 'x-admin': '1' } : {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers, timeout: 5000 }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function reset() {
  db.exec('DELETE FROM newsletter_contacts; DELETE FROM invoices; DELETE FROM school_audit_log; DELETE FROM purchases;');
  db.exec(`INSERT INTO newsletter_contacts (id, name, email, company, street, city, state, zip, ship_to_street, ship_to_city, ship_to_state, ship_to_zip)
           VALUES (1, 'Dana Rowe', 'dana@oak.edu', 'Oak Hill HS', '1 Main St', 'Albion', 'NY', '14411', '9 Dock Rd', 'Albion', 'NY', '14411')`);
  // Two older invoices (no saved Bill To) for the same contact
  db.exec("INSERT INTO invoices (id, invoice_number, contact_id, po_number, total_cents) VALUES (1, 'INV-1', 1, 'PO-1', 97900), (2, 'INV-2', 1, 'PO-2', 5000)");
  emailed.length = 0;
}
const bill = { name: 'Accounts Payable', company: 'Albion CSD', email: 'ap@csd.org', street: '2 Elm St', city: 'Albion', state: 'NY', zip: '14411' };
const ship = { name: 'Receiving', company: 'Albion CSD', street: '5 Depot Rd', city: 'Medina', state: 'NY', zip: '14103' };

test('an older invoice reads Bill To from the contact and has no Ship To', async () => {
  reset();
  const { invoice } = (await call('GET', '/api/invoices/1')).json;
  assert.equal(invoice.billTo.company, 'Oak Hill HS');
  assert.equal(invoice.billTo.street, '1 Main St');
  assert.equal(invoice.billToIsOwn, false);
  assert.equal(invoice.shipTo.street, '');
  assert.equal(invoice.buyer.address.street, '1 Main St');
});

test('editing Bill To changes that invoice only: the contact and the other invoice are untouched', async () => {
  reset();
  const r = await call('PUT', '/api/invoices/1/addresses', { billTo: bill });
  assert.equal(r.status, 200);
  assert.equal(r.json.invoice.billTo.company, 'Albion CSD');
  assert.equal(r.json.invoice.billToIsOwn, true);
  const c = db.prepare('SELECT * FROM newsletter_contacts WHERE id = 1').get();
  assert.equal(c.company, 'Oak Hill HS');
  assert.equal(c.street, '1 Main St');
  const other = (await call('GET', '/api/invoices/2')).json.invoice;
  assert.equal(other.billTo.company, 'Oak Hill HS');
  assert.equal(other.billToIsOwn, false);
});

test('a later change to the contact does not rewrite an invoice that has its own Bill To, but does follow an older one', async () => {
  reset();
  await call('PUT', '/api/invoices/1/addresses', { billTo: bill });
  db.exec("UPDATE newsletter_contacts SET company = 'Renamed Co', street = '3 New St' WHERE id = 1");
  assert.equal((await call('GET', '/api/invoices/1')).json.invoice.billTo.company, 'Albion CSD');
  assert.equal((await call('GET', '/api/invoices/2')).json.invoice.billTo.company, 'Renamed Co');
});

test('editing only Ship To leaves Bill To reading the contact; clearing Ship To empties it', async () => {
  reset();
  const r = await call('PUT', '/api/invoices/1/addresses', { shipTo: ship });
  assert.equal(r.json.invoice.shipTo.street, '5 Depot Rd');
  assert.equal(r.json.invoice.billToIsOwn, false);
  assert.equal(r.json.invoice.billTo.company, 'Oak Hill HS');
  const cleared = await call('PUT', '/api/invoices/1/addresses', { shipTo: {} });
  assert.equal(cleared.json.invoice.shipTo.street, '');
});

test('paid and cancelled invoices can still have an address corrected', async () => {
  reset();
  db.exec("UPDATE invoices SET status = 'paid' WHERE id = 1; UPDATE invoices SET status = 'cancelled' WHERE id = 2");
  assert.equal((await call('PUT', '/api/invoices/1/addresses', { billTo: bill })).status, 200);
  assert.equal((await call('PUT', '/api/invoices/2/addresses', { shipTo: ship })).status, 200);
});

test('every real change is audited with the old and new values; an unchanged save is not', async () => {
  reset();
  await call('PUT', '/api/invoices/1/addresses', { billTo: bill, shipTo: ship });
  let rows = db.prepare("SELECT * FROM school_audit_log WHERE action = 'invoice_addresses_updated'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_type, 'invoice');
  assert.equal(rows[0].entity_id, 1);
  assert.equal(rows[0].purchase_id, null, 'kept out of the school admins\' purchase-scoped history');
  assert.equal(rows[0].actor_email, 'staff');
  assert.equal(JSON.parse(rows[0].prev_value).billTo.company, 'Oak Hill HS');
  assert.equal(JSON.parse(rows[0].new_value).billTo.company, 'Albion CSD');
  await call('PUT', '/api/invoices/1/addresses', { billTo: bill, shipTo: ship });
  rows = db.prepare("SELECT * FROM school_audit_log WHERE action = 'invoice_addresses_updated'").all();
  assert.equal(rows.length, 1, 'saving the same values again writes nothing new');
});

test('bad input is refused and nothing changes', async () => {
  reset();
  for (const body of [
    {},
    { billTo: { ...bill, name: '', company: '' } },
    { billTo: { ...bill, email: 'nope' } },
    { billTo: { ...bill, street: 'x'.repeat(300) } },
    { shipTo: { street: 42 } },
  ]) {
    assert.equal((await call('PUT', '/api/invoices/1/addresses', body)).status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await call('PUT', '/api/invoices/999/addresses', { billTo: bill })).status, 404);
  assert.equal(db.prepare('SELECT bill_to_saved_at FROM invoices WHERE id = 1').get().bill_to_saved_at, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM school_audit_log").get().n, 0);
});

test('only an FNE admin can read or edit invoice addresses', async () => {
  reset();
  assert.equal((await call('PUT', '/api/invoices/1/addresses', { billTo: bill }, false)).status, 401);
  assert.equal((await call('GET', '/api/invoices/1', undefined, false)).status, 401);
});

test('resending an invoice emails the invoice\'s own Bill To and Ship To', async () => {
  reset();
  await call('PUT', '/api/invoices/1/addresses', { billTo: bill, shipTo: ship });
  const r = await call('POST', '/api/invoices/1/resend', {});
  assert.equal(r.status, 200);
  assert.equal(emailed[0].to, 'ap@csd.org');
  assert.equal(emailed[0].billTo.company, 'Albion CSD');
  assert.equal(emailed[0].shipTo.street, '5 Depot Rd');
});

test('a new cart invoice saves Bill To and Ship To from the contact', async () => {
  reset();
  const r = await insertInvoice(pool, { contact_id: 1, po_number: 'PO-9', total_cents: 100, status: 'unpaid' }, null);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.insertId);
  assert.equal(inv.bill_to_company, 'Oak Hill HS');
  assert.equal(inv.bill_to_street, '1 Main St');
  assert.ok(inv.bill_to_saved_at);
  assert.equal(inv.ship_to_street, '9 Dock Rd');
  db.exec("UPDATE newsletter_contacts SET company = 'Changed' WHERE id = 1");
  assert.equal((await call('GET', `/api/invoices/${r.insertId}`)).json.invoice.billTo.company, 'Oak Hill HS', 'a new invoice does not follow later contact edits');
});

test('a quote invoice saves the quote\'s Bill To (blank address from the contact) and its Ship To', async () => {
  reset();
  const quote = { first_name: 'Bea', last_name: 'Buyer', school: 'Albion CSD', email: 'bea@csd.org', ship_to_name: 'Receiving', ship_to_street: '5 Depot Rd', ship_to_city: 'Medina', ship_to_state: 'NY', ship_to_zip: '14103' };
  const r = await insertInvoice(pool, { contact_id: 1, po_number: 'PO-7', total_cents: 97900, status: 'unpaid', paid_at: null }, quote);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(r.insertId);
  assert.deepEqual([inv.bill_to_name, inv.bill_to_company, inv.bill_to_email, inv.bill_to_street], ['Bea Buyer', 'Albion CSD', 'bea@csd.org', '1 Main St']);
  assert.deepEqual([inv.ship_to_name, inv.ship_to_street, inv.ship_to_city], ['Receiving', '5 Depot Rd', 'Medina']);
});

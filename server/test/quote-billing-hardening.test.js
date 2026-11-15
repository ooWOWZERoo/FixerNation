// Sales CRM phase 4a: billing hardening for quote acceptance (docs/reference/sales-crm-update-requirements.md, "4a spec").
// Real routes and real SQL (node:sqlite, with real BEGIN / ROLLBACK on the one connection): a PO acceptance is all-or-nothing, the card
// webhook accepts a quote once however often Stripe delivers it, money for an already-accepted quote is reported not dropped, a second click
// on the card button reuses the open purchase, and "the purchase for this quote" is the paid one.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
process.env.SITE_URL = 'https://example.test';
const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT NOT NULL UNIQUE, company TEXT, street TEXT, city TEXT, state TEXT, zip TEXT,
  ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT, source TEXT, status TEXT);
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, school TEXT, quote_number TEXT, accept_token TEXT,
  quote_valid_until TEXT, accepted_at TEXT, accepted_payment_method TEXT, status TEXT, quoted_product_id INTEGER, quoted_product_name TEXT,
  quoted_seat_count INTEGER, quoted_amount_cents INTEGER, quoted_school_domain TEXT, quoted_term_years INTEGER,
  bill_to_street TEXT, bill_to_city TEXT, bill_to_state TEXT, bill_to_zip TEXT, ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, product_type TEXT, book_id INTEGER, license_product_id INTEGER, seat_count INTEGER,
  purchased_at TEXT DEFAULT CURRENT_TIMESTAMP, source TEXT, notes TEXT, stripe_session_id TEXT, stripe_invoice_id TEXT, school_domain TEXT, school_id INTEGER,
  payment_method TEXT, payment_status TEXT, po_number TEXT, invoice_id INTEGER, amount_cents INTEGER, trial_expiration_date TEXT, trial_lesson_limit INTEGER,
  trial_library_limit INTEGER, conversion_credit_cents INTEGER, quote_id INTEGER, license_duration_days INTEGER, effective_date TEXT, expiration_date TEXT, license_status TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, invited_email TEXT, status TEXT);
CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER, po_number TEXT, total_cents INTEGER, status TEXT, paid_at TEXT, invoice_number TEXT,
  bill_to_name TEXT, bill_to_company TEXT, bill_to_email TEXT, bill_to_street TEXT, bill_to_city TEXT, bill_to_state TEXT, bill_to_zip TEXT, bill_to_saved_at TEXT,
  ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT UNIQUE);
CREATE TABLE contact_groups (id INTEGER PRIMARY KEY, system_key TEXT);
CREATE TABLE contact_group_members (contact_id INTEGER, group_id INTEGER);
CREATE TABLE site_users (id INTEGER PRIMARY KEY, email TEXT, role TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, permission_level TEXT, is_active INTEGER);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER,
  purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT);
`);

// mysql2 niceties SQLite lacks: IN (?) arrays, Date values, undefined, NOW(), INSERT IGNORE, FOR UPDATE.
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\bINSERT IGNORE\b/gi, 'INSERT OR IGNORE').replace(/\s+FOR UPDATE\s*$/i, '')
    .replace(/\?/g, () => {
      const p = rawParams[i++];
      if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
      params.push(p instanceof Date ? p.toISOString() : p === undefined ? null : p);
      return '?';
    });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const conn = {
  query: run,
  beginTransaction: async () => db.exec('BEGIN'),
  commit: async () => db.exec('COMMIT'),
  rollback: async () => { if (db.isTransaction) db.exec('ROLLBACK'); },
  release() {},
};
const fakePool = { query: run, getConnection: async () => conn };

const alerts = [];
const automations = [];
const invoiceNumber = { failNext: false };
let sessionCounter = 0;
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: fakePool,
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({ sendSalesAlertEmail: async (a) => { alerts.push(a); }, sendAutomationEmail: async () => {} }, { get: (t, k) => (k in t ? t[k] : async () => {}) }),
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async (name, a) => { automations.push({ name, ...a }); } },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { attributePurchase: async () => {}, refCodeFromRequest: () => null, codeForAffiliateId: async () => null },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
  [path.join(SERVER, 'lib/crm-hooks.js')]: { contactChanged: async () => {}, purchaseChanged: async () => {}, invoiceChanged: async () => {}, contactChangedByEmail: async () => {} },
  [path.join(SERVER, 'lib/own-seat-claim.js')]: { claimForAccountByEmail: async () => {}, claimOwnPurchaseSeats: async () => {}, findClaimableSeats: async () => [] },
  [path.join(SERVER, 'lib/invoice-numbering.js')]: {
    generateInvoiceNumber: async (c, id) => {
      if (invoiceNumber.failNext) { invoiceNumber.failNext = false; throw new Error('numbering failed'); }
      await c.query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [`INV-${id}`, id]);
    },
  },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => 'sales@example.test' },
  [path.join(SERVER, 'lib/account-closing.js')]: { describeConsequences: () => {}, consequencesText: () => '', hasRoles: () => false, closeAccount: async () => {} },
  [path.join(SERVER, 'lib/crm-ownership.js')]: { dealCountForContact: async () => 0, workItemCountForContact: async () => 0 },
  [path.join(SERVER, 'lib/seat-counts.js')]: { notAdminSeatClause: () => '1=1' },
  [path.join(SERVER, 'lib/seat-renewal.js')]: { RENEWED_STATUSES: [], restoreExpiredSeats: async () => {} },
  [path.join(SERVER, 'lib/site-tokens.js')]: { createToken: async () => 'tok' },
  [path.join(SERVER, 'lib/access.js')]: { getSiteUser: async () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'stripe') {
    return class Stripe {
      constructor() {
        this.webhooks = { constructEvent: (body) => JSON.parse(String(body)) };
        this.checkout = { sessions: { create: async () => { sessionCounter += 1; return { id: `cs_${sessionCounter}`, url: `https://stripe.test/pay/cs_${sessionCounter}` }; } } };
      }
    };
  }
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const quoteAccept = require(path.join(SERVER, 'routes/quote-accept.js'));
const { webhookHandler } = require(path.join(SERVER, 'routes/checkout.js'));
const { purchaseIdForQuote } = require(path.join(SERVER, 'lib/quote-purchase.js'));
const app = express();
app.use(express.json());
app.use('/api/quote', quoteAccept.router);
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port, method: 'POST', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); });
    req.on('error', reject); req.write(data); req.end();
  });
}
async function deliver(session, type = 'checkout.session.completed') {
  let out;
  const res = { json: (b) => { out = { status: 200, body: b }; return res; }, status(c) { this.code = c; return this; }, send(b) { out = { status: this.code, body: b }; return res; } };
  await webhookHandler({ headers: { 'stripe-signature': 'x' }, body: Buffer.from(JSON.stringify({ type, data: { object: session } })) }, res);
  return out;
}

let nextQuote = 100;
function makeQuote({ cents = 50000, seats = 5, email } = {}) {
  const id = nextQuote++;
  db.prepare(`INSERT INTO quote_requests (id, email, first_name, last_name, school, quote_number, accept_token, quoted_product_name, quoted_seat_count, quoted_amount_cents, quoted_term_years, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'contacted')`).run(id, email || `buyer${id}@school.example.com`, 'Bea', 'Buyer', 'Albion CSD', `Q-${id}`, `token-${id}`, 'Department Plan', seats, cents, 1);
  return { id, token: `token-${id}` };
}
const count = (table, where = '1=1', ...p) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...p).n;
const quoteRow = (id) => db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id);
const resetNoise = () => { alerts.length = 0; automations.length = 0; };

// ---- 1. PO acceptance is all or nothing ----
test('PO accept: a failure part-way undoes everything, the link still works, and the retry makes exactly one purchase and one invoice', async () => {
  resetNoise();
  const q = makeQuote();
  invoiceNumber.failNext = true;
  const first = await post('/api/quote/accept', { token: q.token, paymentMethod: 'po', poNumber: 'PO-1' });
  assert.equal(first.status, 500, 'the buyer is told it failed');
  assert.equal(quoteRow(q.id).accepted_at, null, 'the quote is NOT left half-accepted');
  assert.equal(quoteRow(q.id).status, 'contacted');
  assert.equal(count('purchases', 'quote_id = ?', q.id), 0, 'no purchase');
  assert.equal(count('license_seats', 'purchase_id IN (SELECT id FROM purchases WHERE quote_id = ?)', q.id), 0, 'no seats');
  assert.equal(count('invoices', 'po_number = ?', 'PO-1'), 0, 'no invoice');

  const retry = await post('/api/quote/accept', { token: q.token, paymentMethod: 'po', poNumber: 'PO-1' });
  assert.equal(retry.status, 200, 'the same link works again');
  assert.equal(count('purchases', 'quote_id = ?', q.id), 1);
  assert.equal(count('invoices', 'po_number = ?', 'PO-1'), 1);
  const p = db.prepare('SELECT * FROM purchases WHERE quote_id = ?').get(q.id);
  assert.equal(p.license_status, 'pending');
  assert.equal(p.invoice_id, retry.json.invoiceId);
  assert.equal(count('license_seats', 'purchase_id = ?', p.id), 5);
  assert.equal(quoteRow(q.id).accepted_payment_method, 'po');
});

test('PO accept: a second accept of the same quote is refused and makes nothing new', async () => {
  const q = makeQuote();
  const a = await post('/api/quote/accept', { token: q.token, paymentMethod: 'po', poNumber: 'PO-2' });
  assert.equal(a.status, 200);
  const b = await post('/api/quote/accept', { token: q.token, paymentMethod: 'po', poNumber: 'PO-2' });
  assert.equal(b.status, 400);
  assert.equal(count('purchases', 'quote_id = ?', q.id), 1);
  assert.equal(count('invoices', 'po_number = ?', 'PO-2'), 1);
});

test('PO accept: a $0 quote still activates at once with a paid invoice and no PO number', async () => {
  const q = makeQuote({ cents: 0, seats: 1 });
  const r = await post('/api/quote/accept', { token: q.token, paymentMethod: 'po', poNumber: '' });
  assert.equal(r.status, 200);
  const p = db.prepare('SELECT * FROM purchases WHERE quote_id = ?').get(q.id);
  assert.equal(p.payment_status, 'paid');
  assert.notEqual(p.license_status, 'pending');
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id = ?').get(p.invoice_id).status, 'paid');
});

// ---- 2 and 4. Card: one open purchase per quote, session saved on it, webhook accepts once ----
const sessionFor = (q, purchaseId, id, amount = 50000) => ({ id, amount_total: amount, metadata: { type: 'quote_acceptance', quoteToken: q.token, purchaseId: String(purchaseId) } });

test('card: three clicks make one open purchase with one set of seats, and the latest Stripe session is saved on it', async () => {
  const q = makeQuote();
  const sessions = [];
  for (let i = 0; i < 3; i++) {
    const r = await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' });
    assert.equal(r.status, 200);
    sessions.push(r.json.stripeUrl.split('/').pop());
  }
  assert.equal(new Set(sessions).size, 3, 'each click gets its own Stripe session');
  assert.equal(count('purchases', 'quote_id = ?', q.id), 1, 'but there is only one purchase');
  const p = db.prepare('SELECT * FROM purchases WHERE quote_id = ?').get(q.id);
  assert.equal(count('license_seats', 'purchase_id = ?', p.id), 5, 'one set of seats, not three');
  assert.equal(p.payment_status, 'pending');
  assert.equal(p.stripe_session_id, sessions[2]);
});

test('card webhook: the session the buyer actually paid flips the purchase, and a replay changes and sends nothing more', async () => {
  resetNoise();
  const q = makeQuote();
  const first = await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' });
  const firstSession = first.json.stripeUrl.split('/').pop();
  await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' }); // a later click overwrites the saved session
  const p = db.prepare('SELECT * FROM purchases WHERE quote_id = ?').get(q.id);
  assert.notEqual(p.stripe_session_id, firstSession);

  // The buyer pays the FIRST session; the saved one is the second. The purchase is still found, through metadata.purchaseId.
  const ev = sessionFor(q, p.id, firstSession);
  assert.deepEqual((await deliver(ev)).body, { received: true });
  assert.equal(db.prepare('SELECT payment_status FROM purchases WHERE id = ?').get(p.id).payment_status, 'paid');
  assert.equal(db.prepare('SELECT stripe_session_id FROM purchases WHERE id = ?').get(p.id).stripe_session_id, firstSession, 'the paid session is recorded');
  assert.equal(quoteRow(q.id).accepted_payment_method, 'card');
  assert.equal(automations.filter((a) => a.name === 'quote_accepted').length, 1);
  assert.equal(alerts.length, 1);

  await deliver(ev); // Stripe retries
  await deliver(ev);
  assert.equal(automations.filter((a) => a.name === 'quote_accepted').length, 1, 'no second set-up email');
  assert.equal(alerts.length, 1, 'no second alert, and a replay is not reported as a duplicate payment');
  assert.equal(count('school_audit_log'), count('school_audit_log', "action NOT LIKE 'payment_on_accepted_quote'"), 'no duplicate-payment audit row from a replay');
  assert.equal(count('purchases', 'quote_id = ?', q.id), 1);
});

test('card webhook: a session opened before this release (no saved session id, purchase named only in the metadata) still works', async () => {
  resetNoise();
  const q = makeQuote();
  const cid = Number(db.prepare("INSERT INTO newsletter_contacts (name, email) VALUES ('Old', ?)").run(`old${q.id}@x.example.com`).lastInsertRowid);
  const pid = Number(db.prepare("INSERT INTO purchases (contact_id, product_type, seat_count, payment_method, payment_status, quote_id, amount_cents) VALUES (?, 'group_license', 5, 'card', 'pending', ?, 50000)").run(cid, q.id).lastInsertRowid);
  await deliver(sessionFor(q, pid, 'cs_legacy'));
  assert.equal(db.prepare('SELECT payment_status FROM purchases WHERE id = ?').get(pid).payment_status, 'paid');
  assert.equal(quoteRow(q.id).status, 'converted');
});

test('card webhook: a purchase that belongs to a different quote is never marked paid by this quote\'s payment', async () => {
  resetNoise();
  const q = makeQuote();
  const other = makeQuote();
  const cid = Number(db.prepare("INSERT INTO newsletter_contacts (name, email) VALUES ('Other', ?)").run(`other${q.id}@x.example.com`).lastInsertRowid);
  const otherPurchase = Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_method, payment_status, quote_id) VALUES (?, 'group_license', 'card', 'pending', ?)").run(cid, other.id).lastInsertRowid);
  await deliver(sessionFor(q, otherPurchase, 'cs_cross'));
  assert.equal(db.prepare('SELECT payment_status FROM purchases WHERE id = ?').get(otherPurchase).payment_status, 'pending');
});

// ---- 3 and 6. Money that does not fit ----
test('card payment after the quote was accepted by PO: nothing changes, staff are told, an audit row is written, the code never refunds', async () => {
  resetNoise();
  const q = makeQuote();
  const click = await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' }); // a card checkout is opened first...
  const cardSession = click.json.stripeUrl.split('/').pop();
  const cardPurchase = db.prepare("SELECT id FROM purchases WHERE quote_id = ? AND payment_method = 'card'").get(q.id).id;
  const po = await post('/api/quote/accept', { token: q.token, paymentMethod: 'po', poNumber: 'PO-3' }); // ...then the buyer accepts by PO in another tab
  assert.equal(po.status, 200);
  resetNoise();

  const out = await deliver(sessionFor(q, cardPurchase, cardSession)); // ...and the old card checkout is paid anyway
  assert.deepEqual(out.body, { received: true });
  assert.equal(db.prepare('SELECT payment_status FROM purchases WHERE id = ?').get(cardPurchase).payment_status, 'pending', 'the PO acceptance is untouched');
  assert.equal(quoteRow(q.id).accepted_payment_method, 'po');
  assert.equal(automations.length, 0, 'no second welcome email');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /already-accepted quote/);
  assert.equal(alerts[0].fields['Stripe session'], cardSession);
  assert.match(alerts[0].fields.Note, /refund it by hand/);
  const a = db.prepare("SELECT * FROM school_audit_log WHERE action = 'payment_on_accepted_quote' AND entity_id = ?").get(q.id);
  assert.ok(a, 'audit row written');
  assert.equal(a.purchase_id, null, 'not attached to a purchase, so no school-facing view can show it');
  assert.equal(a.entity_type, 'quote_payment');
});

test('card webhook: a second card session paid for a quote the first session already paid is reported, not silently dropped', async () => {
  resetNoise();
  const q = makeQuote();
  const a = await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' });
  const b = await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' });
  const pid = db.prepare('SELECT id FROM purchases WHERE quote_id = ?').get(q.id).id;
  await deliver(sessionFor(q, pid, a.json.stripeUrl.split('/').pop()));
  assert.equal(alerts.length, 1);
  await deliver(sessionFor(q, pid, b.json.stripeUrl.split('/').pop())); // the buyer paid both tabs
  assert.equal(alerts.length, 2, 'one welcome alert, one duplicate-payment alert');
  assert.match(alerts[1].subject, /already-accepted quote/);
  assert.equal(count('school_audit_log', "action = 'payment_on_accepted_quote' AND entity_id = ?", q.id), 1);
});

test('card webhook: a payment that is not the quoted amount still accepts the quote but leaves an audit row', async () => {
  resetNoise();
  const q = makeQuote({ cents: 50000 });
  await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' });
  const pid = db.prepare('SELECT id FROM purchases WHERE quote_id = ?').get(q.id).id;
  await deliver(sessionFor(q, pid, 'cs_amount', 49900));
  assert.equal(db.prepare('SELECT payment_status FROM purchases WHERE id = ?').get(pid).payment_status, 'paid');
  const row = db.prepare("SELECT * FROM school_audit_log WHERE action = 'quote_payment_amount_differs' AND entity_id = ?").get(q.id);
  assert.ok(row);
  assert.deepEqual(JSON.parse(row.new_value), { stripeSessionId: 'cs_amount', paid: 49900, quoted: 50000 });
});

test('card webhook: a failure while saving leaves the quote unaccepted so Stripe\'s retry can finish the job', async () => {
  resetNoise();
  const q = makeQuote();
  await post('/api/quote/accept', { token: q.token, paymentMethod: 'card' });
  const pid = db.prepare('SELECT id FROM purchases WHERE quote_id = ?').get(q.id).id;
  db.exec('CREATE TRIGGER boom BEFORE UPDATE OF payment_status ON purchases BEGIN SELECT RAISE(ABORT, \'disk full\'); END');
  try {
    await assert.rejects(() => deliver(sessionFor(q, pid, 'cs_boom')));
  } finally { db.exec('DROP TRIGGER boom'); }
  assert.equal(quoteRow(q.id).accepted_at, null);
  await deliver(sessionFor(q, pid, 'cs_boom'));
  assert.equal(db.prepare('SELECT payment_status FROM purchases WHERE id = ?').get(pid).payment_status, 'paid');
});

// ---- 5. "The purchase for this quote" ----
test('purchaseIdForQuote: the paid purchase wins over a newer abandoned one, then the invoiced one, then the newest', async () => {
  const q = makeQuote();
  const cid = Number(db.prepare("INSERT INTO newsletter_contacts (name, email) VALUES ('P', ?)").run(`p${q.id}@x.example.com`).lastInsertRowid);
  const ins = (status, invoice) => Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_method, payment_status, quote_id, invoice_id) VALUES (?, 'group_license', 'card', ?, ?, ?)").run(cid, status, q.id, invoice).lastInsertRowid);
  assert.equal(await purchaseIdForQuote(fakePool, q.id), null);
  const paid = ins('paid', null);
  const abandoned = ins('pending', null);
  assert.equal(await purchaseIdForQuote(fakePool, q.id), paid, 'not the newest');
  const q2 = makeQuote();
  const a = Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_method, payment_status, quote_id) VALUES (?, 'group_license', 'po', 'pending', ?)").run(cid, q2.id).lastInsertRowid);
  const withInvoice = Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_method, payment_status, quote_id, invoice_id) VALUES (?, 'group_license', 'po', 'pending', ?, 7)").run(cid, q2.id).lastInsertRowid);
  Number(db.prepare("INSERT INTO purchases (contact_id, product_type, payment_method, payment_status, quote_id) VALUES (?, 'group_license', 'card', 'pending', ?)").run(cid, q2.id).lastInsertRowid);
  assert.equal(await purchaseIdForQuote(fakePool, q2.id), withInvoice);
  assert.ok(a && abandoned);
});

test('the old "newest purchase for this quote" pattern is gone from the routes', () => {
  const dir = path.join(SERVER, 'routes');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotMatch(src, /quote_id\s*=\s*\?\s*ORDER BY\s+(p\.)?id DESC/i, `${f} picks "the latest purchase for a quote"; use lib/quote-purchase.js`);
  }
});

test('a legacy quote with no contact link accepts by card and by PO (nothing here needs contact_id or opportunity_id)', async () => {
  const a = makeQuote(), b = makeQuote();
  assert.equal((await post('/api/quote/accept', { token: a.token, paymentMethod: 'card' })).status, 200);
  assert.equal((await post('/api/quote/accept', { token: b.token, paymentMethod: 'po', poNumber: 'PO-L' })).status, 200);
});

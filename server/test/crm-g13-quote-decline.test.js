// Sales CRM punch list G13 (PRD QUOTE-03): a customer can DECLINE a quote from the accept page; a declined quote cannot be accepted; staff are told once; the deal is untouched.
// Same harness as quote-billing-hardening.test.js (real routes and real SQL on node:sqlite, with the mail, the hooks and Stripe stubbed). Run:  cd server && npm test
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
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY, email TEXT, quote_sent_at TEXT DEFAULT '2026-01-01 00:00:00', first_name TEXT, last_name TEXT, school TEXT, quote_number TEXT, accept_token TEXT,
  quote_valid_until TEXT, accepted_at TEXT, accepted_payment_method TEXT, status TEXT, quoted_product_id INTEGER, quoted_product_name TEXT,
  quoted_seat_count INTEGER, quoted_amount_cents INTEGER, quoted_school_domain TEXT, quoted_term_years INTEGER,
  bill_to_street TEXT, bill_to_city TEXT, bill_to_state TEXT, bill_to_zip TEXT, ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT,
  content_profile_id INTEGER, opportunity_id INTEGER, revision_number INTEGER NOT NULL DEFAULT 1, version_status TEXT NOT NULL DEFAULT 'current',
  acceptance_name TEXT, acceptance_title TEXT, acceptance_terms_version TEXT, acceptance_document_hash TEXT, acceptance_recorded_at TEXT, acceptance_recorded_by TEXT,
  declined_at TEXT, declined_by TEXT, decline_reason TEXT);
CREATE TABLE admin_users (id INTEGER PRIMARY KEY, email TEXT);
CREATE TABLE crm_opportunities (id INTEGER PRIMARY KEY, owner_admin_id INTEGER, state TEXT DEFAULT 'open', stage_id INTEGER DEFAULT 1, name TEXT);
CREATE TABLE quote_content_profiles (id INTEGER PRIMARY KEY, section_annual_includes TEXT, section_lesson_package TEXT, section_video_access TEXT, section_license_terms TEXT);
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

const realRateLimit = require(path.join(SERVER, 'lib/rate-limit.js'));
const limits = { on: false };
const alerts = [];
const hookCalls = [];
const automations = [];
const invoiceNumber = { failNext: false };
let sessionCounter = 0;
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: fakePool,
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  [path.join(SERVER, 'lib/mailer.js')]: new Proxy({ sendSalesAlertEmail: async (a) => { alerts.push(a); }, sendAutomationEmail: async () => {} }, { get: (t, k) => (k in t ? t[k] : async () => {}) }),
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async (name, a) => { automations.push({ name, ...a }); } },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { attributePurchase: async () => {}, refCodeFromRequest: () => null, codeForAffiliateId: async () => null },
  // The real limiter, switched on only by the S6 test (every other test sends many requests from one address).
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: (o) => { const real = realRateLimit.limiter(o); return (req, res, next) => (limits.on ? real(req, res, next) : next()); }, clientIp: () => '127.0.0.1' },
  [path.join(SERVER, 'lib/crm-hooks.js')]: { contactChanged: async () => {}, purchaseChanged: async () => {}, invoiceChanged: async () => {}, contactChangedByEmail: async () => {}, quoteEvent: async (...a) => { hookCalls.push(['event', ...a]); }, quoteAccepted: async (...a) => { hookCalls.push(['accepted', ...a]); } },
  [path.join(SERVER, 'lib/own-seat-claim.js')]: { claimForAccountByEmail: async () => {}, claimOwnPurchaseSeats: async () => {}, findClaimableSeats: async () => [] },
  [path.join(SERVER, 'lib/invoice-numbering.js')]: {
    generateInvoiceNumber: async (c, id) => {
      if (invoiceNumber.failNext) { invoiceNumber.failNext = false; throw new Error('numbering failed'); }
      await c.query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [`INV-${id}`, id]);
    },
  },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async (k) => (k === 'contact_email_sales_alerts' ? 'sales@example.test' : null) },
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
    // The accept page now always sends who is accepting (phase 4b); these older tests are about billing, so they send a name unless a test says otherwise.
    const data = JSON.stringify(body.token && !('signerName' in body) ? { signerName: 'Bea Buyer', ...body } : body);
    const req = http.request({ port, method: 'POST', path: p, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); });
    req.on('error', reject); req.write(data); req.end();
  });
}
function getJson(p) {
  return new Promise((resolve, reject) => {
    http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) })); }).on('error', reject);
  });
}
async function deliver(session, type = 'checkout.session.completed') {
  let out;
  const res = { json: (b) => { out = { status: 200, body: b }; return res; }, status(c) { this.code = c; return this; }, send(b) { out = { status: this.code, body: b }; return res; } };
  await webhookHandler({ headers: { 'stripe-signature': 'x' }, body: Buffer.from(JSON.stringify({ type, data: { object: session } })) }, res);
  return out;
}


const lib = require(path.join(SERVER, 'lib/quote-decline.js'));
let nextQ = 500;
function makeQuote(f = {}) {
  const id = nextQ++;
  db.prepare(`INSERT INTO quote_requests (id, email, first_name, last_name, school, quote_number, accept_token, quoted_product_name, quoted_seat_count, quoted_amount_cents, quoted_term_years, status, opportunity_id, quote_valid_until, version_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'contacted', ?, ?, ?)`).run(id, `buyer${id}@school.example.com`, 'Bea', 'Buyer', 'Albion CSD', `Q-${id}`, `tok-${id}`, 'Department Plan', 5, 50000, 1, f.deal || null, f.validUntil || null, f.version || 'current');
  return { id, token: `tok-${id}` };
}
const q = (id) => db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id);
const cnt = (table, where = '1=1', ...p) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...p).n;
const snapshot = () => JSON.stringify(['purchases', 'invoices', 'license_seats', 'crm_opportunities'].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
db.prepare("INSERT INTO admin_users (id, email) VALUES (7, 'owner@fne.test')").run();
const dealId = Number(db.prepare("INSERT INTO crm_opportunities (id, owner_admin_id, state, name) VALUES (50, 7, 'open', 'Albion deal')").run().lastInsertRowid);
const ev = (type) => hookCalls.filter(c => c[0] === 'event' && c[2] === type);
const reset = () => { alerts.length = 0; hookCalls.length = 0; };

test('CUSTOMER DECLINES: the quote is marked, one event and one audit row, the owner is emailed once, and the deal, price and purchases are untouched', async () => {
  reset();
  const m = makeQuote({ deal: dealId });
  const before = snapshot();
  const r = await post('/api/quote/decline', { token: m.token, reason: 'The timing is not right.' });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.already, false);
  const row = q(m.id);
  assert.ok(row.declined_at); assert.equal(row.declined_by, 'customer'); assert.equal(row.decline_reason, 'The timing is not right.');
  assert.equal(row.quoted_amount_cents, 50000, 'no price change'); assert.equal(row.accepted_at, null); assert.equal(row.version_status, 'current');
  assert.equal(snapshot(), before, 'the deal stays open and no purchase, invoice or seat is touched');
  assert.equal(ev('declined').length, 1); assert.match(ev('declined')[0][3].detail, /by the customer: The timing is not right/);
  const a = db.prepare("SELECT * FROM school_audit_log WHERE action = 'crm_quote_declined'").get();
  assert.ok(a); assert.equal(a.actor_type, 'public'); assert.equal(a.ip_address, null); assert.doesNotMatch(JSON.stringify(a), /timing/, 'the reason is not copied into the audit row');
  assert.equal(alerts.length, 1); assert.equal(alerts[0].to, 'owner@fne.test'); assert.equal(alerts[0].subject, 'A customer declined a quote');
  assert.equal(alerts[0].fields['Their reason'], 'The timing is not right.'); assert.match(alerts[0].linkUrl, /admin-crm-opportunity\.html\?id=50/);
  // A second click is fine and does nothing more.
  const again = await post('/api/quote/decline', { token: m.token });
  assert.equal(again.status, 200); assert.equal(again.json.already, true);
  assert.equal(ev('declined').length, 1); assert.equal(alerts.length, 1); assert.equal(cnt('school_audit_log', "action = 'crm_quote_declined'"), 1);
});

test('A QUOTE WITH NO DEAL goes to the sales alert address; the reason is optional', async () => {
  reset();
  const m = makeQuote();
  const r = await post('/api/quote/decline', { token: m.token });
  assert.equal(r.status, 200);
  assert.equal(alerts[0].to, 'sales@example.test'); assert.equal(q(m.id).decline_reason, null);
});

test('A DECLINED QUOTE CANNOT BE ACCEPTED: the page lookup, the card and the purchase-order routes all say declined, and nothing is created', async () => {
  reset();
  const m = makeQuote();
  await post('/api/quote/decline', { token: m.token });
  const g = await getJson(`/api/quote/accept?token=${m.token}`);
  assert.equal(g.status, 400); assert.equal(g.json.error, 'declined');
  for (const body of [{ token: m.token, paymentMethod: 'po', poNumber: 'PO-1' }, { token: m.token, paymentMethod: 'card' }]) {
    const r = await post('/api/quote/accept', body);
    assert.equal(r.status, 400); assert.equal(r.json.error, 'declined');
  }
  assert.equal(cnt('purchases', 'quote_id = ?', m.id), 0); assert.equal(q(m.id).accepted_at, null);
  // Even a caller that skips the status check (a staff accept-for-customer) cannot claim it: the UPDATE itself requires declined_at IS NULL.
  await assert.rejects(quoteAccept.acceptQuoteViaPO(m.id, 'PO-2', undefined, { signer: { name: 'Staff', title: '' }, recordedBy: 'staff' }), /declined/);
  assert.equal(q(m.id).accepted_at, null);
  // A race: declined between the read and the claim is refused by the claim itself.
  const m2 = makeQuote();
  db.prepare("UPDATE quote_requests SET declined_at = '2026-11-16 10:00:00', declined_by = 'staff' WHERE id = ?").run(m2.id);
  await assert.rejects(quoteAccept.acceptQuoteViaPO(m2.id, 'PO-3', undefined, {}), /declined/);
});

test('STAFF UNDO: put back a decline and the link accepts again; the library refuses what it should; a decline after acceptance or replacement is refused', async () => {
  reset();
  const m = makeQuote();
  await lib.declineQuote(fakePool, m.id, { by: 'staff', reason: 'Called to say no', adminId: 3, now: '2026-11-16 10:00:00' });
  assert.equal(q(m.id).declined_by, 'staff');
  assert.equal(ev('declined')[0][3].actorAdminId, 3); assert.match(ev('declined')[0][3].detail, /recorded by staff/);
  assert.equal((await getJson(`/api/quote/accept?token=${m.token}`)).json.error, 'declined');
  await lib.undoDecline(fakePool, m.id, { adminId: 3, reason: 'They changed their mind', now: '2026-11-16 11:00:00' });
  const row = q(m.id); assert.equal(row.declined_at, null); assert.equal(row.declined_by, null); assert.equal(row.decline_reason, null);
  assert.equal(ev('decline_undone').length, 1);
  assert.equal((await getJson(`/api/quote/accept?token=${m.token}`)).status, 200, 'it accepts again');
  await assert.rejects(lib.undoDecline(fakePool, m.id, { adminId: 3, now: 'x' }), (e) => e.code === 'not_declined');
  const acc = makeQuote(); db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-01 10:00:00' WHERE id = ?").run(acc.id);
  await assert.rejects(lib.declineQuote(fakePool, acc.id, { by: 'customer', now: 'x' }), (e) => e.code === 'already_accepted');
  const sup = makeQuote({ version: 'superseded' });
  await assert.rejects(lib.declineQuote(fakePool, sup.id, { by: 'customer', now: 'x' }), (e) => e.code === 'superseded');
  await assert.rejects(lib.declineQuote(fakePool, 999999, { by: 'customer', now: 'x' }), (e) => e.code === 'not_found');
});

test('THE PUBLIC ROUTE CHECKS ITS INPUT: no token, a token that is not text, a reason that is not text or too long, an unknown, replaced or accepted quote', async () => {
  reset();
  const m = makeQuote();
  assert.equal((await post('/api/quote/decline', {})).status, 400);
  assert.equal((await post('/api/quote/decline', { token: ['a'] })).status, 400);
  assert.equal((await post('/api/quote/decline', { token: {} })).status, 400);
  assert.equal((await post('/api/quote/decline', { token: m.token, reason: { x: 1 } })).status, 400);
  assert.equal((await post('/api/quote/decline', { token: m.token, reason: 'x'.repeat(501) })).status, 400);
  assert.equal((await post('/api/quote/decline', { token: 'no-such-token' })).json.error, 'not_found');
  const sup = makeQuote({ version: 'superseded' });
  assert.equal((await post('/api/quote/decline', { token: sup.token })).json.error, 'superseded');
  const acc = makeQuote(); db.prepare("UPDATE quote_requests SET accepted_at = '2026-11-01 10:00:00' WHERE id = ?").run(acc.id);
  assert.equal((await post('/api/quote/decline', { token: acc.token })).json.error, 'already_accepted');
  assert.equal(q(m.id).declined_at, null, 'nothing refused was saved'); assert.equal(alerts.length, 0);
  const long = makeQuote();
  assert.equal((await post('/api/quote/decline', { token: long.token, reason: ' '.concat('y'.repeat(500)) })).status, 200, 'a reason of exactly 500 characters plus a space is trimmed and accepted');
  assert.equal(q(long.id).decline_reason.length, 500);
});

test('THE EMAIL FAILING NEVER UNDOES A DECLINE', async () => {
  reset();
  const m = makeQuote();
  const was = stubs[path.join(SERVER, 'lib/mailer.js')];
  const mailer = require(path.join(SERVER, 'lib/mailer.js'));
  const orig = mailer.sendSalesAlertEmail;
  mailer.sendSalesAlertEmail = async () => { throw new Error('smtp down'); };
  try { assert.equal((await post('/api/quote/decline', { token: m.token, reason: 'no' })).status, 200); } finally { mailer.sendSalesAlertEmail = orig; }
  assert.ok(q(m.id).declined_at); assert.ok(was);
});

test('THE PAGE: a Decline link that opens a small form, a Declined state, and every outside value stays escaped; the staff routes and rules are in place', () => {
  const read = (f) => fs.readFileSync(path.join(SERVER, f), 'utf8');
  const page = read('../accept-quote.html');
  assert.match(page, /id="stateDeclined"/); assert.match(page, /\/api\/quotes\/decline/); assert.match(page, /Decline this quote/); assert.match(page, /data\.error === 'declined'/);
  assert.doesNotMatch(page, /innerHTML\s*=\s*[^;]*declineReason/);
  const contact = read('routes/contact.js');
  assert.match(contact, /router\.post\('\/quotes\/:id\/decline', requireAuth, requireCrmRole\('write'\)/); assert.match(contact, /router\.post\('\/quotes\/:id\/undo-decline', requireAuth, requireCrmRole\('write'\)/);
  assert.match(contact, /'send_failed'/); assert.doesNotMatch(contact.slice(contact.indexOf("'send_failed'") - 200, contact.indexOf("'send_failed'") + 200), /err\.message/, 'the SMTP message (which can hold an address) is never stored');
  const events = read('lib/crm-quote-events.js'); for (const t of ['declined', 'decline_undone', 'send_failed', 'expired']) assert.match(events, new RegExp(`'${t}'`));
  assert.match(read('scripts/alter-add-quote-decline.js'), /declined_at/); assert.match(read('db/schema.sql'), /declined_at DATETIME NULL/);
  const deal = read('../admin-crm-opportunity.html'); assert.match(deal, /Record a decline/); assert.match(deal, /esc\(q\.declined\.reason\)/); assert.match(deal, /\/undo-decline/);
  for (const f of ['lib/quote-decline.js', 'routes/quote-accept.js', 'routes/contact.js', 'scripts/alter-add-quote-decline.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(SERVER, f)]);
});

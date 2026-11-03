// quote-seats.js (the quote builder's rules, shared by admin-quotes.html) and what happens to a 15 + 2 seat quote when it is
// accepted. Rules: docs/reference/quote-added-seats-requirements.md
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { totalSeats, isAddonTabQuote, annualPrice } = require('../../quote-seats.js');

test('added seats raise the seat total and nothing else', () => {
  assert.equal(totalSeats(15, 2), 17);
  assert.equal(totalSeats(15, 0), 15);
  assert.equal(totalSeats(15, ''), 15);
  assert.equal(totalSeats('15', '2'), 17);
  assert.equal(totalSeats(15, -3), 15);
});

test('the price is the same with or without added seats: catalog price, a typed amount, a term and a discount', () => {
  const plain = annualPrice({ catalogPrice: 979, typedAmount: '', termYears: 1, discountPct: 0 });
  assert.equal(plain.total, 979);
  assert.equal(plain.isCustom, false);
  const typed = annualPrice({ catalogPrice: 0, typedAmount: '979.00', termYears: 1, discountPct: 0 });
  assert.equal(typed.total, 979);
  assert.equal(typed.isCustom, true);
  const threeYears = annualPrice({ catalogPrice: 0, typedAmount: '1000', termYears: 3, discountPct: 8 });
  assert.equal(threeYears.subtotal, 3000);
  assert.equal(Math.round(threeYears.total * 100) / 100, 2760);
  assert.equal(annualPrice({ catalogPrice: 500, typedAmount: '0', termYears: 1, discountPct: 0 }).total, 0, 'a typed $0 stays $0');
});

test('an Add-On Seats tab quote is recognised from its saved numbers; an Annual quote is not', () => {
  assert.equal(isAddonTabQuote(5, 5), true);
  assert.equal(isAddonTabQuote(17, 2), false);
  assert.equal(isAddonTabQuote(15, 2), false, 'an older Annual quote, saved with the tier seats only');
  assert.equal(isAddonTabQuote(15, 0), false);
  assert.equal(isAddonTabQuote(15, null), false);
});

// ---- A saved 15 + 2 quote becomes a 17-seat license at the quoted price (the real acceptQuoteViaPO, real SQL for the quote) ----
const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY, email TEXT, first_name TEXT, last_name TEXT, school TEXT, quote_number TEXT,
  quote_valid_until TEXT, accepted_at TEXT, accepted_payment_method TEXT, status TEXT, quoted_product_id INTEGER, quoted_product_name TEXT,
  quoted_seat_count INTEGER, quoted_addon_seats INTEGER, quoted_amount_cents INTEGER, quoted_school_domain TEXT, quoted_term_years INTEGER);
`);
const purchases = [];
const fakePool = {
  query: async (sql, params = []) => {
    const s2 = sql.trim().replace(/NOW\(\)/g, 'CURRENT_TIMESTAMP');
    if (/FROM quote_requests/i.test(s2) || /^UPDATE quote_requests/i.test(s2)) {
      if (/^SELECT/i.test(s2)) return [db.prepare(s2).all(...params)];
      const r = db.prepare(s2).run(...params);
      return [{ affectedRows: Number(r.changes) }];
    }
    if (/^SELECT/i.test(s2)) return [[]];
    return [{ insertId: 1, affectedRows: 1 }];
  },
  async getConnection() {
    return { query: async () => [{ insertId: 1 }], beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  },
};
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: fakePool,
  [path.join(SERVER, 'routes/newsletter.js')]: { createPurchase: async (contactId, args) => { purchases.push(args); return 55; } },
  [path.join(SERVER, 'lib/automations.js')]: { fireAutomation: async () => {} },
  [path.join(SERVER, 'routes/checkout.js')]: { createSetPasswordUrl: async () => '' },
  [path.join(SERVER, 'lib/mailer.js')]: { sendAutomationEmail: async () => {}, sendSalesAlertEmail: async () => {} },
  [path.join(SERVER, 'lib/invoice-numbering.js')]: { generateInvoiceNumber: async () => {} },
  [path.join(SERVER, 'lib/settings.js')]: { getSetting: async () => null },
  [path.join(SERVER, 'lib/affiliate-attribution.js')]: { refCodeFromRequest: () => null },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};
const { acceptQuoteViaPO } = require(path.join(SERVER, 'routes/quote-accept.js'));

test('accepting a quote saved as 15 seats + 2 added seats creates a 17-seat license at the quoted price', async () => {
  const tierSeats = 15, added = 2;
  const cents = Math.round(annualPrice({ catalogPrice: 0, typedAmount: '979.00', termYears: 1, discountPct: 0 }).total * 100);
  // What the quote page now saves: quotedSeatCount = totalSeats(tier, added), quotedAddonSeats = added, amount unchanged by the added seats.
  db.prepare(`INSERT INTO quote_requests (id, email, first_name, last_name, school, quoted_product_id, quoted_product_name,
    quoted_seat_count, quoted_addon_seats, quoted_amount_cents, quoted_term_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(1, 'buyer@school.edu', 'Bea', 'Buyer', 'Albion CSD', 9, 'Department / Grade Plan', totalSeats(tierSeats, added), added, cents, 1);

  await acceptQuoteViaPO(1, 'PO-123', undefined);

  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].seatCount, 17, 'the license has the tier seats plus the added seats');
  assert.equal(purchases[0].amountCents, 97900, 'the added seats cost nothing');
  assert.equal(purchases[0].productType, 'group_license');
});

test('a quote saved the old way (tier seats only) still creates the seats it records, nothing more', async () => {
  db.prepare(`INSERT INTO quote_requests (id, email, first_name, last_name, school, quoted_product_id, quoted_product_name,
    quoted_seat_count, quoted_addon_seats, quoted_amount_cents, quoted_term_years) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(2, 'old@school.edu', 'Old', 'Quote', 'Old CSD', 9, 'Department / Grade Plan', 15, 2, 107900, 1);
  await acceptQuoteViaPO(2, 'PO-9', undefined);
  assert.equal(purchases[1].seatCount, 15, 'unchanged: accepted quotes are not rewritten by this release');
  assert.equal(purchases[1].amountCents, 107900);
});

// ---- The quote email: tier seats on the first row, added seats on their own row, no price on them ----
const sent = [];
Module._load = function (request, parent) {
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); } }) };
  return origLoad.apply(this, arguments);
};
process.env.SMTP_HOST = 'stub'; process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test';
const { sendQuoteEmail } = require(path.join(SERVER, 'lib/mailer.js'));
const base = { to: 'b@school.edu', firstName: 'Bea', lastName: 'Buyer', school: 'Albion', quoteNumber: '1', productName: 'Department / Grade Plan',
  amountDollars: 979, termYears: 1, discountPct: 0, quoteValidUntil: '2026-12-01', acceptUrl: 'https://example.com/a' };

test('email for an Annual quote of 15 + 2 shows 15 seats, then "+ 2 added seats: no extra charge"', async () => {
  sent.length = 0;
  await sendQuoteEmail({ ...base, seatCount: 17, addonSeats: 2 });
  assert.match(sent[0].html, /Department \/ Grade Plan \(15 seats\)/);
  assert.match(sent[0].html, /\+ 2 added seats/);
  assert.match(sent[0].html, /no extra charge/);
  assert.match(sent[0].text, /\(15 seats\)/);
  assert.match(sent[0].text, /\+ 2 added seats: no extra charge/);
  assert.doesNotMatch(sent[0].html, /\(17 seats\)/);
});

test('email for a quote with no added seats is unchanged, and an Add-On Seats quote keeps "included"', async () => {
  sent.length = 0;
  await sendQuoteEmail({ ...base, seatCount: 15, addonSeats: 0 });
  assert.match(sent[0].html, /\(15 seats\)/);
  assert.doesNotMatch(sent[0].html, /added seat/);
  sent.length = 0;
  await sendQuoteEmail({ ...base, productName: '5 Add-On Seats (Department)', seatCount: 5, addonSeats: 5 });
  assert.match(sent[0].html, /\(5 seats\)/);
  assert.match(sent[0].html, /\+ 5 added seats/);
  assert.doesNotMatch(sent[0].html, /no extra charge/);
});

test('report script: an old Annual quote of 15 + 2 with a 15-seat license is short by 2; a 17-seat license is fine', () => {
  const { judge } = require('../scripts/report-quote-added-seats.js');
  assert.deepEqual(judge({ quoted_seat_count: 15, quoted_addon_seats: 2, purchase_seats: 15 }), { shouldHave: 17, has: 15, short: 2 });
  assert.deepEqual(judge({ quoted_seat_count: 15, quoted_addon_seats: 2, purchase_seats: 17 }), { shouldHave: 17, has: 17, short: 0 });
  assert.equal(judge({ quoted_seat_count: 15, quoted_addon_seats: 2, purchase_seats: null }).short, null);
});

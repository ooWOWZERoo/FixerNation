// lib/invoice-parties.js (rules for Bill To / Ship To) and how the invoice and quote emails show them.
// Rules: docs/reference/invoice-bill-ship-to-requirements.md
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const P = require('../lib/invoice-parties');

const contact = { name: 'Dana Rowe', company: 'Oak Hill HS', email: 'dana@oak.edu', street: '1 Main St', city: 'Albion', state: 'NY', zip: '14411',
  ship_to_name: 'Receiving', ship_to_company: 'Oak Hill HS', ship_to_street: '9 Dock Rd', ship_to_city: 'Albion', ship_to_state: 'NY', ship_to_zip: '14411' };

test('cleanParty trims, ignores unknown keys, and refuses non-text, too-long and bad-email values', () => {
  assert.deepEqual(P.cleanParty({ name: '  A  ', street: ' 5 Elm ', evil: 'x' }, 'ship'), { name: 'A', company: '', street: '5 Elm', city: '', state: '', zip: '' });
  assert.throws(() => P.cleanParty({ name: 5 }, 'bill'), (e) => e.status === 400);
  assert.throws(() => P.cleanParty({ street: 'x'.repeat(256) }, 'bill'), (e) => e.status === 400 && /street/.test(e.message));
  assert.throws(() => P.cleanParty({ email: 'not-an-email' }, 'bill'), (e) => e.status === 400);
  assert.equal(P.cleanParty({ email: 'a@b.co' }, 'bill').email, 'a@b.co');
  assert.equal('email' in P.cleanParty({ email: 'a@b.co' }, 'ship'), false, 'Ship To has no email');
  assert.deepEqual(P.cleanParty(null, 'ship'), { name: '', company: '', street: '', city: '', state: '', zip: '' });
});

test('an older invoice (no saved Bill To) reads the contact; a saved one reads its own columns', () => {
  const older = { bill_to_saved_at: null, bill_to_name: 'Ignored' };
  assert.equal(P.invoiceBillTo(older, contact).company, 'Oak Hill HS');
  assert.equal(P.invoiceBillTo(older, contact).street, '1 Main St');
  const own = { bill_to_saved_at: '2026-11-03', bill_to_name: 'Accounts Payable', bill_to_company: 'Albion CSD', bill_to_email: 'ap@csd.org', bill_to_street: '2 Elm', bill_to_city: 'Albion', bill_to_state: 'NY', bill_to_zip: '14411' };
  assert.deepEqual(P.invoiceBillTo(own, contact), { name: 'Accounts Payable', company: 'Albion CSD', email: 'ap@csd.org', street: '2 Elm', city: 'Albion', state: 'NY', zip: '14411' });
  assert.equal(P.invoiceShipTo(own).street, '', 'no Ship To saved');
});

test('a new cart invoice copies Bill To and Ship To from the contact', () => {
  assert.equal(P.billFromContact(contact).company, 'Oak Hill HS');
  assert.equal(P.shipFromContact(contact).street, '9 Dock Rd');
  assert.equal(P.billFromContact(null).company, '');
});

test('a quote invoice: Bill To from the quote (blank address falls back to the contact), Ship To from the quote else the contact', () => {
  const quote = { first_name: 'Bea', last_name: 'Buyer', school: 'Albion CSD', email: 'bea@csd.org' };
  const bill = P.billFromQuote(quote, contact);
  assert.deepEqual([bill.name, bill.company, bill.email, bill.street], ['Bea Buyer', 'Albion CSD', 'bea@csd.org', '1 Main St']);
  assert.equal(P.shipFromQuote(quote, contact).street, '9 Dock Rd', 'quote has no Ship To, so the contact\'s is used');
  const withOwn = { ...quote, bill_to_street: '77 Pine', bill_to_city: 'Medina', bill_to_state: 'NY', bill_to_zip: '14103', ship_to_street: '5 Depot', ship_to_city: 'Medina' };
  assert.equal(P.billFromQuote(withOwn, contact).street, '77 Pine');
  assert.equal(P.billFromQuote(withOwn, contact).city, 'Medina', 'the whole address comes from the quote once it has one');
  assert.equal(P.shipFromQuote(withOwn, contact).street, '5 Depot');
  assert.equal(P.shipFromQuote(withOwn, null).city, 'Medina');
  assert.equal(P.shipFromQuote(quote, null).street, '', 'nothing anywhere: empty');
});

test('invoiceColumns lists every Bill To column plus the saved time, and every Ship To column; blank text becomes null', () => {
  const when = new Date('2026-11-03T12:00:00Z');
  const cols = P.invoiceColumns({ billTo: { name: 'A', company: '', email: '', street: '', city: '', state: '', zip: '' }, shipTo: { name: '', company: '', street: '5 Elm', city: '', state: '', zip: '' } }, when);
  const byCol = Object.fromEntries(cols.map((c) => [c.col, c.val]));
  assert.equal(byCol.bill_to_name, 'A');
  assert.equal(byCol.bill_to_company, null);
  assert.equal(byCol.bill_to_saved_at, when);
  assert.equal(byCol.ship_to_street, '5 Elm');
  assert.equal(cols.length, 7 + 1 + 6);
  assert.equal(P.invoiceColumns({ shipTo: { street: 'x' } }).some((c) => c.col === 'bill_to_saved_at'), false, 'editing only Ship To does not save Bill To');
});

// ---- the emails ----
const sent = [];
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'nodemailer') return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); } }) };
  return origLoad.apply(this, arguments);
};
process.env.SMTP_HOST = 'stub'; process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test';
const { sendInvoiceEmail, sendQuoteEmail, addressLines } = require(path.join(__dirname, '..', 'lib/mailer.js'));
const items = [{ description: 'Group License', seatCount: 15, amount: 979 }];
const bill = { name: 'Dana Rowe', company: 'Oak Hill HS', email: 'dana@oak.edu', street: '1 Main St', city: 'Albion', state: 'NY', zip: '14411' };
const ship = { name: 'Receiving', company: '', street: '9 Dock Rd', city: 'Albion', state: 'NY', zip: '14411' };

test('addressLines drops empty parts and joins city, state and zip', () => {
  assert.deepEqual(addressLines(bill), ['Dana Rowe', 'Oak Hill HS', '1 Main St', 'Albion, NY 14411', 'dana@oak.edu']);
  assert.deepEqual(addressLines(ship), ['Receiving', '9 Dock Rd', 'Albion, NY 14411']);
  assert.deepEqual(addressLines({ name: '', city: 'Albion' }), ['Albion']);
  assert.deepEqual(addressLines(null), []);
});

test('invoice email: Bill To always, Ship To only when it is filled in, and the values are escaped', async () => {
  sent.length = 0;
  await sendInvoiceEmail({ to: 'x@y.org', buyerName: 'Dana', invoiceNumber: 'INV-1', poNumber: 'PO9', total: 979, status: 'unpaid', lineItems: items, billTo: { ...bill, company: 'A & <B>' }, shipTo: ship });
  assert.match(sent[0].html, />Bill To</);
  assert.match(sent[0].html, />Ship To</);
  assert.match(sent[0].html, /A &amp; &lt;B&gt;/);
  assert.match(sent[0].html, /9 Dock Rd/);
  assert.match(sent[0].text, /Ship To:\n  Receiving\n  9 Dock Rd\n  Albion, NY 14411/);
  sent.length = 0;
  await sendInvoiceEmail({ to: 'x@y.org', buyerName: 'Dana', invoiceNumber: 'INV-2', total: 979, status: 'paid', lineItems: items, billTo: bill, shipTo: { name: '', company: '', street: '', city: '', state: '', zip: '' } });
  assert.match(sent[0].html, />Bill To</);
  assert.doesNotMatch(sent[0].html, /Ship To/);
  assert.doesNotMatch(sent[0].text, /Ship To/);
  sent.length = 0;
  await sendInvoiceEmail({ to: 'x@y.org', buyerName: 'Dana', invoiceNumber: 'INV-3', total: 5, status: 'paid', lineItems: items });
  assert.doesNotMatch(sent[0].html, /Bill To|Ship To/, 'an invoice with no addresses looks as it did before');
});

test('quote email carries Bill To and Ship To when it has them', async () => {
  sent.length = 0;
  await sendQuoteEmail({ to: 'b@s.edu', firstName: 'Bea', lastName: 'Buyer', school: 'Albion', quoteNumber: '1', productName: 'Plan', seatCount: 15, amountDollars: 979,
    addonSeats: 0, termYears: 1, discountPct: 0, quoteValidUntil: '2026-12-01', acceptUrl: 'https://example.com/a', billTo: bill, shipTo: ship });
  assert.match(sent[0].html, />Bill To</);
  assert.match(sent[0].html, />Ship To</);
  assert.match(sent[0].text, /Bill To:/);
  sent.length = 0;
  await sendQuoteEmail({ to: 'b@s.edu', firstName: 'Bea', lastName: 'Buyer', school: 'Albion', quoteNumber: '1', productName: 'Plan', seatCount: 15, amountDollars: 979,
    addonSeats: 0, termYears: 1, discountPct: 0, quoteValidUntil: '2026-12-01', acceptUrl: 'https://example.com/a' });
  assert.doesNotMatch(sent[0].html, /Bill To|Ship To/);
});

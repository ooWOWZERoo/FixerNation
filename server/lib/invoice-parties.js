// Bill To and Ship To on invoices, quotes and the CRM contact (Release 97).
// Rules: docs/reference/invoice-bill-ship-to-requirements.md
//   - An invoice keeps its own Bill To and Ship To. Editing them changes that invoice only, never the contact.
//   - bill_to_saved_at NULL means "an older invoice: read Bill To from the CRM contact, as before".
//   - A new invoice saves Bill To at creation (from its quote if it has one, else from the contact) and Ship To the same way.
// Plain functions, no database access, so they run the same in the tests.
const LIMITS = { name: 255, company: 255, email: 255, street: 255, city: 128, state: 64, zip: 32 };
const BILL_KEYS = ['name', 'company', 'email', 'street', 'city', 'state', 'zip'];
const SHIP_KEYS = ['name', 'company', 'street', 'city', 'state', 'zip'];

const text = (v) => (v == null ? '' : String(v).trim());

// Validates and trims an address block from a request. Unknown keys are ignored. Throws { status: 400 } for a non-text value or one
// that is too long. `kind` is 'bill' (has an email) or 'ship'.
function cleanParty(input, kind) {
  const keys = kind === 'bill' ? BILL_KEYS : SHIP_KEYS;
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of keys) {
    const v = src[k];
    if (v != null && typeof v !== 'string') throw Object.assign(new Error(`${k} must be text`), { status: 400 });
    out[k] = text(v);
    if (out[k].length > LIMITS[k]) throw Object.assign(new Error(`${k} is too long (most ${LIMITS[k]} characters)`), { status: 400 });
  }
  if (kind === 'bill' && out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) {
    throw Object.assign(new Error('Bill To email is not a valid email address'), { status: 400 });
  }
  return out;
}

const isEmptyParty = (p) => !p || Object.values(p).every((v) => !text(v));

// ---- reading a row ----
function pick(row, prefix, keys) {
  const out = {};
  for (const k of keys) out[k] = text(row && row[`${prefix}_${k}`]);
  return out;
}

function billFromContact(contact) {
  if (!contact) return { name: '', company: '', email: '', street: '', city: '', state: '', zip: '' };
  return {
    name: text(contact.name), company: text(contact.company), email: text(contact.email),
    street: text(contact.street), city: text(contact.city), state: text(contact.state), zip: text(contact.zip),
  };
}
const shipFromContact = (contact) => pick(contact, 'ship_to', SHIP_KEYS);

// An invoice's Bill To: its own saved copy, or (older invoices) the contact's details as before.
function invoiceBillTo(invoice, contact) {
  return invoice && invoice.bill_to_saved_at ? pick(invoice, 'bill_to', BILL_KEYS) : billFromContact(contact);
}
const invoiceShipTo = (invoice) => pick(invoice, 'ship_to', SHIP_KEYS);

// ---- what a new invoice starts with ----
// Bill To: the quote's contact details and Bill To address (blank address parts fall back to the CRM contact's address).
function billFromQuote(quote, contact) {
  const fromContact = billFromContact(contact);
  if (!quote) return fromContact;
  const name = [text(quote.first_name), text(quote.last_name)].filter(Boolean).join(' ') || fromContact.name;
  const hasOwnAddress = ['street', 'city', 'state', 'zip'].some((k) => text(quote[`bill_to_${k}`]));
  return {
    name,
    company: text(quote.school) || fromContact.company,
    email: text(quote.email) || fromContact.email,
    street: hasOwnAddress ? text(quote.bill_to_street) : fromContact.street,
    city: hasOwnAddress ? text(quote.bill_to_city) : fromContact.city,
    state: hasOwnAddress ? text(quote.bill_to_state) : fromContact.state,
    zip: hasOwnAddress ? text(quote.bill_to_zip) : fromContact.zip,
  };
}
// Ship To: the quote's Ship To if it has one, else the contact's, else empty.
function shipFromQuote(quote, contact) {
  const q = pick(quote, 'ship_to', SHIP_KEYS);
  return isEmptyParty(q) ? shipFromContact(contact) : q;
}

// ---- writing: column names and values for an INSERT or UPDATE ----
function columns(prefix, party, keys) {
  return keys.map((k) => ({ col: `${prefix}_${k}`, val: text(party && party[k]) || null }));
}
// [{ col, val }] for the invoice's bill_to_* (plus bill_to_saved_at) and ship_to_* columns.
function invoiceColumns({ billTo, shipTo }, savedAt = new Date()) {
  const out = [];
  if (billTo) out.push(...columns('bill_to', billTo, BILL_KEYS), { col: 'bill_to_saved_at', val: savedAt });
  if (shipTo) out.push(...columns('ship_to', shipTo, SHIP_KEYS));
  return out;
}

// Inserts an invoice with its Bill To and Ship To already saved (rule B3 and B4). `base` is the plain columns, for example
// { contact_id, po_number, total_cents, status, paid_at }. `quote` is the accepted quote row, or null for a cart order. `db` is a
// pool or a transaction's connection.
async function insertInvoice(db, base, quote) {
  const [[contact]] = await db.query('SELECT * FROM newsletter_contacts WHERE id = ?', [base.contact_id]);
  const billTo = quote ? billFromQuote(quote, contact) : billFromContact(contact);
  const shipTo = quote ? shipFromQuote(quote, contact) : shipFromContact(contact);
  const extra = invoiceColumns({ billTo, shipTo });
  const cols = [...Object.keys(base), ...extra.map((e) => e.col)];
  const vals = [...Object.values(base), ...extra.map((e) => e.val)];
  const [result] = await db.query(`INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
  return result;
}

module.exports = {
  insertInvoice, cleanParty, isEmptyParty, invoiceBillTo, invoiceShipTo, billFromContact, shipFromContact, billFromQuote, shipFromQuote, invoiceColumns,
  BILL_KEYS, SHIP_KEYS,
};

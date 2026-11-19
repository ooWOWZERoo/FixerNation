// One quote's licensed people become hand-set Customers (a one-off, asked for by the owner for quote #307785, a real production account).
//
// Why a hand-set label: the Hub derives a Customer from a PAID purchase placed by that person (lib/crm-classification.js). The teachers and school admins on a license did not buy it, so they
// show as Suspects even though their school paid. This does NOT change that rule. It uses the Hub's own CRM Admin override (setCustomerOverride: a reason AND evidence are required, the label is
// then locked against the nightly check, and the change is written to the history and the audit log), for the people on ONE paid purchase.
//
// Rules this file keeps (each has a test):
//  - Only a purchase that is PAID (the Customer rule itself: paid, more than $0, not a trial, not a confirmed full refund) or whose PO has been RECEIVED (the owner's instruction for this
//    one quote: same tests, with the invoice's PO received and not cancelled) is used. Which one applied is written into each person's evidence. Anything else marks nobody.
//    (The Hub's general rule is unchanged and still counts a purchase only once it is paid: receiving a PO activates the license but does not mark the purchase paid.)
//  - Who: teachers holding a registered seat on that purchase, and active school admins on it (school_license_admins), each matched to a contact by email. A person with no contact is
//    listed, never created. Pending invitations, revoked seats, closed sign-in accounts and test addresses (@example.com) are left out and counted.
//  - A dry run (the default) lists everyone and writes nothing. Applying needs a named CRM Admin; running it again changes nothing for anyone already a locked Customer.
//  - It reads and writes only the people it lists; it never touches the purchase, invoice, seats or licenses.
const cls = require('./crm-classification');
const { purchaseIdForQuote } = require('./quote-purchase');
const { audit } = require('./audit');

const isMissing = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)|has no column named/i.test(String(err.message)));
const norm = (s) => String(s || '').trim().toLowerCase();
const isTest = (email) => norm(email).endsWith('@example.com');

// Works out who would be marked. Reads only. Returns { error } or { quote, purchase, people: [{ role, contactId, name, label, locked, action }], skipped }.
async function planQuote(conn, quoteNumber) {
  const num = String(quoteNumber || '').trim();
  if (!/^\d{6}$/.test(num)) return { error: 'A quote number is six digits, for example 307785.' };
  const [[q]] = await conn.query('SELECT id, quote_number FROM quote_requests WHERE quote_number = ?', [num]);
  if (!q) return { error: `No quote has the number ${num}.` };
  const pid = await purchaseIdForQuote(conn, q.id);
  if (!pid) return { error: `Quote ${num} has no purchase yet, so nobody is licensed under it.` };
  const [[paid]] = await conn.query(`SELECT p.id ${cls.PURCHASES_FROM} WHERE p.id = ? AND ${cls.QUALIFYING_SQL}`, [pid]);
  let basis = paid ? 'paid' : null;
  if (!basis) {
    // PO received: the invoice's PO date is set and the invoice is not cancelled, and the purchase is more than $0, not a trial, not a confirmed full refund.
    const [[po]] = await conn.query(`SELECT p.id ${cls.PURCHASES_FROM} JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ? AND i.po_received_date IS NOT NULL AND i.status <> 'cancelled' AND p.amount_cents > 0 AND NOT ${cls.TRIAL_LIKE_SQL} AND ${cls.NOT_REFUNDED_SQL}`, [pid]);
    if (po) basis = 'PO received';
  }
  if (!basis) {
    const [[p]] = await conn.query('SELECT payment_status, amount_cents FROM purchases WHERE id = ?', [pid]);
    return { error: `Quote ${num}'s purchase is not paid and has no PO received (status "${p && p.payment_status}", amount ${p && p.amount_cents === null ? 'not recorded' : p && p.amount_cents}), or it is a trial or refunded. Nobody was marked.` };
  }
  const skipped = { pendingSeats: 0, revokedOrInactive: 0, closedAccounts: 0, testAddresses: 0, noContact: 0 };
  const found = new Map(); // site user id -> { role, email }
  const [seats] = await conn.query('SELECT status, registered_site_user_id FROM license_seats WHERE purchase_id = ?', [pid]);
  for (const s of seats) {
    if (!s.registered_site_user_id) { if (s.status === 'pending') skipped.pendingSeats++; continue; }
    if (s.status !== 'registered') { skipped.revokedOrInactive++; continue; }
    found.set(Number(s.registered_site_user_id), { role: 'teacher' });
  }
  let admins = [];
  try { [admins] = await conn.query('SELECT site_user_id, is_active FROM school_license_admins WHERE purchase_id = ?', [pid]); } catch (err) { if (!isMissing(err)) throw err; }
  for (const a of admins) {
    if (!Number(a.is_active)) { skipped.revokedOrInactive++; continue; }
    found.set(Number(a.site_user_id), { role: found.has(Number(a.site_user_id)) ? 'teacher and admin' : 'admin' });
  }
  const people = [];
  for (const [siteUserId, who] of found) {
    const [[u]] = await conn.query('SELECT id, email, closed_at FROM site_users WHERE id = ?', [siteUserId]);
    if (!u) continue;
    if (u.closed_at) { skipped.closedAccounts++; continue; }
    if (isTest(u.email)) { skipped.testAddresses++; continue; }
    const [[c]] = await conn.query('SELECT id, name, crm_classification, classification_locked FROM newsletter_contacts WHERE LOWER(TRIM(email)) = ? ORDER BY id LIMIT 1', [norm(u.email)]);
    if (!c) { skipped.noContact++; people.push({ role: who.role, siteUserId, contactId: null, name: null, label: null, locked: false, action: 'no_contact' }); continue; }
    const label = c.crm_classification || 'suspect', locked = Number(c.classification_locked) === 1;
    people.push({ role: who.role, siteUserId, contactId: Number(c.id), name: c.name || '', label, locked, action: label === 'customer' && locked ? 'already' : label === 'customer' ? 'lock' : 'mark' });
  }
  people.sort((a, b) => (a.role + (a.name || '')).localeCompare(b.role + (b.name || '')));
  return { quote: { id: Number(q.id), number: num }, purchaseId: Number(pid), basis, people, skipped };
}

// Marks everyone the plan says to. `adminId` must be a CRM Admin (checked by the caller). Returns { marked, locked, already, noContact, failed }.
async function applyPlan(conn, plan, { adminId }) {
  const out = { marked: 0, locked: 0, already: 0, noContact: 0, failed: 0 };
  for (const p of plan.people) {
    if (p.action === 'no_contact') { out.noContact++; continue; }
    if (p.action === 'already') { out.already++; continue; }
    const reason = `Licensed under quote #${plan.quote.number}`;
    const evidence = `Quote #${plan.quote.number}, purchase #${plan.purchaseId} ${plan.basis}; ${p.role === 'admin' ? 'school admin' : 'teacher'} on the license`.slice(0, 120);
    const r = await cls.setCustomerOverride(conn, p.contactId, { actorAdminId: adminId, reason, evidence });
    if (!r.ok) { out.failed++; continue; }
    // The same audit row the Hub's own button writes (routes/crm-contacts.js, customer-override).
    await audit(conn, { actorType: 'admin_user', actorId: adminId, action: 'crm_customer_override', entityType: 'crm_contact', entityId: p.contactId, prevValue: { classification: r.from }, newValue: { classification: 'customer', locked: true }, reason: `${reason}; evidence: ${evidence}` });
    if (p.action === 'lock') out.locked++; else out.marked++;
  }
  return out;
}

module.exports = { planQuote, applyPlan };

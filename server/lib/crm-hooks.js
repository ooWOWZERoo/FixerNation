// Sales CRM: keep a contact's Suspect / Prospect / Customer label current after something changes (docs/reference/sales-crm-update-requirements.md, phase 1).
//
// These run AFTER the existing code has finished and committed its own work. They never throw, never block, and never change a response: a payment, a
// quote or an invoice behaves exactly as before whether the CRM is on, off, half set up or broken. If a call is missed, the nightly reconcile
// (scripts/reconcile-crm-classification.js) catches it. They do nothing while the setting crm_v2_enabled is not 'true'.
const pool = require('../db/pool');
const { isCrmEnabled } = require('./crm-permissions');
const cls = require('./crm-classification');
const { recordQuoteEvent } = require('./crm-quote-events');
const { closeDealWon } = require('./crm-won');
const { audit } = require('./audit');

// A database that has not had the CRM alter script run yet is expected, not an error worth shouting about.
function quiet(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR'
    || /no such (table|column)|has no column named/i.test(String(err.message)));
}

async function safely(fn) {
  try {
    if (!(await isCrmEnabled())) return;
    await fn();
  } catch (err) {
    if (!quiet(err)) console.error('crm hook failed:', err.message);
  }
}

function contactChanged(contactId) {
  return safely(async () => { if (contactId) await cls.reconcileContact(pool, Number(contactId)); });
}

// `opts` = { actorAdminId, reason } when a person caused the change (punch list B11: a staff-made quote records who and why on the label's history).
function contactChangedByEmail(email, opts = {}) {
  return safely(async () => {
    if (typeof email !== 'string' || !email.trim()) return;
    const [[c]] = await pool.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [email]);
    if (c) await cls.reconcileContact(pool, c.id, { actorAdminId: opts.actorAdminId || null, reason: opts.reason || null });
  });
}

function purchaseChanged(purchaseId) {
  return safely(async () => {
    const [[p]] = await pool.query('SELECT contact_id FROM purchases WHERE id = ?', [purchaseId]);
    if (p) await cls.reconcileContact(pool, p.contact_id);
  });
}

// An invoice flipping paid or unpaid moves every purchase on it, so reconcile each owner once.
function invoiceChanged(invoiceId) {
  return safely(async () => {
    const [rows] = await pool.query('SELECT DISTINCT contact_id FROM purchases WHERE invoice_id = ?', [invoiceId]);
    for (const r of rows) await cls.reconcileContact(pool, r.contact_id);
  });
}

// Phase 4b: one line in a quote's event log (created, sent, superseded, viewed). `opts` = { detail, actorAdminId }.
function quoteEvent(quoteId, type, opts) {
  return safely(async () => { await recordQuoteEvent(pool, quoteId, type, opts); });
}

// Phase 4c: a quote was accepted (by the customer, or by staff for them). Writes the event and closes the quote's deal Won if it is still open, once. The deal
// changes only; no purchase, invoice or contact label is touched here. `how` is 'po' or 'card'; `by` is 'buyer' or 'staff'.
function quoteAccepted(quoteId, how, by = 'buyer') {
  return safely(async () => {
    await recordQuoteEvent(pool, quoteId, 'accepted', { detail: `${how}${by === 'staff' ? ' (for the customer)' : ''}` });
    const [[q]] = await pool.query('SELECT quote_number, opportunity_id FROM quote_requests WHERE id = ?', [quoteId]);
    if (q && q.opportunity_id) {
      await closeDealWon(pool, q.opportunity_id, { reason: `Quote ${q.quote_number || quoteId} accepted ${by === 'staff' ? 'by staff for the customer' : 'by the customer'} (${how})` });
      await noteAnotherAcceptedQuote(q.opportunity_id, quoteId);
    }
  });
}

// Punch list B7 (owner's choice: allow it, but flag it). A deal can hold more than one quote chain (a copy for another product), and a customer may really buy both. When a quote
// is accepted on a deal that already has another accepted quote, the second sale is written to the audit log, and the deal's value follows ONLY if it still equals what the
// earlier accepted quote(s) were worth (nobody typed their own figure), in which case it becomes the total. A value staff typed is never overwritten; the deal page shows a notice.
async function noteAnotherAcceptedQuote(dealId, quoteId) {
  const [others] = await pool.query('SELECT id, quoted_amount_cents FROM quote_requests WHERE opportunity_id = ? AND accepted_at IS NOT NULL AND id <> ?', [dealId, quoteId]);
  if (!others.length) return;
  const [[mine]] = await pool.query('SELECT quoted_amount_cents FROM quote_requests WHERE id = ?', [quoteId]);
  const prior = others.reduce((t, r) => t + Number(r.quoted_amount_cents || 0), 0);
  const add = Number((mine && mine.quoted_amount_cents) || 0);
  let valueFollowed = false;
  if (prior > 0 && add > 0) {
    const [r] = await pool.query('UPDATE crm_opportunities SET amount_cents = ? WHERE id = ? AND amount_cents = ?', [prior + add, dealId, prior]);
    valueFollowed = r.affectedRows > 0;
  }
  await audit(pool, {
    actorType: 'system', actorId: null, action: 'crm_opportunity_more_quotes_accepted', entityType: 'crm_opportunity', entityId: dealId,
    newValue: { acceptedQuotes: others.length + 1, quoteId: Number(quoteId), valueFollowed },
    reason: valueFollowed ? 'Another quote on this deal was accepted; the deal value now covers both.' : 'Another quote on this deal was accepted; the deal value was left for staff to check.',
  });
}

// Punch list B7: a quote's price changed (a revision was sent, or staff re-priced a sent quote). The deal's forecast value follows it, but ONLY when the deal's value is still
// exactly the old price, meaning nobody typed a figure of their own; a typed value is left alone. Open deals only. Never throws.
function quotePriceChanged(quoteId, oldCents, opts = {}) {
  return safely(async () => {
    if (oldCents === null || oldCents === undefined) return;
    const [[q]] = await pool.query('SELECT opportunity_id, quoted_amount_cents FROM quote_requests WHERE id = ?', [quoteId]);
    if (!q || !q.opportunity_id || q.quoted_amount_cents === null || q.quoted_amount_cents === undefined) return;
    if (Number(q.quoted_amount_cents) === Number(oldCents)) return;
    const [r] = await pool.query("UPDATE crm_opportunities SET amount_cents = ? WHERE id = ? AND state = 'open' AND amount_cents = ?", [q.quoted_amount_cents, q.opportunity_id, oldCents]);
    if (!r.affectedRows) return;
    await audit(pool, {
      actorType: opts.actorAdminId ? 'admin_user' : 'system', actorId: opts.actorAdminId || null, action: 'crm_opportunity_updated', entityType: 'crm_opportunity', entityId: q.opportunity_id,
      prevValue: { amount_cents: Number(oldCents) }, newValue: { amount_cents: Number(q.quoted_amount_cents) }, reason: 'The deal value followed the quote price (it had not been changed by hand).',
    });
  });
}

module.exports = { contactChanged, contactChangedByEmail, purchaseChanged, invoiceChanged, quoteEvent, quoteAccepted, quotePriceChanged };

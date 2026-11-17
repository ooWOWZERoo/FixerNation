// Sales CRM punch list G21 (PRD section 8 rule 7): refunds and disputes. Stripe never changed payment_status, so a refunded sale kept counting as money in the CRM.
//
// Rules this file keeps (each has a test):
//  - A refund or dispute is a FLAG (crm_purchase_refunds, state needs_review) raised by a Stripe event or by staff. Raising one changes nothing else: not the purchase, not its
//    license or access, not the contact's Customer label, no email to the buyer. The CRM never refunds anything and never writes the purchase.
//  - Only a CRM Admin decides. Confirming a FULL refund makes the purchase stop counting as a paid purchase in the CRM (NOT_REFUNDED_SQL in lib/crm-classification.js: Customer rule,
//    reports, Overview). A partial refund, or a dismissed flag, changes no count. The contact's label is never moved here: the existing "needs review" note appears when no paid purchase is left,
//    and a CRM Admin moves the label by hand.
//  - A retried Stripe event adds nothing (unique on event id and purchase). A refund for a payment that matches no purchase is not stored; the caller audits it and alerts staff.
//  - Amounts are cents. No card, name or address from Stripe is kept: the event id, the amount and the kind only.
// `conn` is the pool in the app and any query-capable handle in tests. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters).
const { audit } = require('./audit');

const STRIPE_EVENTS = ['charge.refunded', 'charge.dispute.created'];
const STATES = ['needs_review', 'confirmed', 'dismissed'];

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}

// What a Stripe charge.refunded or charge.dispute.created event says, reduced to what we keep. Returns null for any other event.
function readStripeEvent(event) {
  if (!event || !STRIPE_EVENTS.includes(event.type) || !event.data || !event.data.object) return null;
  const o = event.data.object;
  if (event.type === 'charge.refunded') {
    const refunded = Number.isFinite(Number(o.amount_refunded)) ? Number(o.amount_refunded) : null;
    const total = Number.isFinite(Number(o.amount)) ? Number(o.amount) : null;
    const full = o.refunded === true || (refunded !== null && total !== null && total > 0 && refunded >= total);
    return { kind: 'refund', amountCents: refunded, isFull: full ? 1 : 0, paymentIntent: o.payment_intent || null, invoice: o.invoice || null };
  }
  // A dispute: whether it ends as a full loss is unknown until staff decide.
  return { kind: 'dispute', amountCents: Number.isFinite(Number(o.amount)) ? Number(o.amount) : null, isFull: null, paymentIntent: o.payment_intent || null, invoice: null };
}

// The real lookup: Stripe's checkout session for the payment gives the session id stored on the purchase (a cart session can hold several purchases); an invoice charge matches stripe_invoice_id.
function stripeFinder(conn, stripe) {
  return async (info) => {
    const ids = new Set();
    if (info.paymentIntent && stripe) {
      const found = await stripe.checkout.sessions.list({ payment_intent: info.paymentIntent, limit: 1 });
      for (const s of (found && found.data) || []) {
        const [rows] = await conn.query('SELECT id FROM purchases WHERE stripe_session_id = ?', [s.id]);
        for (const r of rows) ids.add(Number(r.id));
      }
    }
    if (info.invoice) {
      const [rows] = await conn.query('SELECT id FROM purchases WHERE stripe_invoice_id = ?', [info.invoice]);
      for (const r of rows) ids.add(Number(r.id));
    }
    return [...ids];
  };
}

// Records one flag per matched purchase. Safe to run again for the same event. Returns { handled, available, matched, created, duplicate, purchaseIds }.
async function recordStripeEvent(conn, event, { findPurchaseIds, now }) {
  const info = readStripeEvent(event);
  if (!info) return { handled: false };
  const out = { handled: true, available: true, kind: info.kind, matched: 0, created: 0, duplicate: 0, purchaseIds: [] };
  let ids;
  try { ids = await findPurchaseIds(info); } catch (err) { if (isMissing(err)) return { ...out, available: false }; throw err; }
  out.matched = ids.length;
  for (const purchaseId of ids) {
    try {
      const [ins] = await conn.query(
        `INSERT INTO crm_purchase_refunds (purchase_id, kind, source, stripe_event_id, amount_cents, is_full, state, created_at) VALUES (?, ?, 'stripe', ?, ?, ?, 'needs_review', ?)`,
        [purchaseId, info.kind, String(event.id || '').slice(0, 255) || null, info.amountCents, info.isFull, now]);
      out.created++; out.purchaseIds.push(purchaseId);
      await audit(conn, {
        actorType: 'system', action: 'crm_refund_flagged', entityType: 'crm_refund', entityId: ins.insertId,
        newValue: { source: 'stripe', kind: info.kind, purchaseId, amountCents: info.amountCents, isFull: info.isFull },
        reason: 'Stripe reported a refund or dispute. Nothing was changed; a CRM Admin decides.',
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(String(err.message))) { out.duplicate++; continue; }
      if (isMissing(err)) return { ...out, available: false };
      throw err;
    }
  }
  return out;
}

module.exports = { readStripeEvent, stripeFinder, recordStripeEvent, STRIPE_EVENTS, STATES, isMissing };

// Sales CRM: Suspect / Prospect / Customer (docs/reference/sales-crm-update-requirements.md, decisions D2 and D3).
//
// This is the ONE place that decides what a Customer is. The classification is a lifecycle label on a contact. It is NOT the contact's email
// subscription (newsletter_contacts.status), NOT an opportunity stage, and NOT a score; nothing here reads or writes any of those.
//
//   Suspect   the default. A signup or an import is not proof of buying interest.
//   Prospect  a quote request exists for this person (or staff promoted them with a reason).
//   Customer  the person owns at least one QUALIFYING paid purchase (below), or staff set it with evidence.
//
// Rules that must not erode:
//  - Customer comes from purchases, never from an accepted quote, an issued invoice, a PO number or a verbal yes. Card quotes make no invoice at all.
//  - A trial of any kind never counts, whatever its payment_status says (the column defaults to 'paid'). A zero amount never counts. A NULL amount
//    (a manual entry) does not count until staff confirm it with an override: see listPurchasesNeedingReview.
//  - Classification only moves forward on its own (suspect -> prospect -> customer). It never silently goes back. If a Customer's qualifying purchase
//    stops qualifying (refund, unpaid), reconcile writes a 'needs_review' event and leaves the label alone.
//  - A staff override (classification_locked = 1) is never changed by reconcile.
//  - No hot / warm / cold value exists anywhere. A test fails if one appears in the CRM files.
//
// Every function takes a `conn` (the pool or a connection) so callers and tests choose the database. SQL is kept portable: no NOW(), no
// ON DUPLICATE KEY, no array parameters (the tests run it on node:sqlite).

const CLASSIFICATIONS = ['suspect', 'prospect', 'customer'];
const RANK = { suspect: 0, prospect: 1, customer: 2 };

// D3, in SQL. Aliases: p = purchases, lp = license_products (left joined).
const PURCHASES_FROM = 'FROM purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id';
// Punch list B15: p.is_trial_flag is the product's trial flag frozen when the CRM first looked at the purchase; the live product flag is only the fallback for a purchase not yet frozen.
const TRIAL_LIKE_SQL = '(COALESCE(p.is_trial_flag, lp.is_trial, 0) = 1 OR p.trial_lesson_limit IS NOT NULL OR p.trial_expiration_date IS NOT NULL)';
// Punch list G21: a refund a CRM Admin CONFIRMED as a full refund means the money is gone: the purchase stops counting as a paid purchase here (never changes the purchase itself or its license).
const NOT_REFUNDED_SQL = "NOT EXISTS (SELECT 1 FROM crm_purchase_refunds rf WHERE rf.purchase_id = p.id AND rf.state = 'confirmed' AND rf.is_full = 1)";
const QUALIFYING_SQL = `p.payment_status = 'paid' AND p.amount_cents > 0 AND NOT ${TRIAL_LIKE_SQL} AND ${NOT_REFUNDED_SQL}`;
// Paid, not a trial, but the amount is unknown or zero: never a Customer on its own; shown for review.
const NEEDS_REVIEW_SQL = `p.payment_status = 'paid' AND (p.amount_cents IS NULL OR p.amount_cents = 0) AND NOT ${TRIAL_LIKE_SQL} AND ${NOT_REFUNDED_SQL}`;

// D3, in JS (the same rule, for code that already holds the rows). A test runs both against the same fixtures.
function isTrialLike(p) {
  const flag = p.is_trial_flag !== null && p.is_trial_flag !== undefined ? p.is_trial_flag : p.is_trial;
  return Number(flag || 0) === 1 || (p.trial_lesson_limit !== null && p.trial_lesson_limit !== undefined)
    || (p.trial_expiration_date !== null && p.trial_expiration_date !== undefined);
}
function isQualifyingPurchase(p) {
  return p.payment_status === 'paid' && Number(p.amount_cents) > 0 && !isTrialLike(p);
}

// QA and demo contacts use example.com. The backfill and the overview counts leave them out (one helper, no extra column).
function isTestAddress(email) {
  return /@example\.com$/i.test(String(email || '').trim());
}
const TEST_ADDRESS_SQL = "LOWER(TRIM(email)) LIKE '%@example.com'";

function sqlNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// What should this contact be, given the facts? Returns null when nothing should change.
function derive({ current, locked, hasQualifyingPurchase, hasQuote }) {
  if (locked) return null;
  if (hasQualifyingPurchase && current !== 'customer') return { to: 'customer', eventType: 'purchase_verified' };
  if (!hasQualifyingPurchase && current === 'suspect' && hasQuote) return { to: 'prospect', eventType: 'quote_request' };
  return null;
}

async function writeEvent(conn, { contactId, from, to, eventType, sourceRef, actorAdminId, reason }) {
  await conn.query(
    `INSERT INTO crm_classification_events (contact_id, from_classification, to_classification, event_type, source_ref, actor_admin_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [contactId, from, to, eventType, sourceRef || null, actorAdminId || null, reason ? String(reason).slice(0, 255) : null, sqlNow()]
  );
}

// Compare-and-set so two overlapping runs cannot both write an event for the same change.
async function moveClassification(conn, { contactId, from, to, eventType, sourceRef, actorAdminId, reason, locked }) {
  const [r] = await conn.query(
    'UPDATE newsletter_contacts SET crm_classification = ?, classification_updated_at = ?, classification_locked = ? WHERE id = ? AND crm_classification = ?',
    [to, sqlNow(), locked ? 1 : 0, contactId, from]
  );
  if (!r.affectedRows) return false;
  await writeEvent(conn, { contactId, from, to, eventType, sourceRef, actorAdminId, reason });
  return true;
}

async function firstQualifyingPurchaseId(conn, contactId) {
  const [rows] = await conn.query(`SELECT p.id ${PURCHASES_FROM} WHERE p.contact_id = ? AND ${QUALIFYING_SQL} ORDER BY p.id LIMIT 1`, [contactId]);
  return rows[0] ? rows[0].id : null;
}

async function firstQuoteId(conn, contact) {
  const [rows] = await conn.query(
    'SELECT id FROM quote_requests WHERE contact_id = ? OR LOWER(TRIM(email)) = LOWER(TRIM(?)) ORDER BY id LIMIT 1',
    [contact.id, contact.email]
  );
  return rows[0] ? rows[0].id : null;
}

// Re-derive one contact from the facts. Safe to run any number of times. { dryRun: true } reports without writing.
// Freezes the trial flag on this contact's purchases that have none yet (punch list B15). Safe to repeat; a purchase already frozen is never touched.
async function freezeTrialFlags(conn, contactId) {
  await conn.query('UPDATE purchases SET is_trial_flag = COALESCE((SELECT is_trial FROM license_products WHERE license_products.id = purchases.license_product_id), 0) WHERE contact_id = ? AND is_trial_flag IS NULL', [contactId]);
}

async function reconcileContact(conn, contactId, { actorAdminId = null, dryRun = false, reason = null } = {}) {
  const [[contact]] = await conn.query('SELECT id, email, crm_classification, classification_locked FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!contact) return { found: false, changed: false };
  const current = contact.crm_classification || 'suspect';
  const locked = Number(contact.classification_locked) === 1;
  if (!dryRun) await freezeTrialFlags(conn, contactId);

  const purchaseId = await firstQualifyingPurchaseId(conn, contactId);
  const quoteId = (purchaseId || current !== 'suspect') ? null : await firstQuoteId(conn, contact);
  const move = derive({ current, locked, hasQualifyingPurchase: !!purchaseId, hasQuote: !!quoteId });

  if (move) {
    const sourceRef = move.to === 'customer' ? `purchase:${purchaseId}` : `quote:${quoteId}`;
    if (!dryRun) {
      const ok = await moveClassification(conn, { contactId, from: current, to: move.to, eventType: move.eventType, sourceRef, actorAdminId, reason });
      if (!ok) return { found: true, changed: false, raced: true };
    }
    return { found: true, changed: true, from: current, to: move.to, eventType: move.eventType, sourceRef };
  }

  // A derived Customer whose qualifying purchase is gone (refund, unpaid, trial reclassified) is flagged once, never demoted.
  if (current === 'customer' && !locked && !purchaseId) {
    const [last] = await conn.query('SELECT event_type FROM crm_classification_events WHERE contact_id = ? ORDER BY id DESC LIMIT 1', [contactId]);
    if (!last[0] || last[0].event_type !== 'needs_review') {
      if (!dryRun) await writeEvent(conn, { contactId, from: current, to: current, eventType: 'needs_review', sourceRef: 'no-qualifying-purchase', actorAdminId, reason: 'No qualifying paid purchase is left; classification kept' });
      return { found: true, changed: false, needsReview: true };
    }
  }
  return { found: true, changed: false };
}

// Every contact whose classification could change: anyone with a purchase, anyone with a quote, and every current Customer (to flag review).
// Punch list B14: the quote match used to be a join on LOWER(TRIM(email)) with an OR, which a database cannot index (it compares every quote with every contact).
// It is now three plain reads and a set lookup in memory: the work grows with the number of rows, not with their product.
async function candidateContactIds(conn) {
  const ids = new Set();
  const [a] = await conn.query('SELECT DISTINCT contact_id AS id FROM purchases');
  for (const r of a) ids.add(r.id);
  const [byLink] = await conn.query('SELECT DISTINCT contact_id AS id FROM quote_requests WHERE contact_id IS NOT NULL');
  for (const r of byLink) ids.add(r.id);
  const [quoteMail] = await conn.query("SELECT DISTINCT email FROM quote_requests WHERE email IS NOT NULL AND email <> ''");
  const quoted = new Set(quoteMail.map(r => String(r.email).trim().toLowerCase()));
  if (quoted.size) {
    const [people] = await conn.query('SELECT id, email FROM newsletter_contacts');
    for (const r of people) if (quoted.has(String(r.email || '').trim().toLowerCase())) ids.add(r.id);
  }
  const [c] = await conn.query("SELECT id FROM newsletter_contacts WHERE crm_classification = 'customer'");
  for (const r of c) ids.add(r.id);
  return [...ids].sort((x, y) => x - y);
}

// The nightly safety net and the backfill. Returns ids and counts only (no names or emails), so the output is safe to paste into the public repo's docs.
async function reconcileAll(conn, { dryRun = false, actorAdminId = null } = {}) {
  const ids = await candidateContactIds(conn);
  const summary = { examined: ids.length, changed: [], needsReview: [], toCustomer: 0, toProspect: 0 };
  for (const id of ids) {
    const r = await reconcileContact(conn, id, { dryRun, actorAdminId });
    if (r.changed) {
      summary.changed.push({ contactId: id, from: r.from, to: r.to, eventType: r.eventType });
      if (r.to === 'customer') summary.toCustomer++;
      if (r.to === 'prospect') summary.toProspect++;
    }
    if (r.needsReview) summary.needsReview.push(id);
  }
  return summary;
}

// Paid, non-trial purchases with an unknown or zero amount: the owner confirms each one by hand (decision D3). Ids only.
async function listPurchasesNeedingReview(conn) {
  const [rows] = await conn.query(`SELECT p.id AS purchase_id, p.contact_id, p.amount_cents ${PURCHASES_FROM} WHERE ${NEEDS_REVIEW_SQL} ORDER BY p.id`);
  return rows.map(r => ({ purchaseId: r.purchase_id, contactId: r.contact_id, amountCents: r.amount_cents === null ? null : Number(r.amount_cents) }));
}

function cleanText(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max);
}

// Staff: Suspect -> Prospect, with a recorded reason (and the actor).
async function promoteToProspect(conn, contactId, { actorAdminId, reason }) {
  const why = cleanText(reason, 255);
  if (!why) return { ok: false, code: 'reason_required', error: 'A reason is required to promote a contact to Prospect.' };
  const [[contact]] = await conn.query('SELECT id, crm_classification FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!contact) return { ok: false, code: 'not_found', error: 'Contact not found' };
  const current = contact.crm_classification || 'suspect';
  if (current !== 'suspect') return { ok: false, code: 'not_suspect', error: `This contact is already a ${current}; only a Suspect can be promoted.` };
  const moved = await moveClassification(conn, { contactId, from: 'suspect', to: 'prospect', eventType: 'manual_promotion', actorAdminId, reason: why });
  if (!moved) return { ok: false, code: 'changed', error: 'This contact changed while you were editing. Reload and try again.' };
  return { ok: true, from: 'suspect', to: 'prospect' };
}

// Staff (CRM Admin only; the route checks): set Customer with a reason AND evidence. The label is then locked against automatic changes.
async function setCustomerOverride(conn, contactId, { actorAdminId, reason, evidence }) {
  const why = cleanText(reason, 120);
  const proof = cleanText(evidence, 120);
  if (!why || !proof) return { ok: false, code: 'evidence_required', error: 'A reason and the evidence (for example "paid by check, invoice 12") are both required.' };
  const [[contact]] = await conn.query('SELECT id, crm_classification FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!contact) return { ok: false, code: 'not_found', error: 'Contact not found' };
  const current = contact.crm_classification || 'suspect';
  if (current === 'customer') {
    // Already a Customer: just lock it, so a later reconcile can never reclassify it; still audited.
    await conn.query('UPDATE newsletter_contacts SET classification_locked = 1, classification_updated_at = ? WHERE id = ?', [sqlNow(), contactId]);
    await writeEvent(conn, { contactId, from: current, to: current, eventType: 'manual_override', actorAdminId, reason: `${why}; evidence: ${proof}` });
    return { ok: true, from: current, to: 'customer', locked: true };
  }
  const moved = await moveClassification(conn, { contactId, from: current, to: 'customer', eventType: 'manual_override', actorAdminId, reason: `${why}; evidence: ${proof}`, locked: true });
  if (!moved) return { ok: false, code: 'changed', error: 'This contact changed while you were editing. Reload and try again.' };
  return { ok: true, from: current, to: 'customer', locked: true };
}

// Staff (CRM Admin only): hand a locked contact back to automatic reconciliation.
async function releaseOverride(conn, contactId, { actorAdminId, reason }) {
  const why = cleanText(reason, 255);
  if (!why) return { ok: false, code: 'reason_required', error: 'A reason is required.' };
  const [[contact]] = await conn.query('SELECT id, crm_classification, classification_locked FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!contact) return { ok: false, code: 'not_found', error: 'Contact not found' };
  if (!Number(contact.classification_locked)) return { ok: false, code: 'not_locked', error: 'This contact is not locked.' };
  await conn.query('UPDATE newsletter_contacts SET classification_locked = 0 WHERE id = ?', [contactId]);
  await writeEvent(conn, { contactId, from: contact.crm_classification, to: contact.crm_classification, eventType: 'override_released', actorAdminId, reason: why });
  const r = await reconcileContact(conn, contactId, { actorAdminId });
  return { ok: true, reconciled: r };
}

// Counts for the Overview, test addresses left out. Contacts only; account-level Customer is a separate, explicit figure (never mixed in).
async function classificationCounts(conn) {
  const [rows] = await conn.query(`SELECT crm_classification AS k, COUNT(*) AS n FROM newsletter_contacts WHERE NOT (${TEST_ADDRESS_SQL}) GROUP BY crm_classification`);
  const out = { suspect: 0, prospect: 0, customer: 0 };
  for (const r of rows) if (r.k in out) out[r.k] = Number(r.n);
  return out;
}

module.exports = {
  CLASSIFICATIONS, RANK,
  PURCHASES_FROM, QUALIFYING_SQL, NEEDS_REVIEW_SQL, NOT_REFUNDED_SQL, TRIAL_LIKE_SQL, TEST_ADDRESS_SQL,
  isQualifyingPurchase, isTrialLike, isTestAddress, derive,
  reconcileContact, reconcileAll, candidateContactIds, listPurchasesNeedingReview,
  promoteToProspect, setCustomerOverride, releaseOverride, classificationCounts, moveClassification,
  sqlNow,
};

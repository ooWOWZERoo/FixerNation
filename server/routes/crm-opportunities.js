// Sales CRM opportunities: one sale in progress at one account (mounted at /api/crm/opportunities).
// A deal's stage comes from crm_pipeline_stages and its state is open / won / lost / inactive. "Lost" is a STATE, not a stage. Neither is the contact's
// Suspect / Prospect / Customer label, and neither touches quote_requests.status. The deal value is ONE number on the deal: quote versions are never added up.
// Closing a deal Won here records the commercial commitment only. It creates no purchase, invoice or license (phase 4 hands off through the existing code).
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm, can, canEditDeal } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { closeDealWon } = require('../lib/crm-won');
const { procurementForDeal } = require('../lib/crm-procurement');
const { engagementFor } = require('../lib/crm-engagement');
const { purchaseIdForQuote } = require('../lib/quote-purchase');
const { cleanSigner, sha256 } = require('../lib/quote-evidence');
const { acceptQuoteViaPO } = require('./quote-accept');
const { isValidStateCode, stateName } = require('../lib/territories');
const {
  OPP_STATES, OPP_TYPES, COMMITTEE_ROLES, INFLUENCE, STANCE,
  text, posInt, cents, dateOnly, utcDateTime, oneOf, paging, likeTerm, daysSince,
} = require('../lib/crm-common');

const router = express.Router();

const OPP_SELECT = `SELECT o.*, s.stage_key, s.label AS stage_label, s.sort_order AS stage_sort, s.default_probability,
    a.name AS account_name, ow.username AS owner_name, lr.label AS loss_reason_label
  FROM crm_opportunities o
  JOIN crm_pipeline_stages s ON s.id = o.stage_id
  JOIN crm_accounts a ON a.id = o.account_id
  LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
  LEFT JOIN crm_loss_reasons lr ON lr.id = o.loss_reason_id`;

function oppRow(o) {
  const probability = o.probability_override !== null && o.probability_override !== undefined ? Number(o.probability_override) : Number(o.default_probability);
  return {
    id: o.id, accountId: o.account_id, accountName: o.account_name, name: o.name,
    ownerAdminId: o.owner_admin_id || null, ownerName: o.owner_name || null,
    stage: o.stage_key, stageLabel: o.stage_label, state: o.state,
    daysInStage: daysSince(o.stage_entered_at), stageEnteredAt: o.stage_entered_at,
    primaryContactId: o.primary_contact_id || null, oppType: o.opp_type,
    amountCents: o.amount_cents === null || o.amount_cents === undefined ? null : Number(o.amount_cents),
    probability, probabilityIsOverride: o.probability_override !== null && o.probability_override !== undefined,
    source: o.source, productFocus: o.product_focus,
    expectedCloseDate: o.expected_close_date || null, targetImplementationDate: o.target_implementation_date || null,
    nextStep: o.next_step, nextStepDueAt: o.next_step_due_at || null,
    lossReason: o.loss_reason_label || null, competitor: o.competitor, reengageOn: o.reengage_on || null,
    closedAt: o.closed_at || null, createdAt: o.created_at, updatedAt: o.updated_at,
  };
}

async function loadOpp(id) {
  const [[o]] = id ? await pool.query(`${OPP_SELECT} WHERE o.id = ?`, [id]) : [[null]];
  return o || null;
}

async function stageByKey(key) {
  const [[s]] = await pool.query('SELECT * FROM crm_pipeline_stages WHERE stage_key = ?', [key]);
  return s || null;
}

async function history(opportunityId, fromStageId, toStageId, fromState, toState, actorAdminId, reason) {
  await pool.query(
    `INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, actor_admin_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [opportunityId, fromStageId, toStageId, fromState, toState, actorAdminId, reason ? String(reason).slice(0, 255) : null, sqlNow()]
  );
}

// Loads the deal and enforces "may this role edit THIS deal". Sends the response itself and returns null when the request must stop.
async function guardedDeal(req, res) {
  const o = await loadOpp(posInt(req.params.id));
  if (!o) { res.status(404).json({ error: 'Deal not found' }); return null; }
  if (!canEditDeal(req.crm.role, req.crm.adminId, o)) {
    res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
    return null;
  }
  return o;
}

// Moving past Qualified needs a stated next step (what, and who owns the deal) unless staff say why not.
async function nextStepRule(deal, targetStage, overrideReason) {
  const qualified = await stageByKey('qualified');
  const pastQualified = qualified && targetStage.sort_order > qualified.sort_order;
  if (!pastQualified) return { ok: true };
  if (deal.next_step && String(deal.next_step).trim()) return { ok: true };
  const why = text(overrideReason, 200);
  if (why) return { ok: true, override: `Next step override: ${why}` };
  return { ok: false };
}

// ---- List -------------------------------------------------------------------------------------------------------------------------

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query);
  const where = [];
  const params = [];
  const state = req.query.state === 'all' ? null : (oneOf(req.query.state, OPP_STATES) || 'open');
  if (state) { where.push('o.state = ?'); params.push(state); }
  if (req.query.owner === 'none') where.push('o.owner_admin_id IS NULL');
  else if (req.query.owner === 'me') { where.push('o.owner_admin_id = ?'); params.push(req.crm.adminId); }
  else if (posInt(req.query.owner)) { where.push('o.owner_admin_id = ?'); params.push(posInt(req.query.owner)); }
  if (typeof req.query.stage === 'string' && /^[a-z_]{2,32}$/.test(req.query.stage)) { where.push('s.stage_key = ?'); params.push(req.query.stage); }
  if (posInt(req.query.accountId)) { where.push('o.account_id = ?'); params.push(posInt(req.query.accountId)); }
  if (req.query.noNextStep === 'true') where.push("(o.next_step IS NULL OR o.next_step = '')");
  // Saved views are just these filters in the page address: overdue next steps, and deals that have sat in their stage for N days or more.
  if (req.query.overdue === 'true') { where.push('o.next_step_due_at IS NOT NULL AND o.next_step_due_at < ?'); params.push(sqlNow()); }
  const stale = posInt(req.query.staleDays);
  if (stale) { where.push('o.stage_entered_at < ?'); params.push(new Date(Date.now() - stale * 86400000).toISOString().slice(0, 19).replace('T', ' ')); }
  // G7: the saved views the first build lacked. Each is just a filter in the page address, like the ones above.
  const oppType = oneOf(req.query.oppType, OPP_TYPES);
  if (oppType) { where.push('o.opp_type = ?'); params.push(oppType); }
  const accountType = oneOf(req.query.accountType, ['school', 'district']);
  if (accountType) { where.push('a.account_type = ?'); params.push(accountType); }
  // The account's State is free text (a backfilled quote's bill-to state, or whatever staff typed), so a code matches the code or the full name, any case: PA or Pennsylvania.
  const stateCode = typeof req.query.accountState === 'string' ? req.query.accountState.trim().toUpperCase() : '';
  if (stateCode && isValidStateCode(stateCode)) { where.push('(LOWER(TRIM(a.state)) = ? OR LOWER(TRIM(a.state)) = ?)'); params.push(stateCode.toLowerCase(), stateName(stateCode).toLowerCase()); }
  else if (stateCode) return res.status(400).json({ error: 'accountState must be a two-letter state code.' });
  // "This quarter" is the calendar quarter of the day the page names (the person's own day), else the server's UTC day.
  if (req.query.closeIn === 'quarter') {
    const day = dateOnly(req.query.today) || new Date().toISOString().slice(0, 10);
    const y = Number(day.slice(0, 4)), qStart = Math.floor((Number(day.slice(5, 7)) - 1) / 3) * 3;
    const from = `${y}-${String(qStart + 1).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(y, qStart + 3, 0)).toISOString().slice(0, 10);
    where.push('o.expected_close_date IS NOT NULL AND o.expected_close_date >= ? AND o.expected_close_date <= ?'); params.push(from, to);
  }
  // Won, and no paid purchase on any of the deal's quotes: nothing was bought, or a purchase order is still waiting. (Pair it with state=won.)
  if (req.query.unpaid === 'true') where.push("NOT EXISTS (SELECT 1 FROM purchases up JOIN quote_requests uq ON uq.id = up.quote_id WHERE uq.opportunity_id = o.id AND up.payment_status = 'paid')");
  // A live trial that ends within N days, reached through the deal's own quotes or through the account's school.
  const trialDays = posInt(req.query.trialEndsInDays);
  if (trialDays) {
    const now = sqlNow();
    const until = `${new Date(Date.now() + Math.min(trialDays, 90) * 86400000).toISOString().slice(0, 10)} 23:59:59`;
    where.push(`EXISTS (SELECT 1 FROM purchases tp LEFT JOIN quote_requests tq ON tq.id = tp.quote_id WHERE tp.trial_expiration_date IS NOT NULL AND tp.trial_expiration_date >= ? AND tp.trial_expiration_date <= ?
      AND COALESCE(tp.license_status, 'active') NOT IN ('cancelled', 'suspended') AND (tq.opportunity_id = o.id OR (a.school_id IS NOT NULL AND tp.school_id = a.school_id)))`);
    params.push(now, until);
  }
  const like = likeTerm(req.query.q);
  if (like) { where.push("(o.name LIKE ? ESCAPE '!' OR a.name LIKE ? ESCAPE '!')"); params.push(like, like); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id JOIN crm_accounts a ON a.id = o.account_id';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${w}`, params);
  const order = { updated: 'o.updated_at', name: 'o.name', amount: 'o.amount_cents', stage: 's.sort_order', nextstep: 'o.next_step_due_at', daysinstage: 'o.stage_entered_at', close: 'o.expected_close_date' }[req.query.sort] || 'o.updated_at';
  // More days in a stage means an EARLIER entry date, so that one sort key reads the other way round.
  const flip = req.query.sort === 'daysinstage';
  const dir = (req.query.dir === 'asc') !== flip ? 'ASC' : 'DESC';
  const [rows] = await pool.query(`${OPP_SELECT} ${w} ORDER BY ${order} ${dir}, o.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);

  // Forecast figures: one row per deal (each deal has exactly one stage and one value), so nothing can be counted twice.
  const [open] = await pool.query(
    `SELECT o.amount_cents, COALESCE(o.probability_override, s.default_probability) AS prob ${from} ${w ? w + " AND o.state = 'open'" : "WHERE o.state = 'open'"}`, params);
  let gross = 0, weighted = 0, unvalued = 0;
  for (const r of open) {
    if (r.amount_cents === null || r.amount_cents === undefined) { unvalued++; continue; }
    gross += Number(r.amount_cents);
    weighted += Math.round(Number(r.amount_cents) * Number(r.prob) / 100);
  }
  res.json({ opportunities: rows.map(oppRow), total: Number(total), page, pageSize: size, summary: { openCount: open.length, grossCents: gross, weightedCents: weighted, openWithoutValue: unvalued } });
});

// ---- One deal ---------------------------------------------------------------------------------------------------------------------

// Phase 6: the "Trial and demo engagement" card. Read only; counts only; an unknown is never shown as a zero (lib/crm-engagement.js).
router.get('/:id/engagement', requireAuth, requireCrm('view'), async (req, res) => {
  const out = await engagementFor(pool, 'opportunity', posInt(req.params.id));
  if (!out) return res.status(404).json({ error: 'Deal not found' });
  res.json(out);
});

router.get('/:id', requireAuth, requireCrm('view'), async (req, res) => {
  const o = await loadOpp(posInt(req.params.id));
  if (!o) return res.status(404).json({ error: 'Deal not found' });
  const [committee] = await pool.query(
    `SELECT oc.contact_id, c.name, c.email, c.crm_classification, oc.role, oc.influence, oc.stance, oc.notes
     FROM crm_opportunity_contacts oc JOIN newsletter_contacts c ON c.id = oc.contact_id WHERE oc.opportunity_id = ? ORDER BY c.name`, [o.id]);
  const [hist] = await pool.query(
    `SELECT h.id, h.from_stage_id, h.to_stage_id, h.from_state, h.to_state, h.reason, h.created_at, fs.label AS from_label, ts.label AS to_label, u.username AS actor
     FROM crm_opportunity_stage_history h
     LEFT JOIN crm_pipeline_stages fs ON fs.id = h.from_stage_id JOIN crm_pipeline_stages ts ON ts.id = h.to_stage_id
     LEFT JOIN admin_users u ON u.id = h.actor_admin_id WHERE h.opportunity_id = ? ORDER BY h.id`, [o.id]);
  // The quote's accept token is deliberately not selected: it is a credential for the public accept page.
  const [quotes] = await pool.query(
    `SELECT id, quote_number, status, quoted_amount_cents, quote_sent_at, quote_valid_until, accepted_at, revision_number, version_status, supersedes_quote_id,
            acceptance_name, acceptance_title, acceptance_recorded_at, acceptance_recorded_by, acceptance_terms_version, acceptance_document_hash
     FROM quote_requests WHERE opportunity_id = ? ORDER BY id`, [o.id]);
  const [purchases] = await pool.query(
    `SELECT p.id, p.payment_status, p.payment_method, p.amount_cents, p.license_status, p.quote_id
     FROM purchases p JOIN quote_requests q ON q.id = p.quote_id WHERE q.opportunity_id = ? ORDER BY p.id`, [o.id]);
  const [events] = await pool.query(
    `SELECT e.id, e.quote_id, e.event_type, e.detail, e.created_at, q.quote_number FROM crm_quote_events e JOIN quote_requests q ON q.id = e.quote_id
     WHERE q.opportunity_id = ? ORDER BY e.id DESC LIMIT 50`, [o.id]);
  res.json({
    opportunity: oppRow(o),
    committee: committee.map(c => ({ contactId: c.contact_id, name: c.name, email: c.email, classification: c.crm_classification, role: c.role, influence: c.influence, stance: c.stance, notes: c.notes })),
    history: hist.map(h => ({ id: h.id, from: h.from_label || null, to: h.to_label, fromState: h.from_state, toState: h.to_state, reason: h.reason, at: h.created_at, actor: h.actor || null })),
    quotes: quotes.map(q => ({
      id: q.id, quoteNumber: q.quote_number, status: q.status, amountCents: q.quoted_amount_cents === null ? null : Number(q.quoted_amount_cents), sentAt: q.quote_sent_at, validUntil: q.quote_valid_until, acceptedAt: q.accepted_at,
      revisionNumber: Number(q.revision_number || 1), versionStatus: q.version_status || 'current', supersedesQuoteId: q.supersedes_quote_id || null,
      // Who accepted and what they were shown (staff only). The hash is shortened: it proves the record, it is not a secret, but nobody reads 64 characters.
      // Read-only gets no signer name or title (a named person at the customer); they still see that it was accepted, when and how (punch list S7).
      acceptance: q.acceptance_recorded_at && q.accepted_at ? { name: can(req.crm.role, 'write') ? q.acceptance_name : null, title: can(req.crm.role, 'write') ? q.acceptance_title : null, at: q.acceptance_recorded_at, by: q.acceptance_recorded_by, termsVersion: q.acceptance_terms_version, documentHash: q.acceptance_document_hash ? String(q.acceptance_document_hash).slice(0, 12) : null } : null,
    })),
    // Payment is shown next to the deal state, never inferred from it.
    purchases: purchases.map(p => ({ id: p.id, quoteId: p.quote_id, paymentStatus: p.payment_status, paymentMethod: p.payment_method, amountCents: p.amount_cents === null ? null : Number(p.amount_cents), licenseStatus: p.license_status })),
    procurement: await procurementForDeal(pool, o.id),
    // 'viewed' is approximate (a mail scanner that runs scripts could cause it); the page labels it so.
    quoteEvents: events.map(e => ({ id: e.id, quoteId: e.quote_id, quoteNumber: e.quote_number || null, type: e.event_type, detail: e.detail, at: e.created_at })),
    permissions: { acceptForCustomer: can(req.crm.role, 'accept_for_customer') },
  });
});

// Punch list S10: the acceptance record in full (what the buyer was shown, as stored at the moment of acceptance) for a dispute. CRM Admin only (the audit_view right), and
// every look is written to the audit log, because the signer is a named person at the customer. A quote accepted before the snapshot was stored has the hash only.
router.get('/:id/quotes/:quoteId/evidence', requireAuth, requireCrm('audit_view'), async (req, res) => {
  const o = await loadOpp(posInt(req.params.id));
  if (!o) return res.status(404).json({ error: 'Deal not found' });
  const quoteId = posInt(req.params.quoteId);
  const [[q]] = quoteId ? await pool.query('SELECT * FROM quote_requests WHERE id = ? AND opportunity_id = ?', [quoteId, o.id]) : [[null]];
  if (!q || !q.acceptance_recorded_at || !q.accepted_at) return res.status(404).json({ error: 'There is no acceptance record for that quote.' });
  await crmAudit(req, { action: 'crm_quote_evidence_viewed', entityType: 'crm_opportunity', entityId: o.id, next: { quoteId: q.id, quoteNumber: q.quote_number || null } });
  const text = q.acceptance_document_snapshot || null;
  res.json({
    quoteId: q.id, quoteNumber: q.quote_number || null, revisionNumber: Number(q.revision_number || 1), acceptedAt: q.accepted_at,
    signerName: q.acceptance_name || null, signerTitle: q.acceptance_title || null, recordedAt: q.acceptance_recorded_at, recordedBy: q.acceptance_recorded_by || null,
    termsVersion: q.acceptance_terms_version || null, documentHash: q.acceptance_document_hash || null,
    // The stored text and a fresh check that it still produces the stored hash. null (not false) when the text was never stored.
    snapshot: text ? JSON.parse(text) : null,
    hashMatches: text ? sha256(text) === q.acceptance_document_hash : null,
  });
});

// ---- Create and edit --------------------------------------------------------------------------------------------------------------

// Fields a person may set on a deal. Returns { error } or { fields } (column names).
async function cleanDeal(req, b, { existing = null } = {}) {
  const f = {};
  if (!existing || b.name !== undefined) { f.name = text(b.name, 255); if (!f.name) return { error: 'A name is required.' }; }
  if (b.oppType !== undefined) { f.opp_type = oneOf(b.oppType, OPP_TYPES); if (!f.opp_type) return { error: `The type must be one of: ${OPP_TYPES.join(', ')}.` }; }
  if (b.amountCents !== undefined) {
    f.amount_cents = b.amountCents === null ? null : cents(b.amountCents);
    if (b.amountCents !== null && f.amount_cents === null) return { error: 'The value must be whole cents (a number of 0 or more).' };
  }
  for (const [key, col, max] of [['source', 'source', 128], ['productFocus', 'product_focus', 255], ['competitor', 'competitor', 128]]) {
    if (b[key] !== undefined) f[col] = text(b[key], max);
  }
  for (const [key, col] of [['expectedCloseDate', 'expected_close_date'], ['targetImplementationDate', 'target_implementation_date']]) {
    if (b[key] === undefined) continue;
    f[col] = b[key] === null ? null : dateOnly(b[key]);
    if (b[key] !== null && !f[col]) return { error: `${key} must be a real date (YYYY-MM-DD).` };
  }
  if (b.nextStep !== undefined) f.next_step = text(b.nextStep, 255);
  if (b.nextStepDueAt !== undefined) {
    f.next_step_due_at = b.nextStepDueAt === null ? null : utcDateTime(b.nextStepDueAt);
    if (b.nextStepDueAt !== null && !f.next_step_due_at) return { error: 'The next-step due date must be a real date.' };
  }
  if (b.probabilityOverride !== undefined) {
    if (!can(req.crm.role, 'override_probability')) return { error: 'Only a CRM Admin can override a deal\'s probability.', status: 403 };
    if (b.probabilityOverride === null) f.probability_override = null;
    else if (Number.isInteger(b.probabilityOverride) && b.probabilityOverride >= 0 && b.probabilityOverride <= 100) f.probability_override = b.probabilityOverride;
    else return { error: 'The probability must be a whole number from 0 to 100.' };
  }
  if (b.ownerAdminId !== undefined) {
    f.owner_admin_id = b.ownerAdminId === null ? null : posInt(b.ownerAdminId);
    if (f.owner_admin_id) {
      const [[a]] = await pool.query('SELECT id FROM admin_users WHERE id = ?', [f.owner_admin_id]);
      if (!a) return { error: 'That staff member does not exist.' };
    }
    // Sales may take a deal for themselves; handing it to someone else (or to nobody) is for the CRM Admin.
    if (req.crm.role !== 'admin' && f.owner_admin_id !== req.crm.adminId) return { error: 'Only a CRM Admin can hand a deal to someone else.', status: 403 };
  }
  if (b.primaryContactId !== undefined) {
    f.primary_contact_id = b.primaryContactId === null ? null : posInt(b.primaryContactId);
    if (f.primary_contact_id) {
      const [[c]] = await pool.query('SELECT id FROM newsletter_contacts WHERE id = ?', [f.primary_contact_id]);
      if (!c) return { error: 'That contact does not exist.' };
    }
  }
  return { fields: f };
}

router.post('/', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const b = req.body || {};
  const accountId = posInt(b.accountId);
  const [[acct]] = accountId ? await pool.query('SELECT id, archived_at FROM crm_accounts WHERE id = ?', [accountId]) : [[null]];
  if (!acct) return res.status(400).json({ error: 'Pick an account for this deal.' });
  if (acct.archived_at) return res.status(409).json({ code: 'account_archived', error: 'That account is archived. Restore it first.' });
  const stage = await stageByKey(b.stageKey === undefined ? 'new_inquiry' : String(b.stageKey));
  if (!stage || !stage.is_active || stage.stage_key === 'won') return res.status(400).json({ error: 'Pick an open stage to start in.' });

  // The creator owns the deal unless the request names someone (a Sales user may only name themselves).
  const input = { ...b };
  if (input.ownerAdminId === undefined) input.ownerAdminId = req.crm.adminId;
  const c = await cleanDeal(req, input);
  if (c.error) return res.status(c.status || 400).json({ error: c.error });
  const rule = await nextStepRule({ next_step: c.fields.next_step }, stage, b.overrideReason);
  if (!rule.ok) return res.status(409).json({ code: 'next_step_required', error: 'Add a next step before starting a deal past Qualified, or say why there is none.' });

  const f = { ...c.fields, account_id: accountId, stage_id: stage.id, state: 'open', stage_entered_at: sqlNow(), created_by_admin_id: req.crm.adminId };
  const cols = Object.keys(f);
  const [r] = await pool.query(`INSERT INTO crm_opportunities (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(k => f[k]));
  await history(r.insertId, null, stage.id, null, 'open', req.crm.adminId, rule.override || 'Deal created');
  await crmAudit(req, { action: 'crm_opportunity_created', entityType: 'crm_opportunity', entityId: r.insertId, next: { name: f.name, accountId, stage: stage.stage_key } });
  res.status(201).json({ ok: true, id: r.insertId });
});

// Punch list B16: an edit is applied only to the deal as it was read. The write is conditional on the stage and state still being what this request read (so it cannot
// land half way through someone's stage move or close), and, when the page sends `expectedUpdatedAt` (the `updatedAt` it was showing), on nobody else having saved in the
// meantime; otherwise 409 `changed` and nothing is written. A deal past Qualified cannot have its next step blanked unless `overrideReason` says why (the same rule as a stage move).
router.put('/:id', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const o = await guardedDeal(req, res);
  if (!o) return;
  const b = req.body || {};
  const CHANGED = { code: 'changed', error: 'Someone else just changed this deal. The page has been refreshed; look it over and save again.' };
  if (b.expectedUpdatedAt !== undefined && String(b.expectedUpdatedAt) !== String(o.updated_at)) return res.status(409).json(CHANGED);
  const c = await cleanDeal(req, b, { existing: o });
  if (c.error) return res.status(c.status || 400).json({ error: c.error });
  const cols = Object.keys(c.fields);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  let override = null;
  if (o.state === 'open' && c.fields.next_step !== undefined && !c.fields.next_step) {
    const rule = await nextStepRule({ ...o, next_step: c.fields.next_step }, { sort_order: o.stage_sort }, b.overrideReason);
    if (!rule.ok) return res.status(409).json({ code: 'next_step_required', error: 'This deal is past Qualified, so it needs a next step. Write what happens next instead of clearing it.' });
    override = rule.override || null;
  }
  const where = ['id = ?', 'stage_id = ?', 'state = ?'];
  const wparams = [o.id, o.stage_id, o.state];
  if (b.expectedUpdatedAt !== undefined) { where.push('updated_at = ?'); wparams.push(String(b.expectedUpdatedAt)); }
  const [r] = await pool.query(`UPDATE crm_opportunities SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE ${where.join(' AND ')}`, [...cols.map(k => c.fields[k]), ...wparams]);
  if (!r.affectedRows) return res.status(409).json(CHANGED);
  await crmAudit(req, { action: 'crm_opportunity_updated', entityType: 'crm_opportunity', entityId: o.id, prev: Object.fromEntries(cols.map(k => [k, o[k]])), next: c.fields, reason: override });
  res.json({ ok: true });
});

// ---- Stage, close, reopen ---------------------------------------------------------------------------------------------------------

router.post('/:id/stage', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const o = await guardedDeal(req, res);
  if (!o) return;
  if (o.state !== 'open') return res.status(409).json({ code: 'not_open', error: 'Only an open deal can change stage. Reopen it first.' });
  const b = req.body || {};
  const target = await stageByKey(typeof b.stageKey === 'string' ? b.stageKey : '');
  if (!target || !target.is_active) return res.status(400).json({ error: 'Pick a stage from the list.' });
  if (target.stage_key === 'won') return res.status(400).json({ code: 'use_close', error: 'Use Close as Won to finish a deal.' });
  if (target.id === o.stage_id) return res.status(400).json({ error: 'The deal is already in that stage.' });
  const rule = await nextStepRule(o, target, b.overrideReason);
  if (!rule.ok) return res.status(409).json({ code: 'next_step_required', error: 'Add a next step before moving past Qualified, or say why there is none.' });
  const reason = [text(b.reason, 120), rule.override].filter(Boolean).join('; ') || null;
  // Compare-and-set on the stage, so two people moving the same card cannot both succeed.
  const [r] = await pool.query('UPDATE crm_opportunities SET stage_id = ?, stage_entered_at = ? WHERE id = ? AND stage_id = ? AND state = ?', [target.id, sqlNow(), o.id, o.stage_id, 'open']);
  if (!r.affectedRows) return res.status(409).json({ code: 'changed', error: 'This deal just changed. Reload and try again.' });
  await history(o.id, o.stage_id, target.id, 'open', 'open', req.crm.adminId, reason);
  await crmAudit(req, { action: 'crm_opportunity_stage_changed', entityType: 'crm_opportunity', entityId: o.id, prev: { stage: o.stage_key }, next: { stage: target.stage_key }, reason });
  res.json({ ok: true, stage: target.stage_key });
});

router.post('/:id/close', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const o = await guardedDeal(req, res);
  if (!o) return;
  if (o.state !== 'open') return res.status(409).json({ code: 'not_open', error: 'This deal is already closed.' });
  const b = req.body || {};
  const outcome = oneOf(b.outcome, ['won', 'lost', 'inactive']);
  if (!outcome) return res.status(400).json({ error: 'The outcome must be won, lost or inactive.' });
  const sets = { state: outcome, closed_at: sqlNow() };
  let toStageId = o.stage_id;
  if (outcome === 'won') {
    const won = await stageByKey('won');
    if (!won) return res.status(500).json({ error: 'The Won stage is missing. Run the CRM setup script.' });
    sets.stage_id = toStageId = won.id;
    sets.stage_entered_at = sqlNow();
  }
  if (outcome === 'lost') {
    const [[lr]] = typeof b.lossReason === 'string' ? await pool.query('SELECT id FROM crm_loss_reasons WHERE reason_key = ? AND is_active = 1', [b.lossReason]) : [[null]];
    if (!lr) return res.status(400).json({ code: 'loss_reason_required', error: 'Pick why the deal was lost.' });
    sets.loss_reason_id = lr.id;
    if (b.competitor !== undefined) sets.competitor = text(b.competitor, 128);
    if (b.reengageOn !== undefined && b.reengageOn !== null) {
      sets.reengage_on = dateOnly(b.reengageOn);
      if (!sets.reengage_on) return res.status(400).json({ error: 'The re-engage date must be a real date (YYYY-MM-DD).' });
    }
  }
  const cols = Object.keys(sets);
  const [r] = await pool.query(`UPDATE crm_opportunities SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND state = 'open'`, [...cols.map(k => sets[k]), o.id]);
  if (!r.affectedRows) return res.status(409).json({ code: 'changed', error: 'This deal just changed. Reload and try again.' });
  await history(o.id, o.stage_id, toStageId, 'open', outcome, req.crm.adminId, text(b.reason, 200));
  await crmAudit(req, { action: 'crm_opportunity_closed', entityType: 'crm_opportunity', entityId: o.id, prev: { state: 'open' }, next: { state: outcome }, reason: text(b.reason, 200) });
  res.json({ ok: true, state: outcome });
});

// ---- Won handoff (phase 4c) -------------------------------------------------------------------------------------------------------
// CRM Admin only. Closes the deal Won and, if the named quote is not accepted yet, accepts it by purchase order FOR the customer through the existing code
// (acceptQuoteViaPO: the same purchase, seats, invoice and emails as the customer's own PO acceptance). This route never inserts a purchase or invoice itself.
// Repeating the request returns the first result: the quote can be claimed once, so a second call creates nothing and reports the same purchase and invoice.
const FRIENDLY = {
  expired: 'That quote has expired. Extend its valid-until date on the Quotes page, then try again.',
  superseded: 'A newer revision of that quote was sent, so this one cannot be accepted. Use the newer quote.',
  not_found: 'That quote could not be found.',
};

router.post('/:id/won-handoff', requireAuth, requireCrm('accept_for_customer'), async (req, res) => {
  const o = await loadOpp(posInt(req.params.id));
  if (!o) return res.status(404).json({ error: 'Deal not found' });
  if (o.state === 'lost' || o.state === 'inactive') return res.status(409).json({ code: 'not_open', error: 'This deal is closed as ' + o.state + '. Reopen it first.' });
  const b = req.body || {};
  const quoteId = posInt(b.quoteId);
  const [[q]] = quoteId ? await pool.query('SELECT id, quote_number, accepted_at, accepted_payment_method, version_status FROM quote_requests WHERE id = ? AND opportunity_id = ?', [quoteId, o.id]) : [[null]];
  if (!q) return res.status(400).json({ error: 'Pick a quote that is on this deal.' });

  const alreadyAccepted = !!q.accepted_at;
  let accepted = null;
  if (!alreadyAccepted) {
    if (q.version_status === 'superseded') return res.status(409).json({ code: 'superseded', error: FRIENDLY.superseded });
    const signer = cleanSigner({ signerName: b.signerName, signerTitle: b.signerTitle });
    if (signer.error) return res.status(400).json({ code: signer.code, error: signer.error.replace(/ If the page was already open.*$/, '') });
    const poNumber = text(b.poNumber, 128) || '';
    try {
      accepted = await acceptQuoteViaPO(q.id, poNumber, undefined, { signer, recordedBy: 'staff', skipDealClose: true });
    } catch (err) {
      // Two requests at once: the other one claimed the quote. Carry on and report what it made.
      if (!(err.status && err.message === 'already_accepted')) {
        if (err.status) return res.status(err.status).json({ code: 'accept_failed', error: FRIENDLY[err.message] || err.message });
        throw err;
      }
    }
    if (accepted) await crmAudit(req, { action: 'crm_won_handoff', entityType: 'crm_opportunity', entityId: o.id, next: { quoteId: q.id, purchaseId: accepted.purchaseId, invoiceId: accepted.invoiceId, poNumber: poNumber || null } });
  }

  const purchaseId = accepted ? accepted.purchaseId : await purchaseIdForQuote(pool, q.id);
  const [[purchase]] = purchaseId ? await pool.query('SELECT id, invoice_id, payment_status, license_status FROM purchases WHERE id = ?', [purchaseId]) : [[null]];
  const closed = o.state === 'open'
    ? await closeDealWon(pool, o.id, { actorAdminId: req.crm.adminId, reason: accepted ? `Won: quote ${q.quote_number || q.id} accepted by PO for the customer` : `Won: quote ${q.quote_number || q.id} was already accepted` })
    : false;
  // "repeated" = nothing new happened: the quote was accepted before this call and the deal was already won.
  res.json({
    ok: true, repeated: !accepted && !closed, accepted: !!accepted, dealClosed: closed, state: 'won',
    purchaseId: purchase ? purchase.id : null, invoiceId: purchase ? purchase.invoice_id || null : null,
    paymentStatus: purchase ? purchase.payment_status : null, licenseStatus: purchase ? purchase.license_status : null,
  });
});

// CRM Admin only, with a reason.
router.post('/:id/reopen', requireAuth, requireCrm('reopen_deal'), async (req, res) => {
  const o = await loadOpp(posInt(req.params.id));
  if (!o) return res.status(404).json({ error: 'Deal not found' });
  if (o.state === 'open') return res.status(409).json({ code: 'already_open', error: 'This deal is already open.' });
  const b = req.body || {};
  const why = text(b.reason, 200);
  if (!why) return res.status(400).json({ code: 'reason_required', error: 'A reason is required to reopen a deal.' });
  // A Won deal sits in the Won stage, which is not an open stage: it comes back at the stage named, or Verbal Commitment.
  let stage = { id: o.stage_id, stage_key: o.stage_key };
  if (b.stageKey !== undefined || o.stage_key === 'won') {
    const s = await stageByKey(typeof b.stageKey === 'string' ? b.stageKey : 'verbal_commitment');
    if (!s || !s.is_active || s.stage_key === 'won') return res.status(400).json({ error: 'Pick an open stage to reopen into.' });
    stage = s;
  }
  const [r] = await pool.query(
    "UPDATE crm_opportunities SET state = 'open', closed_at = NULL, loss_reason_id = NULL, stage_id = ?, stage_entered_at = ? WHERE id = ? AND state = ?",
    [stage.id, sqlNow(), o.id, o.state]);
  if (!r.affectedRows) return res.status(409).json({ code: 'changed', error: 'This deal just changed. Reload and try again.' });
  await history(o.id, o.stage_id, stage.id, o.state, 'open', req.crm.adminId, `Reopened: ${why}`);
  await crmAudit(req, { action: 'crm_opportunity_reopened', entityType: 'crm_opportunity', entityId: o.id, prev: { state: o.state }, next: { state: 'open' }, reason: why });
  res.json({ ok: true });
});

// ---- Buying committee -------------------------------------------------------------------------------------------------------------

router.post('/:id/contacts', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const o = await guardedDeal(req, res);
  if (!o) return;
  const b = req.body || {};
  const contactId = posInt(b.contactId);
  const [[c]] = contactId ? await pool.query('SELECT id FROM newsletter_contacts WHERE id = ?', [contactId]) : [[null]];
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  const role = b.role === undefined ? 'other' : oneOf(b.role, COMMITTEE_ROLES);
  const influence = b.influence === undefined || b.influence === null ? null : oneOf(b.influence, INFLUENCE);
  const stance = b.stance === undefined || b.stance === null ? null : oneOf(b.stance, STANCE);
  if (!role || (b.influence != null && !influence) || (b.stance != null && !stance)) return res.status(400).json({ error: 'The role, influence or stance is not one of the allowed values.' });
  const [dup] = await pool.query('SELECT id FROM crm_opportunity_contacts WHERE opportunity_id = ? AND contact_id = ?', [o.id, contactId]);
  if (dup[0]) return res.status(409).json({ code: 'already_member', error: 'This person is already on the buying committee.' });
  await pool.query('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role, influence, stance, notes) VALUES (?, ?, ?, ?, ?, ?)', [o.id, contactId, role, influence, stance, text(b.notes, 500)]);
  await crmAudit(req, { action: 'crm_committee_added', entityType: 'crm_opportunity', entityId: o.id, next: { contactId, role } });
  res.status(201).json({ ok: true });
});

router.put('/:id/contacts/:contactId', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const o = await guardedDeal(req, res);
  if (!o) return;
  const contactId = posInt(req.params.contactId);
  const [[m]] = contactId ? await pool.query('SELECT id FROM crm_opportunity_contacts WHERE opportunity_id = ? AND contact_id = ?', [o.id, contactId]) : [[null]];
  if (!m) return res.status(404).json({ error: 'That person is not on this deal.' });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.role !== undefined) { const v = oneOf(b.role, COMMITTEE_ROLES); if (!v) return res.status(400).json({ error: 'That role is not allowed.' }); sets.push('role = ?'); vals.push(v); }
  if (b.influence !== undefined) { const v = b.influence === null ? null : oneOf(b.influence, INFLUENCE); if (b.influence !== null && !v) return res.status(400).json({ error: 'That influence is not allowed.' }); sets.push('influence = ?'); vals.push(v); }
  if (b.stance !== undefined) { const v = b.stance === null ? null : oneOf(b.stance, STANCE); if (b.stance !== null && !v) return res.status(400).json({ error: 'That stance is not allowed.' }); sets.push('stance = ?'); vals.push(v); }
  if (b.notes !== undefined) { sets.push('notes = ?'); vals.push(text(b.notes, 500)); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
  await pool.query(`UPDATE crm_opportunity_contacts SET ${sets.join(', ')} WHERE id = ?`, [...vals, m.id]);
  await crmAudit(req, { action: 'crm_committee_updated', entityType: 'crm_opportunity', entityId: o.id, next: { contactId } });
  res.json({ ok: true });
});

router.delete('/:id/contacts/:contactId', requireAuth, requireCrm('edit_deal'), async (req, res) => {
  const o = await guardedDeal(req, res);
  if (!o) return;
  const contactId = posInt(req.params.contactId);
  const [r] = contactId ? await pool.query('DELETE FROM crm_opportunity_contacts WHERE opportunity_id = ? AND contact_id = ?', [o.id, contactId]) : [{ affectedRows: 0 }];
  if (!r.affectedRows) return res.status(404).json({ error: 'That person is not on this deal.' });
  await crmAudit(req, { action: 'crm_committee_removed', entityType: 'crm_opportunity', entityId: o.id, prev: { contactId } });
  res.json({ ok: true });
});

module.exports = router;

// Sales CRM punch list G4 (PRD FR-WON-03): once a deal is Won AND one of its quotes has a real paid purchase, the deal gets its onboarding checklist, once.
//
// Rules this file keeps (each has a test):
//  - "Won and paid" is the CRM's own definition of a Customer (lib/crm-classification.js QUALIFYING_SQL: paid, amount over 0, not a trial), reached through the deal's quotes
//    (purchases.quote_id -> quote_requests.opportunity_id). An accepted quote, an invoice or a PO alone does not count. A test address (@example.com) never counts.
//  - Once per deal, ever. The ledger table crm_onboarding_started is unique on opportunity_id and a row is claimed BEFORE the steps are written, so the daily job run twice, or
//    two runs at once, add the steps once. Staff deleting the steps does not bring them back: the ledger row stays.
//  - The steps are copied from the active template named "Onboarding" (Hub Settings > checklist templates, edited there). No template, or one with no steps: nothing is added and
//    nothing is claimed, so the deal is picked up as soon as a template exists.
//  - It writes checklist steps and a ledger row, nothing else. No task, email, purchase, invoice, license or contact label. A step the deal already has (same words) is skipped.
//  - Steps added by a person's own "apply template" before the job ran are respected: the job adds only what is missing and still records the deal as done.
// `conn` is the pool in the app and any query-capable handle in tests. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters).
const { audit } = require('./audit');
const { QUALIFYING_SQL } = require('./crm-classification');

const TEST_QUOTE_EMAIL = "LOWER(TRIM(q.email)) LIKE '%@example.com'";

const SWITCH = 'crm_onboarding_auto';
const TEMPLATE_NAME = 'Onboarding';
// The starter list the alter script seeds; the owner edits it in Hub Settings afterwards (the template row is the one truth).
const STARTER_STEPS = [
  'Welcome call booked',
  'Admin or district contact confirmed',
  'Teacher invitations sent',
  'First training session held',
  'Check-in at 30 days',
  'Renewal date noted',
];

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}
function stepsOf(row) {
  try { const j = JSON.parse(row.items_json || '[]'); return Array.isArray(j) ? j.map(x => String(x && x.label || '').trim()).filter(Boolean) : []; } catch { return []; }
}

// apply=false counts what it would do and writes nothing.
// Returns { available, hasTemplate, eligible, alreadyDone, made, wouldMake, stepsAdded }.
async function startOnboarding(conn, { apply = false, now } = {}) {
  const out = { available: true, hasTemplate: false, eligible: 0, alreadyDone: 0, made: 0, wouldMake: 0, stepsAdded: 0 };
  let done;
  try {
    const [rows] = await conn.query('SELECT opportunity_id FROM crm_onboarding_started');
    done = new Set(rows.map(r => Number(r.opportunity_id)));
  } catch (err) {
    if (!isMissing(err)) throw err;
    return { ...out, available: false }; // alter-create-crm-onboarding.js has not been run: nothing can be added safely
  }
  const [[tpl]] = await conn.query('SELECT id, items_json FROM crm_procurement_templates WHERE name = ? AND is_active = 1', [TEMPLATE_NAME]);
  const steps = tpl ? stepsOf(tpl) : [];
  out.hasTemplate = steps.length > 0;

  // Won deals that have a qualifying purchase on one of their quotes. DISTINCT: two paid quotes on a deal are still one deal.
  const [deals] = await conn.query(
    `SELECT DISTINCT o.id FROM crm_opportunities o
       JOIN quote_requests q ON q.opportunity_id = o.id
       JOIN purchases p ON p.quote_id = q.id
       LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE o.state = 'won' AND ${QUALIFYING_SQL}
       AND NOT (${TEST_QUOTE_EMAIL})
     ORDER BY o.id`);
  for (const d of deals) {
    const id = Number(d.id);
    out.eligible++;
    if (done.has(id)) { out.alreadyDone++; continue; }
    if (!out.hasTemplate) continue; // nothing to add yet; leave the deal unclaimed
    if (!apply) { out.wouldMake++; continue; }
    // Claim first: whoever inserts the ledger row owns the one set of steps. A duplicate means another run got there first.
    let claim;
    try {
      [claim] = await conn.query('INSERT INTO crm_onboarding_started (opportunity_id, template_id, steps_added, created_at) VALUES (?, ?, 0, ?)', [id, tpl.id, now]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') { done.add(id); out.alreadyDone++; continue; }
      throw err;
    }
    try {
      const [have] = await conn.query('SELECT label, sort_order FROM crm_opportunity_checklist_items WHERE opportunity_id = ?', [id]);
      const seen = new Set(have.map(r => String(r.label).trim().toLowerCase()));
      let sort = have.reduce((m, r) => Math.max(m, Number(r.sort_order || 0)), 0) + 10;
      let added = 0;
      for (const label of steps) {
        if (seen.has(label.toLowerCase())) continue;
        seen.add(label.toLowerCase());
        await conn.query('INSERT INTO crm_opportunity_checklist_items (opportunity_id, template_id, label, sort_order, created_by_admin_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
          [id, tpl.id, label, sort, now]);
        sort += 10; added++;
      }
      await conn.query('UPDATE crm_onboarding_started SET steps_added = ? WHERE id = ?', [added, claim.insertId]);
      done.add(id);
      out.made++; out.stepsAdded += added;
      await audit(conn, {
        actorType: 'system', action: 'crm_onboarding_started', entityType: 'crm_checklist', entityId: id,
        newValue: { generated: 'crm.onboarding', templateId: Number(tpl.id), added },
        reason: 'The onboarding checklist was added by the daily check, because the deal is Won and its purchase is paid.',
      });
    } catch (err) {
      // A failed write leaves no claim and no half list, so the next run tries again. (Steps already written stay: the next run skips them by their words.)
      await conn.query('DELETE FROM crm_onboarding_started WHERE id = ?', [claim.insertId]).catch(() => {});
      throw err;
    }
  }
  return out;
}

module.exports = { startOnboarding, SWITCH, TEMPLATE_NAME, STARTER_STEPS };

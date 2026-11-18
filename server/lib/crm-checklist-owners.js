// Who is responsible for a procurement step, and the list of one person's open steps across every deal ("My checklist steps").
//
// The rule (G15, the same one Needs Attention applies to "checklist step is overdue"): a step with its own owner belongs to that person, otherwise it belongs to the deal's owner.
// A deal nobody owns has nobody responsible for its blank steps, so those are on nobody's list. Only open steps on open deals are listed (a finished or not-needed step, or a
// closed deal, is nobody's work any more). Read only: this file never writes.
//
// Safe on an older install: if `owner_admin_id` is not on the steps yet (alter-add-crm-checklist-owner-files.js has not run) every step belongs to its deal's owner.
const { canEditDeal } = require('./crm-permissions');
const S = require('./crm-subjects');

const MAX_ROWS = 500; // one person's open steps; far more than anyone has, and it bounds the work
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));

// SQL for "this step's responsible person", used by anything that must agree with this rule.
const EFFECTIVE_OWNER_SQL = 'COALESCE(i.owner_admin_id, o.owner_admin_id)';

// May this person tick this step? The step's own named owner may (never Read-only); otherwise whoever may edit the deal (the same two rules as PUT /api/crm/checklists/:id).
function canTick(role, adminId, { stepOwnerId, dealOwnerId }) {
  if (role !== 'admin' && role !== 'sales') return false;
  if (stepOwnerId && Number(stepOwnerId) === Number(adminId)) return true;
  return canEditDeal(role, adminId, { owner_admin_id: dealOwnerId === undefined ? null : dealOwnerId });
}

const day10 = (v) => (v ? String(v).slice(0, 10) : null);

// Everything this person is responsible for, soonest due first (no due date last). `today` is their calendar day (YYYY-MM-DD).
async function stepsFor(conn, { adminId, role, today }) {
  const cols = 'i.id, i.label, i.due_on, i.note, o.id AS deal_id, o.name AS deal_name, o.owner_admin_id AS deal_owner, a.name AS account_name';
  const from = 'FROM crm_opportunity_checklist_items i JOIN crm_opportunities o ON o.id = i.opportunity_id JOIN crm_accounts a ON a.id = o.account_id';
  const order = 'ORDER BY (i.due_on IS NULL), i.due_on, i.id';
  let rows;
  try {
    [rows] = await conn.query(`SELECT ${cols}, i.owner_admin_id AS step_owner ${from} WHERE i.status = 'open' AND o.state = 'open' AND ${EFFECTIVE_OWNER_SQL} = ? ${order} LIMIT ${MAX_ROWS + 1}`, [adminId]);
  } catch (err) {
    if (!isMissing(err)) throw err;
    [rows] = await conn.query(`SELECT ${cols}, NULL AS step_owner ${from} WHERE i.status = 'open' AND o.state = 'open' AND o.owner_admin_id = ? ${order} LIMIT ${MAX_ROWS + 1}`, [adminId]);
  }
  const truncated = rows.length > MAX_ROWS;
  const steps = rows.slice(0, MAX_ROWS).map(r => ({
    id: Number(r.id), label: r.label, note: r.note || null, dueOn: day10(r.due_on), overdue: !!r.due_on && day10(r.due_on) < today,
    dealId: Number(r.deal_id), dealName: r.deal_name, accountName: r.account_name,
    namedOwner: !!r.step_owner, // true: this step names me; false: it is mine because I own the deal
    canComplete: canTick(role, adminId, { stepOwnerId: r.step_owner, dealOwnerId: r.deal_owner }),
  }));
  return { steps, truncated };
}

// The "upto" filter used by the Tasks page views: everything due by the end of day N from today, overdue included.
const dueByDay = (today, days) => S.addDays(today, Math.min(60, Math.max(0, Number(days) || 0)));

module.exports = { EFFECTIVE_OWNER_SQL, MAX_ROWS, canTick, stepsFor, dueByDay, isMissing };

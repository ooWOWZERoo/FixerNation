// Sales CRM punch list G3 (PRD FR-TRIAL-03): a review TASK for a trial that is nearly over, well used, or has not got going. The three Needs Attention rules in
// lib/crm-attention.js (trial_ending, trial_high_use, trial_stalled) find the trials; this file turns each one into one task for a person, once.
//
// Rules this file keeps (each has a test):
//  - Once per trial per reason, ever. The ledger table crm_trial_review_tasks is unique on (purchase_id, reason), and a row is claimed BEFORE the task is written, so two runs
//    at once, or the daily job run twice, make one task. A finished or deleted task is not made again: the ledger row stays.
//  - It writes a task and a ledger row, nothing else. No offer, quote, email, purchase, license, seat or contact label. (PRD: nothing here "issues an offer".)
//  - The task goes to the deal's owner, else the buyer's assigned owner, else it is left unassigned (the owner's choice) so it shows in the "mine or nobody" lists.
//    It hangs on the deal the trial's quote belongs to, else on the buyer's contact.
//  - Only items that are ACTIVE on Needs Attention count: one staff snoozed or dismissed is left alone. A trial for an @example.com address is never listed by the rules.
//  - The task text holds seat counts and dates only, never a teacher or student name. Unknown stays unknown: a trial with no seat records is never called stalled.
// `conn` is the pool in the app and any query-capable handle in tests. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters).
const { audit } = require('./audit');

const SWITCH = 'crm_trial_review_tasks';
// Needs Attention rule -> the reason stored in the ledger.
const REASONS = { trial_ending: 'ending', trial_high_use: 'high_use', trial_stalled: 'stalled' };

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}
function addDays(day, n) { return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10); }

// What the task says and when it is due, per reason. `endsOn` is the trial's last day (the Needs Attention item's fingerprint for the ending rule).
function taskText(item, today) {
  const sent = ' Nothing has been offered or sent to them. This task is only a reminder to take a look.';
  if (item.ruleKey === 'trial_ending') {
    const endsOn = String(item.fingerprint || '').slice(0, 10);
    const dueOn = endsOn && addDays(endsOn, -1) > today ? addDays(endsOn, -1) : today;
    return { title: `Trial ends ${endsOn || 'soon'}: ask how it went`, details: `${item.why}${sent}`, dueOn };
  }
  if (item.ruleKey === 'trial_high_use') return { title: 'Trial is well used: talk about a quote', details: `${item.why}${sent}`, dueOn: today };
  return { title: 'Trial has not got going: offer to help', details: `${item.why}${sent}`, dueOn: today };
}

// Where the task hangs and who gets it. Returns null when there is nothing to hang it on (the purchase has no deal and no contact: nothing is made, and it is counted).
async function placeFor(conn, item) {
  let owner = item.ownerAdminId ? Number(item.ownerAdminId) : null;
  if (owner) {
    const [[a]] = await conn.query('SELECT id FROM admin_users WHERE id = ?', [owner]);
    if (!a) owner = null; // an owner who no longer exists leaves it unassigned, never orphaned
  }
  if (item.dealId) {
    const [[o]] = await conn.query('SELECT id, account_id FROM crm_opportunities WHERE id = ?', [item.dealId]);
    if (o) return { cols: { opportunity_id: Number(o.id), account_id: Number(o.account_id), contact_id: null }, kind: 'opportunity', subjectId: Number(o.id), owner };
  }
  if (item.contactId) {
    const [[c]] = await conn.query('SELECT id FROM newsletter_contacts WHERE id = ?', [item.contactId]);
    if (c) return { cols: { opportunity_id: null, account_id: null, contact_id: Number(c.id) }, kind: 'contact', subjectId: Number(c.id), owner };
  }
  return null;
}

// items: the ACTIVE Needs Attention items (any rules; the trial ones are picked out here). apply=false counts what it would make and writes nothing.
// Returns { available, eligible, made, wouldMake, alreadyMade, noPlace, byReason: { ending, high_use, stalled } } (made/wouldMake are per reason too).
async function createReviewTasks(conn, items, { apply = false, now, today } = {}) {
  const out = { available: true, eligible: 0, made: 0, wouldMake: 0, alreadyMade: 0, noPlace: 0, byReason: {} };
  for (const r of Object.values(REASONS)) out.byReason[r] = { eligible: 0, made: 0, wouldMake: 0 };
  const mine = items.filter(i => REASONS[i.ruleKey] && i.subjectType === 'purchase');
  let ledger;
  try {
    const [rows] = await conn.query('SELECT purchase_id, reason FROM crm_trial_review_tasks');
    ledger = new Set(rows.map(r => `${r.purchase_id}|${r.reason}`));
  } catch (err) {
    if (!isMissing(err)) throw err;
    return { ...out, available: false }; // alter-create-crm-trial-review-tasks.js has not been run: nothing can be made safely
  }
  for (const it of mine) {
    const reason = REASONS[it.ruleKey];
    const key = `${it.subjectId}|${reason}`;
    out.eligible++; out.byReason[reason].eligible++;
    if (ledger.has(key)) { out.alreadyMade++; continue; }
    if (!apply) { out.wouldMake++; out.byReason[reason].wouldMake++; continue; }
    // Claim first: whoever inserts the ledger row owns the one task. A duplicate means another run got there first.
    let claim;
    try {
      [claim] = await conn.query('INSERT INTO crm_trial_review_tasks (purchase_id, reason, task_id, created_at) VALUES (?, ?, NULL, ?)', [it.subjectId, reason, now]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') { ledger.add(key); out.alreadyMade++; continue; }
      throw err;
    }
    try {
      const place = await placeFor(conn, it);
      if (!place) {
        await conn.query('DELETE FROM crm_trial_review_tasks WHERE id = ?', [claim.insertId]); // nothing to hang it on: leave no claim, so it can be made once a deal or contact exists
        out.noPlace++;
        continue;
      }
      const t = taskText(it, today);
      const [ins] = await conn.query(
        `INSERT INTO crm_tasks (opportunity_id, account_id, contact_id, title, details, due_on, state, assigned_admin_id, created_by_admin_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?)`,
        [place.cols.opportunity_id, place.cols.account_id, place.cols.contact_id, t.title.slice(0, 255), t.details.slice(0, 1000), t.dueOn, place.owner, now]);
      await conn.query('UPDATE crm_trial_review_tasks SET task_id = ? WHERE id = ?', [ins.insertId, claim.insertId]);
      ledger.add(key);
      out.made++; out.byReason[reason].made++;
      await audit(conn, {
        actorType: 'system', action: 'crm_task_created', entityType: 'crm_task', entityId: ins.insertId,
        newValue: { generated: `crm.trial.${reason}`, subject: place.kind, subjectId: place.subjectId, assignedAdminId: place.owner, dueOn: t.dueOn },
        reason: 'A review task made by the daily check for a trial (nothing was offered or sent).',
      });
    } catch (err) {
      await conn.query('DELETE FROM crm_trial_review_tasks WHERE id = ? AND task_id IS NULL', [claim.insertId]).catch(() => {}); // a failed write leaves no claim, so the next run tries again
      throw err;
    }
  }
  return out;
}

module.exports = { createReviewTasks, REASONS, SWITCH, taskText };

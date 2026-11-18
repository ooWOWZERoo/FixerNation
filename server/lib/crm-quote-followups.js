// Sales CRM punch list G20 (PRD section 20, the one event the owner chose): a follow-up TASK a settable number of days after a quote was sent and not accepted.
// The Needs Attention rule "quote has had no answer" (lib/crm-attention.js) only lists these; this file makes one task for a person, once per quote.
//
// Rules this file keeps (each has a test):
//  - Once per quote, ever. The ledger table crm_quote_followup_tasks is unique on quote_id, and a row is claimed BEFORE the task is written, so two runs at once, or the daily
//    job run twice, make one task. A finished or deleted task is not made again: the ledger row stays. A revised quote is a new quote and gets its own task when it is sent.
//  - It writes a task, a ledger row and one audit row, nothing else. No email, no offer, no quote change, no label change. The task says it is only a reminder.
//  - Which quotes: sent, not accepted, not replaced by a revision, still new or contacted, on an open deal or on no deal, not a test address, sent N or more days ago
//    (N is the setting "A follow-up task is made for a sent quote after", default 5, on Hub Settings) and no more than LOOKBACK_DAYS ago. The look-back keeps the first
//    switch-on from filling the task list with months-old quotes: older ones stay on the Needs Attention page only.
//  - The task goes on the quote's deal, else on the buyer's contact. It is assigned to the deal's owner, else the buyer's owner, else nobody (shows in "mine or nobody").
//  - The task text holds the quote number and dates only, never a name or an address.
// `conn` is the pool in the app and any query-capable handle in tests. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters).
const { audit } = require('./audit');
const { tagTask } = require('./crm-task-fields');
const A = require('./crm-attention');

const SWITCH = 'crm_quote_followup_tasks';
const LOOKBACK_DAYS = 60;
// G13: a declined quote has been answered, so it gets no follow-up task. An install without the decline column yet runs without this test (see the retry below).
const DECLINED_TEST = 'q.declined_at IS NULL';

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}
const isDuplicate = (err) => err && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(String(err.message)));
function addDays(day, n) { return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10); }
const day10 = (v) => String(v || '').slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(`${day10(b)}T00:00:00Z`) - new Date(`${day10(a)}T00:00:00Z`)) / 86400000);

function taskText(q, today) {
  const label = q.quote_number ? `quote ${String(q.quote_number).slice(0, 40)}` : `quote #${q.id}`;
  return {
    title: `Follow up on ${label}`,
    details: `This ${label} went out on ${day10(q.quote_sent_at)} (${daysBetween(q.quote_sent_at, today)} days ago) and has not been accepted. Nothing has been offered or sent to them. This task is only a reminder to follow up.`,
    dueOn: today,
  };
}

// Where the task hangs and who gets it. Null when there is no deal and no contact to hang it on.
async function placeFor(conn, q) {
  let owner = q.owner_admin_id ? Number(q.owner_admin_id) : null;
  let contactId = q.contact_id ? Number(q.contact_id) : null;
  if (!contactId && q.email) {
    const [[c]] = await conn.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1', [q.email]);
    if (c) contactId = Number(c.id);
  }
  if (!owner && contactId) {
    const [[c]] = await conn.query('SELECT assigned_admin_id FROM newsletter_contacts WHERE id = ?', [contactId]);
    if (c && c.assigned_admin_id) owner = Number(c.assigned_admin_id);
  }
  if (owner) {
    const [[a]] = await conn.query('SELECT id FROM admin_users WHERE id = ?', [owner]);
    if (!a) owner = null; // an owner who no longer exists leaves it unassigned, never orphaned
  }
  if (q.opportunity_id) {
    const [[o]] = await conn.query('SELECT id, account_id FROM crm_opportunities WHERE id = ?', [q.opportunity_id]);
    if (o) return { cols: { opportunity_id: Number(o.id), account_id: Number(o.account_id), contact_id: null }, kind: 'opportunity', subjectId: Number(o.id), owner };
  }
  if (contactId) return { cols: { opportunity_id: null, account_id: null, contact_id: contactId }, kind: 'contact', subjectId: contactId, owner };
  return null;
}

// apply=false counts what it would make and writes nothing.
// Returns { available, days, eligible, made, wouldMake, alreadyMade, noPlace }.
async function createFollowUps(conn, { apply = false, now, today, days } = {}) {
  const out = { available: true, days: null, eligible: 0, made: 0, wouldMake: 0, alreadyMade: 0, noPlace: 0 };
  const n = Number.isInteger(days) ? days : (await A.loadThresholds(conn)).quoteFollowupDays;
  out.days = n;
  let ledger, quotes;
  try {
    const [rows] = await conn.query('SELECT quote_id FROM crm_quote_followup_tasks');
    ledger = new Set(rows.map(r => Number(r.quote_id)));
  } catch (err) {
    if (!isMissing(err)) throw err;
    return { ...out, available: false }; // alter-create-crm-quote-followups.js has not been run: nothing can be made safely
  }
  const run = (declinedOk) => conn.query(
    `SELECT q.id, q.quote_number, q.quote_sent_at, q.opportunity_id, q.contact_id, q.email, o.owner_admin_id
     FROM quote_requests q LEFT JOIN crm_opportunities o ON o.id = q.opportunity_id
     WHERE q.quote_sent_at IS NOT NULL AND q.accepted_at IS NULL AND ${declinedOk} AND q.version_status <> 'superseded' AND q.status IN ('new', 'contacted')
       AND q.quote_sent_at < ? AND q.quote_sent_at >= ? AND (o.id IS NULL OR o.state = 'open')
       AND LOWER(TRIM(q.email)) NOT LIKE '%@example.com' ORDER BY q.quote_sent_at, q.id`,
    [`${addDays(today, 1 - n)} 00:00:00`, `${addDays(today, -LOOKBACK_DAYS)} 00:00:00`]);
  try { [quotes] = await run(DECLINED_TEST); } catch (err) { if (!isMissing(err)) throw err; [quotes] = await run('1 = 1'); }
  for (const q of quotes) {
    out.eligible++;
    if (ledger.has(Number(q.id))) { out.alreadyMade++; continue; }
    if (!apply) { out.wouldMake++; continue; }
    // Claim first: whoever inserts the ledger row owns the one task. A duplicate means another run got there first.
    let claim;
    try {
      [claim] = await conn.query('INSERT INTO crm_quote_followup_tasks (quote_id, task_id, created_at) VALUES (?, NULL, ?)', [q.id, now]);
    } catch (err) {
      if (isDuplicate(err)) { ledger.add(Number(q.id)); out.alreadyMade++; continue; }
      throw err;
    }
    try {
      const place = await placeFor(conn, q);
      if (!place) {
        await conn.query('DELETE FROM crm_quote_followup_tasks WHERE id = ?', [claim.insertId]); // nothing to hang it on: leave no claim, so it can be made once a deal or contact exists
        out.noPlace++;
        continue;
      }
      const t = taskText(q, today);
      const [ins] = await conn.query(
        `INSERT INTO crm_tasks (opportunity_id, account_id, contact_id, title, details, due_on, state, assigned_admin_id, created_by_admin_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, ?)`,
        [place.cols.opportunity_id, place.cols.account_id, place.cols.contact_id, t.title.slice(0, 255), t.details.slice(0, 1000), t.dueOn, place.owner, now]);
      await conn.query('UPDATE crm_quote_followup_tasks SET task_id = ? WHERE id = ?', [ins.insertId, claim.insertId]);
      await tagTask(conn, ins.insertId, { source: 'daily_check', quoteId: q.opportunity_id ? Number(q.id) : null }); // the quote link needs a deal (a task on a contact has no quote field)
      ledger.add(Number(q.id));
      out.made++;
      await audit(conn, {
        actorType: 'system', action: 'crm_task_created', entityType: 'crm_task', entityId: ins.insertId,
        newValue: { generated: 'crm.quote.followup', quoteId: Number(q.id), subject: place.kind, subjectId: place.subjectId, assignedAdminId: place.owner, dueOn: t.dueOn },
        reason: 'A follow-up task made by the daily check for a quote that was sent and not accepted (nothing was offered or sent).',
      });
    } catch (err) {
      await conn.query('DELETE FROM crm_quote_followup_tasks WHERE id = ? AND task_id IS NULL', [claim.insertId]).catch(() => {}); // a failed write leaves no claim, so the next run tries again
      throw err;
    }
  }
  return out;
}

module.exports = { createFollowUps, SWITCH, LOOKBACK_DAYS, taskText };

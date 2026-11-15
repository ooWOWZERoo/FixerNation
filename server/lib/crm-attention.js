// Sales CRM "Needs Attention" (phase 3): rules that look at the data and say what a person should look at next. Every item is explainable (a sentence that says why it
// is on the list), links to the page that shows the evidence and holds the fix, and can be snoozed (hidden until a date) or dismissed (hidden until the thing it is
// about changes, for example a new due date). Nothing here writes to a contact, a deal, a quote or money: it only reads, and remembers snoozes in crm_attention_states.
//
// All functions take a database handle `conn` (the pool in the routes, a plain connection in the cron script) so the same code runs in both. SQL stays portable.
// `today` is a 'YYYY-MM-DD' day: the browser's own day when a person is looking, the server's UTC day in the cron job.

const STALE_STAGE_DAYS = 30;     // a deal that has sat in one stage this long...
const QUIET_DAYS = 14;           // ...and has had no note and no finished task for this long
const QUOTE_WINDOW_DAYS = 7;     // a sent quote that runs out within this many days and has not been accepted
const WON_GRACE_DAYS = 3;        // a Won deal with no purchase after this many days
const PER_RULE_LIMIT = 200;

const RULES = {
  next_step_overdue: { label: 'Next step is overdue', help: 'An open deal has a next step whose due date has passed.', subjectType: 'opportunity' },
  no_next_step: { label: 'No next step', help: 'An open deal that does not say what happens next.', subjectType: 'opportunity' },
  stale_deal: { label: 'Deal has gone quiet', help: `An open deal that has sat in one stage for ${STALE_STAGE_DAYS} days or more with no note and no finished task in the last ${QUIET_DAYS} days.`, subjectType: 'opportunity' },
  no_owner: { label: 'Nobody owns this deal', help: 'An open deal with no owner (for example, the owner’s account was removed).', subjectType: 'opportunity' },
  task_overdue: { label: 'Task is overdue', help: 'An open task whose due date has passed.', subjectType: 'task' },
  checklist_overdue: { label: 'Checklist step is overdue', help: 'A procurement step on an open deal whose due date has passed.', subjectType: 'checklist_item' },
  quote_expiring: { label: 'Quote runs out soon', help: `A quote that was sent, has not been accepted and is good for ${QUOTE_WINDOW_DAYS} more days or fewer.`, subjectType: 'quote' },
  won_no_purchase: { label: 'Won, but no purchase yet', help: `A deal closed as Won more than ${WON_GRACE_DAYS} days ago with no purchase linked to its quotes. The CRM never creates a purchase; it starts from the quote or the order.`, subjectType: 'opportunity' },
};

const SUBJECT_TYPES = ['opportunity', 'task', 'checklist_item', 'quote'];
const TEST_EMAIL = "LOWER(TRIM(q.email)) LIKE '%@example.com'";

function addDays(day, n) { return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10); }
function daysBetween(fromDate, today) {
  const a = new Date(`${String(fromDate).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${today}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}
const start = (day) => `${day} 00:00:00`;
const day10 = (v) => (v ? String(v).slice(0, 10) : '');
const quoted = (s) => `“${String(s).slice(0, 80)}”`;
const pageFor = { opportunity: 'admin-crm-opportunity.html?id=', account: 'admin-crm-account.html?id=', contact: 'admin-crm-contact.html?id=' };

function item(ruleKey, subjectId, o) {
  return Object.assign({
    ruleKey, ruleLabel: RULES[ruleKey].label, subjectType: RULES[ruleKey].subjectType, subjectId: Number(subjectId),
    fingerprint: '', title: '', why: '', link: '', ownerAdminId: null, ownerName: null, dealId: null,
  }, o);
}

// ---- The rules ---------------------------------------------------------------------------------------------------------------------

async function evaluate(conn, { today }) {
  const items = [];
  const dealFrom = `FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id JOIN crm_pipeline_stages s ON s.id = o.stage_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id`;
  const dealCols = 'o.id, o.name, o.next_step, o.next_step_due_at, o.stage_entered_at, o.stage_id, o.closed_at, o.owner_admin_id, a.name AS account_name, s.label AS stage_label, ow.username AS owner_name';
  const deal = (r) => ({ title: r.name, link: pageFor.opportunity + r.id, ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null, dealId: Number(r.id), context: r.account_name });

  let rows;
  [rows] = await conn.query(`SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND o.next_step_due_at IS NOT NULL AND o.next_step_due_at < ? ORDER BY o.next_step_due_at, o.id LIMIT ${PER_RULE_LIMIT}`, [start(today)]);
  for (const r of rows) items.push(item('next_step_overdue', r.id, { ...deal(r), fingerprint: day10(r.next_step_due_at), why: `${r.next_step ? `The next step, ${quoted(r.next_step)}, was` : 'The next step was'} due ${day10(r.next_step_due_at)}. Do it, or move the date.` }));

  [rows] = await conn.query(`SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND (o.next_step IS NULL OR o.next_step = '') ORDER BY o.stage_entered_at, o.id LIMIT ${PER_RULE_LIMIT}`);
  for (const r of rows) items.push(item('no_next_step', r.id, { ...deal(r), fingerprint: String(r.stage_id), why: `This deal is in ${r.stage_label} and does not say what happens next. Add a next step.` }));

  [rows] = await conn.query(
    `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND o.stage_entered_at < ?
       AND NOT EXISTS (SELECT 1 FROM crm_notes n WHERE n.opportunity_id = o.id AND n.created_at >= ?)
       AND NOT EXISTS (SELECT 1 FROM crm_tasks t WHERE t.opportunity_id = o.id AND t.completed_at >= ?)
     ORDER BY o.stage_entered_at, o.id LIMIT ${PER_RULE_LIMIT}`,
    [start(addDays(today, -STALE_STAGE_DAYS)), start(addDays(today, -QUIET_DAYS)), start(addDays(today, -QUIET_DAYS))]);
  for (const r of rows) items.push(item('stale_deal', r.id, { ...deal(r), fingerprint: day10(r.stage_entered_at), why: `In ${r.stage_label} for ${daysBetween(r.stage_entered_at, today)} days, and nobody has logged a note or finished a task in the last ${QUIET_DAYS} days. Write down where it stands.` }));

  [rows] = await conn.query(`SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND o.owner_admin_id IS NULL ORDER BY o.id LIMIT ${PER_RULE_LIMIT}`);
  for (const r of rows) items.push(item('no_owner', r.id, { ...deal(r), fingerprint: '', why: 'Nobody owns this deal, so nobody is following it up. Pick an owner.' }));

  [rows] = await conn.query(
    `SELECT t.id, t.title, t.due_on, t.assigned_admin_id, t.opportunity_id, t.account_id, t.contact_id, au.username AS assignee_name,
            so.name AS deal_name, sa.name AS account_name, sc.name AS contact_name, sc.email AS contact_email
     FROM crm_tasks t LEFT JOIN admin_users au ON au.id = t.assigned_admin_id
       LEFT JOIN crm_opportunities so ON so.id = t.opportunity_id LEFT JOIN crm_accounts sa ON sa.id = t.account_id LEFT JOIN newsletter_contacts sc ON sc.id = t.contact_id
     WHERE t.state = 'open' AND t.due_on IS NOT NULL AND t.due_on < ? ORDER BY t.due_on, t.id LIMIT ${PER_RULE_LIMIT}`, [today]);
  for (const r of rows) {
    const where = r.opportunity_id ? { link: pageFor.opportunity + r.opportunity_id, context: r.deal_name, dealId: Number(r.opportunity_id) }
      : r.contact_id ? { link: pageFor.contact + r.contact_id, context: r.contact_name || r.contact_email }
      : { link: pageFor.account + r.account_id, context: r.account_name };
    items.push(item('task_overdue', r.id, { ...where, title: r.title, ownerAdminId: r.assigned_admin_id || null, ownerName: r.assignee_name || null, fingerprint: day10(r.due_on),
      why: `This task was due ${day10(r.due_on)} and is still open${r.assignee_name ? ` (assigned to ${r.assignee_name})` : ' (assigned to nobody)'}.` }));
  }

  [rows] = await conn.query(
    `SELECT i.id, i.label, i.due_on, o.id AS deal_id, o.name AS deal_name, o.owner_admin_id, a.name AS account_name, ow.username AS owner_name
     FROM crm_opportunity_checklist_items i JOIN crm_opportunities o ON o.id = i.opportunity_id JOIN crm_accounts a ON a.id = o.account_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     WHERE i.status = 'open' AND i.due_on IS NOT NULL AND i.due_on < ? AND o.state = 'open' ORDER BY i.due_on, i.id LIMIT ${PER_RULE_LIMIT}`, [today]);
  for (const r of rows) items.push(item('checklist_overdue', r.id, { title: r.label, context: `${r.deal_name} · ${r.account_name}`, link: pageFor.opportunity + r.deal_id, ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null,
    dealId: Number(r.deal_id), fingerprint: day10(r.due_on), why: `This procurement step was due ${day10(r.due_on)} and is not done.` }));

  [rows] = await conn.query(
    `SELECT q.id, q.quote_number, q.quote_valid_until, q.opportunity_id, o.name AS deal_name, o.owner_admin_id, ow.username AS owner_name
     FROM quote_requests q LEFT JOIN crm_opportunities o ON o.id = q.opportunity_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     WHERE q.quote_sent_at IS NOT NULL AND q.accepted_at IS NULL AND q.version_status <> 'superseded' AND q.status IN ('new', 'contacted') AND q.quote_valid_until IS NOT NULL
       AND q.quote_valid_until >= ? AND q.quote_valid_until <= ? AND NOT (${TEST_EMAIL}) ORDER BY q.quote_valid_until, q.id LIMIT ${PER_RULE_LIMIT}`, [today, addDays(today, QUOTE_WINDOW_DAYS)]);
  for (const r of rows) items.push(item('quote_expiring', r.id, { title: r.quote_number ? `Quote ${r.quote_number}` : `Quote #${r.id}`, context: r.deal_name || 'No deal yet',
    link: r.opportunity_id ? pageFor.opportunity + r.opportunity_id : 'admin-quotes.html', ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null, dealId: r.opportunity_id ? Number(r.opportunity_id) : null,
    fingerprint: day10(r.quote_valid_until), why: `This quote was sent and has not been accepted. It is good until ${day10(r.quote_valid_until)}. Follow up before it runs out.` }));

  [rows] = await conn.query(
    `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'won' AND o.closed_at IS NOT NULL AND o.closed_at < ?
       AND NOT EXISTS (SELECT 1 FROM purchases p JOIN quote_requests q ON q.id = p.quote_id WHERE q.opportunity_id = o.id)
     ORDER BY o.closed_at, o.id LIMIT ${PER_RULE_LIMIT}`, [start(addDays(today, -WON_GRACE_DAYS))]);
  for (const r of rows) items.push(item('won_no_purchase', r.id, { ...deal(r), fingerprint: day10(r.closed_at), why: `Closed as Won on ${day10(r.closed_at)}, but no purchase is linked to this deal’s quotes. Check the quote and the order.` }));

  return items;
}

// ---- Snooze and dismiss -----------------------------------------------------------------------------------------------------------

const keyOf = (ruleKey, subjectType, subjectId) => `${ruleKey}|${subjectType}|${Number(subjectId)}`;

// Adds `status` ('active' | 'snoozed' | 'dismissed') and the snooze details to each item. A snooze that has run out, or a dismissal whose fingerprint no longer matches
// (the thing it was about changed), counts as active again.
async function withStates(conn, items, { now }) {
  const [rows] = await conn.query('SELECT s.*, u.username AS admin_name FROM crm_attention_states s LEFT JOIN admin_users u ON u.id = s.admin_id');
  const map = new Map(rows.map(r => [keyOf(r.rule_key, r.subject_type, r.subject_id), r]));
  return items.map(it => {
    const s = map.get(keyOf(it.ruleKey, it.subjectType, it.subjectId));
    let status = 'active';
    let snoozeUntil = null;
    let by = null;
    let reason = null;
    if (s && s.state === 'snoozed' && s.snooze_until && String(s.snooze_until) > now) { status = 'snoozed'; snoozeUntil = s.snooze_until; }
    if (s && s.state === 'dismissed' && String(s.fingerprint || '') === String(it.fingerprint || '')) status = 'dismissed';
    if (status !== 'active') { by = s.admin_name || null; reason = s.reason || null; }
    return { ...it, status, snoozeUntil, stateBy: by, stateReason: reason };
  });
}

// Records (or replaces) the one state row for an item. Portable upsert: look, then update or insert.
async function setState(conn, it, { state, until, adminId, reason, now }) {
  const fields = [state, state === 'snoozed' ? until : null, it.fingerprint || '', reason || null, adminId || null];
  const [existing] = await conn.query('SELECT id FROM crm_attention_states WHERE rule_key = ? AND subject_type = ? AND subject_id = ?', [it.ruleKey, it.subjectType, it.subjectId]);
  if (existing[0]) {
    await conn.query('UPDATE crm_attention_states SET state = ?, snooze_until = ?, fingerprint = ?, reason = ?, admin_id = ?, updated_at = ? WHERE id = ?', [...fields, now, existing[0].id]);
  } else {
    await conn.query('INSERT INTO crm_attention_states (rule_key, subject_type, subject_id, state, snooze_until, fingerprint, reason, admin_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [it.ruleKey, it.subjectType, it.subjectId, ...fields, now, now]);
  }
}
async function clearState(conn, it) {
  await conn.query('DELETE FROM crm_attention_states WHERE rule_key = ? AND subject_type = ? AND subject_id = ?', [it.ruleKey, it.subjectType, it.subjectId]);
}

// ---- What the daily job has already seen --------------------------------------------------------------------------------------------

// Writes a "first seen" row for every active item that has none yet (same rule, subject and fingerprint) and returns the ones it just wrote. Running it again
// straight away writes nothing and returns nothing: that is what makes the daily job safe to run twice.
async function recordFirstSeen(conn, activeItems, { now, dryRun = false }) {
  const [rows] = await conn.query('SELECT rule_key, subject_type, subject_id, fingerprint FROM crm_attention_events');
  const seen = new Set(rows.map(r => `${keyOf(r.rule_key, r.subject_type, r.subject_id)}|${r.fingerprint || ''}`));
  const fresh = [];
  for (const it of activeItems) {
    const k = `${keyOf(it.ruleKey, it.subjectType, it.subjectId)}|${it.fingerprint || ''}`;
    if (seen.has(k)) continue;
    if (dryRun) { seen.add(k); fresh.push(it); continue; }
    try {
      await conn.query('INSERT INTO crm_attention_events (rule_key, subject_type, subject_id, fingerprint, owner_admin_id, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
        [it.ruleKey, it.subjectType, it.subjectId, it.fingerprint || '', it.ownerAdminId, now]);
      seen.add(k);
      fresh.push(it);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err; // another run got there first: not new for us
    }
  }
  return fresh;
}

function countsByRule(items) {
  const out = {};
  for (const k of Object.keys(RULES)) out[k] = 0;
  for (const it of items) out[it.ruleKey]++;
  return out;
}

// The daily job, as one function so the cron script and the tests run the very same code. apply=false changes nothing. sendDigest(adminEmail, items) is given by the
// caller only when the owner digest is switched on (setting crm_attention_email); it is awaited once per owner, and an item is marked emailed only after it returns.
async function runDaily(conn, { apply, now, sendDigest }) {
  const today = now.slice(0, 10);
  const all = await withStates(conn, await evaluate(conn, { today }), { now });
  const active = all.filter(i => i.status === 'active');
  const fresh = await recordFirstSeen(conn, active, { now, dryRun: !apply });
  let digests = 0;
  if (apply && sendDigest && fresh.length) {
    const owners = new Map();
    for (const it of fresh) if (it.ownerAdminId) { if (!owners.has(it.ownerAdminId)) owners.set(it.ownerAdminId, []); owners.get(it.ownerAdminId).push(it); }
    for (const [adminId, list] of owners) {
      const [[admin]] = await conn.query('SELECT email FROM admin_users WHERE id = ?', [adminId]);
      if (!admin || !admin.email) continue;
      try { await sendDigest(admin.email, list); } catch (err) { console.error(`Digest not sent to one owner: ${err.message}`); continue; }
      for (const it of list) await conn.query('UPDATE crm_attention_events SET emailed_at = ? WHERE rule_key = ? AND subject_type = ? AND subject_id = ? AND fingerprint = ?', [now, it.ruleKey, it.subjectType, it.subjectId, it.fingerprint || '']);
      digests++;
    }
  }
  return { total: all.length, active: active.length, held: all.length - active.length, fresh: fresh.length, byRule: countsByRule(active), digests };
}

module.exports = {
  runDaily,
  RULES, SUBJECT_TYPES, STALE_STAGE_DAYS, QUIET_DAYS, QUOTE_WINDOW_DAYS, WON_GRACE_DAYS,
  evaluate, withStates, setState, clearState, recordFirstSeen, countsByRule, addDays,
};

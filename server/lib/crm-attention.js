// Sales CRM "Needs Attention" (phase 3): rules that look at the data and say what a person should look at next. Every item is explainable (a sentence that says why it
// is on the list), links to the page that shows the evidence and holds the fix, and can be snoozed (hidden until a date) or dismissed (hidden until the thing it is
// about changes, for example a new due date). Nothing here writes to a contact, a deal, a quote or money: it only reads, and remembers snoozes in crm_attention_states.
//
// All functions take a database handle `conn` (the pool in the routes, a plain connection in the cron script) so the same code runs in both. SQL stays portable.
// `today` is a 'YYYY-MM-DD' day: the browser's own day when a person is looking, the server's UTC day in the cron job.

// G2: every threshold is a setting a CRM Admin can change (Hub Settings > Needs Attention), with these defaults, limits and wording. A stored value that is missing, not a whole
// number or out of range falls back to the default, so a bad value can never switch a rule off or flood the list. `unit` is for the page.
const THRESHOLDS = {
  staleStageDays:      { setting: 'crm_attn_stale_stage_days', def: 30, min: 7, max: 365, unit: 'days', label: 'A deal has gone quiet after', help: 'Days a deal can sit in one stage before it counts as quiet (with no recent note or finished task).' },
  quietDays:           { setting: 'crm_attn_quiet_days', def: 14, min: 3, max: 180, unit: 'days', label: '...and nobody has written a note or finished a task for', help: 'A note or a finished task within this many days keeps a deal off the "gone quiet" list.' },
  quoteWindowDays:     { setting: 'crm_attn_quote_window_days', def: 7, min: 1, max: 60, unit: 'days', label: 'A quote runs out soon when it ends within', help: 'Days before a sent quote\u2019s "good until" date that it is listed.' },
  quoteUnansweredDays: { setting: 'crm_attn_quote_unanswered_days', def: 14, min: 3, max: 120, unit: 'days', label: 'A quote is unanswered after', help: 'Days since a quote was sent with no acceptance. This says nothing about whether they opened it.' },
  closeGraceDays:      { setting: 'crm_attn_close_grace_days', def: 0, min: 0, max: 60, unit: 'days', label: 'An expected close date has passed when it is over by', help: 'Days past the expected close date before the deal is listed. 0 lists it the next day.' },
  wonGraceDays:        { setting: 'crm_attn_won_grace_days', def: 3, min: 0, max: 60, unit: 'days', label: 'A Won deal needs a purchase within', help: 'Days after a deal is closed Won before "no purchase yet" is listed.' },
  poWaitDays:          { setting: 'crm_attn_po_wait_days', def: 14, min: 3, max: 180, unit: 'days', label: 'A purchase order is overdue after', help: 'Days since a quote was accepted by purchase order with no PO received date on its invoice.' },
  trialEndingDays:     { setting: 'crm_attn_trial_ending_days', def: 5, min: 1, max: 60, unit: 'days', label: 'A trial is ending when it ends within', help: 'Days before a trial\u2019s end date that it is listed.' },
  trialStalledDays:    { setting: 'crm_attn_trial_stalled_days', def: 7, min: 1, max: 60, unit: 'days', label: 'A trial has stalled when no teacher has registered after', help: 'Days since a trial started with none of its seats registered. Seats are counted, never named. A trial with no seat records is left out, because nothing says whether anyone started.' },
  trialUsePercent:     { setting: 'crm_attn_trial_use_percent', def: 60, min: 10, max: 100, unit: 'percent', label: 'A trial is well used when this share of seats is registered', help: 'Percent of a multi-seat trial\u2019s seats that teachers have registered. Seats are counted, never named.' },
};
const THRESHOLD_DEFAULTS = Object.fromEntries(Object.entries(THRESHOLDS).map(([k, v]) => [k, v.def]));
const PER_RULE_LIMIT = 200;

// The thresholds in force now: stored settings, each checked, else its default.
async function loadThresholds(conn) {
  const out = { ...THRESHOLD_DEFAULTS };
  let rows = [];
  try { [rows] = await conn.query("SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'crm!_attn!_%' ESCAPE '!'"); } catch { return out; }
  const byKey = new Map(rows.map(r => [r.setting_key, r.setting_value]));
  for (const [k, d] of Object.entries(THRESHOLDS)) {
    const raw = byKey.get(d.setting);
    if (raw === undefined || raw === null || !/^\d{1,4}$/.test(String(raw).trim())) continue;
    const n = Number(raw);
    if (n >= d.min && n <= d.max) out[k] = n;
  }
  return out;
}

// What each rule means, in words that carry the thresholds in force.
const HELP = {
  next_step_overdue: () => 'An open deal has a next step whose due date has passed.',
  no_next_step: () => 'An open deal that does not say what happens next.',
  stale_deal: (t) => `An open deal that has sat in one stage for ${t.staleStageDays} days or more with no note and no finished task in the last ${t.quietDays} days.`,
  no_owner: () => 'An open deal with no owner (for example, the owner\u2019s account was removed).',
  task_overdue: () => 'An open task whose due date has passed.',
  checklist_overdue: () => 'A procurement step on an open deal whose due date has passed.',
  quote_expiring: (t) => `A quote that was sent, has not been accepted and is good for ${t.quoteWindowDays} more days or fewer.`,
  won_no_purchase: (t) => `A deal with a quote that was closed as Won more than ${t.wonGraceDays} days ago, and none of its quotes has a purchase. Deals with no quote at all (a phone deal, a renewal the system opened) are not listed, because there is nothing to link a purchase to. The CRM never creates a purchase; it starts from the quote or the order.`,
  quote_unanswered: (t) => `A quote that was sent ${t.quoteUnansweredDays} or more days ago and has not been accepted or replaced, on an open deal or on no deal. It does not say whether the buyer opened it.`,
  close_date_passed: (t) => `An open deal whose expected close date is ${t.closeGraceDays ? `${t.closeGraceDays} or more days ` : ''}in the past. Move the date or move the deal.`,
  po_not_received: (t) => `A quote accepted by purchase order ${t.poWaitDays} or more days ago whose invoice still has no PO received date.`,
  trial_ending: (t) => `A trial that ends within ${t.trialEndingDays} days. A good time to ask how it went and offer a quote.`,
  trial_stalled: (t) => `A live trial that started ${t.trialStalledDays} or more days ago and has seat records, but not one seat is registered yet. A trial with no seat records is not listed: the system cannot tell whether anyone started.`,
  trial_high_use: (t) => `A trial with two or more seats where ${t.trialUsePercent}% or more of the seats are registered. Only counts of seats are used, never names.`,
};
const helpFor = (key, t = THRESHOLD_DEFAULTS) => HELP[key](t);

const RULES = {
  next_step_overdue: { label: 'Next step is overdue', subjectType: 'opportunity' },
  no_next_step: { label: 'No next step', subjectType: 'opportunity' },
  stale_deal: { label: 'Deal has gone quiet', subjectType: 'opportunity' },
  no_owner: { label: 'Nobody owns this deal', subjectType: 'opportunity' },
  task_overdue: { label: 'Task is overdue', subjectType: 'task' },
  checklist_overdue: { label: 'Checklist step is overdue', subjectType: 'checklist_item' },
  quote_expiring: { label: 'Quote runs out soon', subjectType: 'quote' },
  won_no_purchase: { label: 'Won, but no purchase yet', subjectType: 'opportunity' },
  quote_unanswered: { label: 'Quote has had no answer', subjectType: 'quote' },
  close_date_passed: { label: 'Expected close date has passed', subjectType: 'opportunity' },
  po_not_received: { label: 'Purchase order not received', subjectType: 'purchase' },
  trial_ending: { label: 'Trial is ending', subjectType: 'purchase' },
  trial_stalled: { label: 'Trial has not got going', subjectType: 'purchase' },
  trial_high_use: { label: 'Trial is being well used', subjectType: 'purchase' },
};
// Each rule's `help` (at the default thresholds, for anything that reads RULES directly); helpFor() gives the wording for the thresholds in force.
for (const k of Object.keys(RULES)) RULES[k].help = HELP[k](THRESHOLD_DEFAULTS);

const SUBJECT_TYPES = ['opportunity', 'task', 'checklist_item', 'quote', 'purchase'];
const TEST_EMAIL = "LOWER(TRIM(q.email)) LIKE '%@example.com'";

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}
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

// Punch list B12: each rule reads at most PER_RULE_LIMIT rows. When a rule has more than that, the true number is written into `caps[ruleKey]` (if the caller gave one)
// so the page can say "showing the first 200 of N" instead of presenting a cut-off list as the whole list. Handling the oldest items brings the rest into view.
async function evaluate(conn, { today, caps = {}, thresholds = null }) {
  const items = [];
  const t = thresholds || await loadThresholds(conn);
  async function capped(ruleKey, sql, params = []) {
    const [got] = await conn.query(`${sql} LIMIT ${PER_RULE_LIMIT}`, params);
    if (got.length >= PER_RULE_LIMIT) {
      const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM (${sql}) capped_rows`, params);
      if (Number(c.n) > got.length) caps[ruleKey] = Number(c.n);
    }
    return got;
  }
  const dealFrom = `FROM crm_opportunities o JOIN crm_accounts a ON a.id = o.account_id JOIN crm_pipeline_stages s ON s.id = o.stage_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id`;
  const dealCols = 'o.id, o.name, o.next_step, o.next_step_due_at, o.stage_entered_at, o.stage_id, o.closed_at, o.owner_admin_id, a.name AS account_name, s.label AS stage_label, ow.username AS owner_name';
  const deal = (r) => ({ title: r.name, link: pageFor.opportunity + r.id, ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null, dealId: Number(r.id), context: r.account_name });

  let rows;
  rows = await capped('next_step_overdue', `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND o.next_step_due_at IS NOT NULL AND o.next_step_due_at < ? ORDER BY o.next_step_due_at, o.id`, [start(today)]);
  for (const r of rows) items.push(item('next_step_overdue', r.id, { ...deal(r), fingerprint: day10(r.next_step_due_at), why: `${r.next_step ? `The next step, ${quoted(r.next_step)}, was` : 'The next step was'} due ${day10(r.next_step_due_at)}. Do it, or move the date.` }));

  rows = await capped('no_next_step', `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND (o.next_step IS NULL OR o.next_step = '') ORDER BY o.stage_entered_at, o.id`);
  for (const r of rows) items.push(item('no_next_step', r.id, { ...deal(r), fingerprint: String(r.stage_id), why: `This deal is in ${r.stage_label} and does not say what happens next. Add a next step.` }));

  rows = await capped('stale_deal', 
    `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND o.stage_entered_at < ?
       AND NOT EXISTS (SELECT 1 FROM crm_notes n WHERE n.opportunity_id = o.id AND n.created_at >= ?)
       AND NOT EXISTS (SELECT 1 FROM crm_tasks t WHERE t.opportunity_id = o.id AND t.completed_at >= ?)
     ORDER BY o.stage_entered_at, o.id`,
    [start(addDays(today, -t.staleStageDays)), start(addDays(today, -t.quietDays)), start(addDays(today, -t.quietDays))]);
  for (const r of rows) items.push(item('stale_deal', r.id, { ...deal(r), fingerprint: day10(r.stage_entered_at), why: `In ${r.stage_label} for ${daysBetween(r.stage_entered_at, today)} days, and nobody has logged a note or finished a task in the last ${t.quietDays} days. Write down where it stands.` }));

  rows = await capped('no_owner', `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'open' AND o.owner_admin_id IS NULL ORDER BY o.id`);
  for (const r of rows) items.push(item('no_owner', r.id, { ...deal(r), fingerprint: '', why: 'Nobody owns this deal, so nobody is following it up. Pick an owner.' }));

  rows = await capped('task_overdue', 
    `SELECT t.id, t.title, t.due_on, t.assigned_admin_id, t.opportunity_id, t.account_id, t.contact_id, au.username AS assignee_name,
            so.name AS deal_name, sa.name AS account_name, sc.name AS contact_name, sc.email AS contact_email
     FROM crm_tasks t LEFT JOIN admin_users au ON au.id = t.assigned_admin_id
       LEFT JOIN crm_opportunities so ON so.id = t.opportunity_id LEFT JOIN crm_accounts sa ON sa.id = t.account_id LEFT JOIN newsletter_contacts sc ON sc.id = t.contact_id
     WHERE t.state = 'open' AND t.due_on IS NOT NULL AND t.due_on < ? ORDER BY t.due_on, t.id`, [today]);
  for (const r of rows) {
    const where = r.opportunity_id ? { link: pageFor.opportunity + r.opportunity_id, context: r.deal_name, dealId: Number(r.opportunity_id) }
      : r.contact_id ? { link: pageFor.contact + r.contact_id, context: r.contact_name || r.contact_email }
      : { link: pageFor.account + r.account_id, context: r.account_name };
    items.push(item('task_overdue', r.id, { ...where, title: r.title, ownerAdminId: r.assigned_admin_id || null, ownerName: r.assignee_name || null, fingerprint: day10(r.due_on),
      why: `This task was due ${day10(r.due_on)} and is still open${r.assignee_name ? ` (assigned to ${r.assignee_name})` : ' (assigned to nobody)'}.` }));
  }

  rows = await capped('checklist_overdue', 
    `SELECT i.id, i.label, i.due_on, o.id AS deal_id, o.name AS deal_name, o.owner_admin_id, a.name AS account_name, ow.username AS owner_name
     FROM crm_opportunity_checklist_items i JOIN crm_opportunities o ON o.id = i.opportunity_id JOIN crm_accounts a ON a.id = o.account_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     WHERE i.status = 'open' AND i.due_on IS NOT NULL AND i.due_on < ? AND o.state = 'open' ORDER BY i.due_on, i.id`, [today]);
  for (const r of rows) items.push(item('checklist_overdue', r.id, { title: r.label, context: `${r.deal_name} · ${r.account_name}`, link: pageFor.opportunity + r.deal_id, ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null,
    dealId: Number(r.deal_id), fingerprint: day10(r.due_on), why: `This procurement step was due ${day10(r.due_on)} and is not done.` }));

  rows = await capped('quote_expiring', 
    `SELECT q.id, q.quote_number, q.quote_valid_until, q.opportunity_id, o.name AS deal_name, o.owner_admin_id, ow.username AS owner_name
     FROM quote_requests q LEFT JOIN crm_opportunities o ON o.id = q.opportunity_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
     WHERE q.quote_sent_at IS NOT NULL AND q.accepted_at IS NULL AND q.version_status <> 'superseded' AND q.status IN ('new', 'contacted') AND q.quote_valid_until IS NOT NULL
       AND q.quote_valid_until >= ? AND q.quote_valid_until <= ? AND NOT (${TEST_EMAIL}) ORDER BY q.quote_valid_until, q.id`, [today, addDays(today, t.quoteWindowDays)]);
  for (const r of rows) items.push(item('quote_expiring', r.id, { title: r.quote_number ? `Quote ${r.quote_number}` : `Quote #${r.id}`, context: r.deal_name || 'No deal yet',
    link: r.opportunity_id ? pageFor.opportunity + r.opportunity_id : 'admin-quotes.html', ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null, dealId: r.opportunity_id ? Number(r.opportunity_id) : null,
    fingerprint: day10(r.quote_valid_until), why: `This quote was sent and has not been accepted. It is good until ${day10(r.quote_valid_until)}. Follow up before it runs out.` }));

  rows = await capped('won_no_purchase', 
    `SELECT ${dealCols} ${dealFrom} WHERE o.state = 'won' AND o.closed_at IS NOT NULL AND o.closed_at < ?
       AND EXISTS (SELECT 1 FROM quote_requests wq WHERE wq.opportunity_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM purchases p JOIN quote_requests q ON q.id = p.quote_id WHERE q.opportunity_id = o.id)
     ORDER BY o.closed_at, o.id`, [start(addDays(today, -t.wonGraceDays))]);
  for (const r of rows) items.push(item('won_no_purchase', r.id, { ...deal(r), fingerprint: day10(r.closed_at), why: `Closed as Won on ${day10(r.closed_at)}, but no purchase is linked to this deal’s quotes. Check the quote and the order.` }));

  // ---- G2: the rules the spec lists that the first build lacked -------------------------------------------------------------------
  // None of these writes anything, none says a quote was "viewed", and the trial rules count seats and never name a person. A database that lacks a table or column one of
  // them reads (an older install, a test database) simply raises nothing for that rule.
  const optional = async (fn) => { try { await fn(); } catch (err) { if (!isMissing(err)) throw err; } };

  await optional(async () => {
    rows = await capped('quote_unanswered',
      `SELECT q.id, q.quote_number, q.quote_sent_at, q.opportunity_id, o.name AS deal_name, o.owner_admin_id, ow.username AS owner_name
       FROM quote_requests q LEFT JOIN crm_opportunities o ON o.id = q.opportunity_id LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id
       WHERE q.quote_sent_at IS NOT NULL AND q.accepted_at IS NULL AND q.version_status <> 'superseded' AND q.status IN ('new', 'contacted') AND q.quote_sent_at < ?
         AND (o.id IS NULL OR o.state = 'open') AND NOT (${TEST_EMAIL}) ORDER BY q.quote_sent_at, q.id`, [start(addDays(today, -t.quoteUnansweredDays))]);
    for (const r of rows) items.push(item('quote_unanswered', r.id, { title: r.quote_number ? `Quote ${r.quote_number}` : `Quote #${r.id}`, context: r.deal_name || 'No deal yet',
      link: r.opportunity_id ? pageFor.opportunity + r.opportunity_id : 'admin-quotes.html', ownerAdminId: r.owner_admin_id || null, ownerName: r.owner_name || null, dealId: r.opportunity_id ? Number(r.opportunity_id) : null,
      fingerprint: day10(r.quote_sent_at), why: `This quote was sent on ${day10(r.quote_sent_at)} (${daysBetween(r.quote_sent_at, today)} days ago) and has not been accepted. Follow up, or send a revised quote.` }));
  });

  await optional(async () => {
    rows = await capped('close_date_passed',
      `SELECT ${dealCols}, o.expected_close_date ${dealFrom} WHERE o.state = 'open' AND o.expected_close_date IS NOT NULL AND o.expected_close_date < ? ORDER BY o.expected_close_date, o.id`,
      [addDays(today, -t.closeGraceDays)]);
    for (const r of rows) items.push(item('close_date_passed', r.id, { ...deal(r), fingerprint: day10(r.expected_close_date),
      why: `The expected close date was ${day10(r.expected_close_date)} (${daysBetween(r.expected_close_date, today)} days ago) and the deal is still open. Set a new date, or close the deal.` }));
  });

  // A purchase that belongs to a deal (through its quote) is the deal owner's; otherwise the buyer's contact owner. Staff test addresses are left out.
  const buyerOwner = 'COALESCE(o.owner_admin_id, c.assigned_admin_id)';
  const purchaseFrom = `FROM purchases p JOIN newsletter_contacts c ON c.id = p.contact_id LEFT JOIN quote_requests pq ON pq.id = p.quote_id LEFT JOIN crm_opportunities o ON o.id = pq.opportunity_id
       LEFT JOIN admin_users ow ON ow.id = ${buyerOwner}`;
  const purchaseItem = (ruleKey, r, extra) => item(ruleKey, r.id, { context: r.school_domain || r.contact_name || 'A purchase', ownerAdminId: r[`owner_id`] || null, ownerName: r.owner_name || null,
    dealId: r.deal_id ? Number(r.deal_id) : null, contactId: r.contact_id ? Number(r.contact_id) : null,
    link: r.deal_id ? pageFor.opportunity + r.deal_id : pageFor.contact + r.contact_id, ...extra });
  const NOT_TEST = "LOWER(TRIM(c.email)) NOT LIKE '%@example.com'";

  await optional(async () => {
    rows = await capped('po_not_received',
      `SELECT p.id, p.po_number, p.school_domain, p.purchased_at, p.contact_id, c.name AS contact_name, o.id AS deal_id, ${buyerOwner} AS owner_id, ow.username AS owner_name
       ${purchaseFrom} JOIN invoices i ON i.id = p.invoice_id
       WHERE p.payment_method = 'po' AND p.payment_status = 'pending' AND i.po_received_date IS NULL AND COALESCE(i.status, 'unpaid') <> 'paid'
         AND p.purchased_at < ? AND ${NOT_TEST} ORDER BY p.purchased_at, p.id`, [start(addDays(today, -t.poWaitDays))]);
    for (const r of rows) items.push(purchaseItem('po_not_received', r, { title: r.po_number ? `PO ${String(r.po_number).slice(0, 60)}` : 'Purchase order', fingerprint: day10(r.purchased_at),
      why: `This quote was accepted by purchase order on ${day10(r.purchased_at)} (${daysBetween(r.purchased_at, today)} days ago) and the invoice has no PO received date yet. Ask for the PO, or mark it received when it arrives.` }));
  });

  const trialWhere = `p.trial_expiration_date IS NOT NULL AND p.trial_expiration_date >= ? AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended') AND ${NOT_TEST}`;
  await optional(async () => {
    rows = await capped('trial_ending',
      `SELECT p.id, p.school_domain, p.trial_expiration_date, p.contact_id, c.name AS contact_name, o.id AS deal_id, ${buyerOwner} AS owner_id, ow.username AS owner_name
       ${purchaseFrom} WHERE ${trialWhere} AND p.trial_expiration_date <= ? ORDER BY p.trial_expiration_date, p.id`, [start(today), `${addDays(today, t.trialEndingDays)} 23:59:59`]);
    for (const r of rows) items.push(purchaseItem('trial_ending', r, { title: 'Trial ending', fingerprint: day10(r.trial_expiration_date),
      why: `This trial ends on ${day10(r.trial_expiration_date)} (${daysBetween(today, day10(r.trial_expiration_date))} days from now). Ask how it went and offer a quote while they are still using it.` }));
  });

  // G3: a live trial that started a while ago where, as far as the seat records show, nobody has registered. Needs seat records to say so: a trial with none is unknown, not stalled.
  await optional(async () => {
    rows = await capped('trial_stalled',
      `SELECT p.id, p.school_domain, p.purchased_at, p.trial_expiration_date, p.contact_id, c.name AS contact_name, o.id AS deal_id, ${buyerOwner} AS owner_id, ow.username AS owner_name
       ${purchaseFrom} WHERE ${trialWhere} AND p.purchased_at < ?
         AND EXISTS (SELECT 1 FROM license_seats s WHERE s.purchase_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM license_seats s WHERE s.purchase_id = p.id AND s.status = 'registered') ORDER BY p.purchased_at, p.id`,
      [start(today), start(addDays(today, 1 - t.trialStalledDays))]);
    for (const r of rows) items.push(purchaseItem('trial_stalled', r, { title: 'Trial has not got going', fingerprint: day10(r.purchased_at),
      why: `This trial started ${daysBetween(r.purchased_at, today)} days ago and no teacher has registered a seat yet. Check that the invitations arrived, and offer to help them get started.` }));
  });

  await optional(async () => {
    rows = await capped('trial_high_use',
      `SELECT p.id, p.school_domain, p.trial_expiration_date, p.seat_count, p.contact_id, c.name AS contact_name, o.id AS deal_id, ${buyerOwner} AS owner_id, ow.username AS owner_name,
         (SELECT COUNT(*) FROM license_seats s WHERE s.purchase_id = p.id AND s.status = 'registered') AS registered
       ${purchaseFrom} WHERE ${trialWhere} AND p.seat_count >= 2
         AND (SELECT COUNT(*) FROM license_seats s WHERE s.purchase_id = p.id AND s.status = 'registered') * 100 >= p.seat_count * ? ORDER BY p.trial_expiration_date, p.id`, [start(today), t.trialUsePercent]);
    for (const r of rows) items.push(purchaseItem('trial_high_use', r, { title: 'Trial in good use', fingerprint: day10(r.trial_expiration_date),
      why: `${Number(r.registered)} of this trial's ${Number(r.seat_count)} seats are registered (${t.trialUsePercent}% is the line). Teachers are using it: a good moment to talk about a quote.` }));
  });

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
// G3: `trialTasks` is true only when the owner has switched the trial review tasks on (setting crm_trial_review_tasks). Without it, or without --apply, the job only COUNTS
// the tasks it would make (the dry run the owner reads first). Snoozed or dismissed items are left alone, so only active items can become a task.
async function runDaily(conn, { apply, now, sendDigest, trialTasks = false }) {
  const today = now.slice(0, 10);
  const all = await withStates(conn, await evaluate(conn, { today }), { now });
  const active = all.filter(i => i.status === 'active');
  const fresh = await recordFirstSeen(conn, active, { now, dryRun: !apply });
  const trial = await require('./crm-trial-tasks').createReviewTasks(conn, active, { apply: !!(apply && trialTasks), now, today });
  let digests = 0;
  if (apply && sendDigest && fresh.length) {
    const owners = new Map();
    for (const it of fresh) if (it.ownerAdminId) { if (!owners.has(it.ownerAdminId)) owners.set(it.ownerAdminId, []); owners.get(it.ownerAdminId).push(it); }
    // Punch list S14: an item whose digest could not go out (mail down, the owner has no address yet) is taken back out of "first seen", so the next daily run finds it new
    // again and tries again. Before this, it was marked seen and never mailed. Items seen while the digest was OFF are not touched, so switching it on never floods anyone.
    const unsee = (list) => Promise.all(list.map(it => conn.query('DELETE FROM crm_attention_events WHERE rule_key = ? AND subject_type = ? AND subject_id = ? AND fingerprint = ? AND emailed_at IS NULL', [it.ruleKey, it.subjectType, it.subjectId, it.fingerprint || ''])));
    for (const [adminId, list] of owners) {
      const [[admin]] = await conn.query('SELECT email FROM admin_users WHERE id = ?', [adminId]);
      if (!admin || !admin.email) { await unsee(list); continue; }
      try { await sendDigest(admin.email, list); } catch (err) { console.error(`Digest not sent to one owner: ${err.message}`); await unsee(list); continue; }
      for (const it of list) await conn.query('UPDATE crm_attention_events SET emailed_at = ? WHERE rule_key = ? AND subject_type = ? AND subject_id = ? AND fingerprint = ?', [now, it.ruleKey, it.subjectType, it.subjectId, it.fingerprint || '']);
      digests++;
    }
  }
  return { total: all.length, active: active.length, held: all.length - active.length, fresh: fresh.length, byRule: countsByRule(active), digests, trialTasks: trial };
}

module.exports = {
  runDaily,
  RULES, HELP, helpFor, THRESHOLDS, THRESHOLD_DEFAULTS, loadThresholds, PER_RULE_LIMIT, SUBJECT_TYPES,
  evaluate, withStates, setState, clearState, recordFirstSeen, countsByRule, addDays,
};

// Sales CRM punch list G5 (PRD FR-RENEW-02): a district administrator asks to RENEW a license as it is, or CHANGE its seat count; staff approve or decline; staff then draft, price and
// send the quote with the usual tool. Spec and access matrix: docs/reference/crm-g5-repeat-order-requirements.md (confirmed by the owner 2026-11-16).
//
// Rules this file keeps (each has a test):
//  - A request only ever writes crm_repeat_requests, one audit row, and (so staff can find it) an open renewal or expansion DEAL on the account, plus, when staff approve, one TASK.
//    It never writes a purchase, invoice, license, seat, quote, price or contact label, and it never sends a quote. The district admin never sees or sets a price.
//  - A district admin reaches only their OWN districts' licenses and requests; anything else is "not found" (404), never "forbidden". School admins, teachers and students have no way in.
//  - The licenses on offer are paid, non-trial group licenses (the one Customer rule, QUALIFYING_SQL) that are not cancelled or suspended, in a school of the district, not ended more
//    than a year ago. A purchase is matched to a school by its school_id, or by its domain when it has no school_id (the same rule the renewal generator uses).
//  - One Waiting request per license (unique on purchase_id and open_flag). Cancel is allowed only while Waiting, and only by an administrator of that district. A decision is a
//    compare-and-set on state Waiting, so a second decision, or a decision on a cancelled request, is refused (409) and changes nothing.
//  - Approve: CRM Admin, or the Sales user who OWNS the request's deal. Decline: the same, and it needs a note. A deal nobody owns can be decided by a CRM Admin only.
//  - The sales-demo district and demo workspace districts are refused. Seat counts are whole numbers (1 to 100,000); the note is plain text of up to 500 characters and is
//    escaped wherever it is shown. No student, teacher name or address is stored.
// `conn` is the pool in the app and any query-capable handle in tests. SQL stays portable (no NOW(), no ON DUPLICATE KEY, no array parameters except IN (?)).
const { audit } = require('./audit');
const cls = require('./crm-classification');
const growth = require('./crm-growth');
const { isDemoDistrictName } = require('./sales-demo');

const KINDS = ['renew', 'change_seats'];
const STATES = ['waiting', 'approved', 'declined', 'cancelled'];
const MAX_SEATS = 100000;
const NOTE_MAX = 500;
const WAITING_TOO_LONG_DAYS = 60;
const LOOKBACK_DAYS = 365;

class Refusal extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || null; } }

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}
const isDuplicate = (err) => err && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(String(err.message)));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const plain = (v, max) => { if (typeof v !== 'string') return null; const t = v.trim(); return t ? t.slice(0, max) : null; };
const notAvailable = () => new Refusal(503, 'Reorder requests are not available yet. Please try again later.', 'not_available');
async function guarded(fn) { try { return await fn(); } catch (err) { if (isMissing(err)) throw notAvailable(); throw err; } }

// ---- the district's licenses -------------------------------------------------------------------------------------------------------------

const LICENSE_FROM = `${cls.PURCHASES_FROM} JOIN schools s ON s.district_id = ? AND (s.id = p.school_id OR (p.school_id IS NULL AND LOWER(s.domain) = LOWER(p.school_domain)))`;
const LICENSE_WHERE = (today) => ({
  sql: `p.product_type = 'group_license' AND ${cls.QUALIFYING_SQL} AND COALESCE(p.license_status, 'active') NOT IN ('cancelled', 'suspended') AND (p.expiration_date IS NULL OR p.expiration_date >= ?)`,
  params: [addDays(today, -LOOKBACK_DAYS)],
});

async function licenseOf(conn, districtId, purchaseId, today) {
  const w = LICENSE_WHERE(today);
  const [rows] = await conn.query(
    `SELECT p.id, p.contact_id, p.school_id, p.school_domain, p.seat_count, p.expiration_date, p.amount_cents, lp.name AS product_name, s.id AS sid, s.display_name AS school_name, s.domain AS sdomain
     ${LICENSE_FROM} WHERE p.id = ? AND ${w.sql} LIMIT 1`, [districtId, purchaseId, ...w.params]);
  return rows[0] || null;
}

// What the district administrator sees: their licenses (seats and end date, never a price) and their requests.
async function overview(conn, districtId, today) {
  return guarded(async () => {
    const w = LICENSE_WHERE(today);
    const [lic] = await conn.query(
      `SELECT p.id, p.seat_count, p.expiration_date, lp.name AS product_name, s.display_name AS school_name, s.domain AS sdomain
       ${LICENSE_FROM} WHERE ${w.sql} ORDER BY s.display_name, s.domain, p.expiration_date, p.id`, [districtId, ...w.params]);
    const [reqs] = await conn.query(
      `SELECT r.id, r.purchase_id, r.kind, r.current_seats, r.requested_seats, r.note, r.state, r.decision_note, r.created_at, r.decided_at
       FROM crm_repeat_requests r WHERE r.district_id = ? ORDER BY r.id DESC LIMIT 100`, [districtId]);
    const waiting = new Map(reqs.filter(r => r.state === 'waiting').map(r => [Number(r.purchase_id), Number(r.id)]));
    return {
      licenses: lic.map(l => ({ id: Number(l.id), school: l.school_name || l.sdomain || 'School', product: l.product_name || null, seats: l.seat_count === null || l.seat_count === undefined ? null : Number(l.seat_count),
        endsOn: l.expiration_date ? String(l.expiration_date).slice(0, 10) : null, waitingRequestId: waiting.get(Number(l.id)) || null })),
      requests: reqs.map(r => ({ id: Number(r.id), licenseId: Number(r.purchase_id), kind: r.kind, currentSeats: r.current_seats === null ? null : Number(r.current_seats),
        requestedSeats: r.requested_seats === null ? null : Number(r.requested_seats), note: r.note || null, state: r.state, declinedBecause: r.state === 'declined' ? (r.decision_note || null) : null,
        createdAt: r.created_at, decidedAt: r.decided_at || null })),
    };
  });
}

// ---- the deal staff will work from ----------------------------------------------------------------------------------------------------------

// The open renewal or expansion deal on the school's (else district's) account, or a new one. Returns the deal id, or null when the school has no CRM account (nothing is made).
async function ensureDeal(conn, license, kind, requestedSeats, { now, today }) {
  const school = await growth.resolveSchool(conn, license);
  if (!school) return null;
  let account = null;
  const [own] = await conn.query('SELECT id, name, assigned_admin_id FROM crm_accounts WHERE school_id = ? AND archived_at IS NULL', [school.id]);
  if (own[0]) account = own[0];
  else if (school.district_id) {
    const [dist] = await conn.query('SELECT id, name, assigned_admin_id FROM crm_accounts WHERE district_id = ? AND archived_at IS NULL', [school.district_id]);
    account = dist[0] || null;
  }
  if (!account) return null;
  const type = kind === 'change_seats' && Number(requestedSeats) > Number(license.seat_count || 0) ? 'expansion' : 'renewal';
  const [open] = await conn.query("SELECT id FROM crm_opportunities WHERE account_id = ? AND opp_type = ? AND state = 'open' ORDER BY id LIMIT 1", [account.id, type]);
  if (open[0]) return Number(open[0].id);
  const [[stage]] = await conn.query("SELECT id FROM crm_pipeline_stages WHERE stage_key = 'qualified'");
  if (!stage) return null;
  const name = `${type === 'expansion' ? 'Seat change request' : 'Reorder request'}: ${account.name}`.slice(0, 255);
  const [r] = await conn.query(
    `INSERT INTO crm_opportunities (account_id, name, owner_admin_id, stage_id, state, stage_entered_at, primary_contact_id, opp_type, source, product_focus, expected_close_date, next_step, next_step_due_at, renewal_of_purchase_id)
     VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [account.id, name, account.assigned_admin_id || null, stage.id, now, license.contact_id || null, type, 'District request (portal)', license.product_name ? String(license.product_name).slice(0, 255) : null,
      license.expiration_date ? String(license.expiration_date).slice(0, 10) : null, 'Review the district’s request, then approve or decline it on the Reorder requests page', `${addDays(today, 2)} 12:00:00`, license.id]);
  await conn.query('INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, actor_admin_id, reason, created_at) VALUES (?, NULL, ?, NULL, ?, NULL, ?, ?)',
    [r.insertId, stage.id, 'open', 'Opened by a district administrator’s reorder request', now]);
  if (license.contact_id) await conn.query("INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, 'other')", [r.insertId, license.contact_id]);
  await audit(conn, { actorType: 'system', action: 'crm_opportunity_created', entityType: 'crm_opportunity', entityId: r.insertId, newValue: { generated: 'crm.repeat_request', accountId: account.id, type } });
  return Number(r.insertId);
}

// ---- the district administrator's side -----------------------------------------------------------------------------------------------------

// admin = { siteUserId, email, districtIds, districts: [{ district_id, district_name }] }. Returns the new request. Throws Refusal.
async function createRequest(conn, admin, body, { now, today }) {
  const b = body && typeof body === 'object' ? body : {};
  const districtId = Number(b.districtId);
  const mine = (admin.districts || []).find(d => Number(d.district_id) === districtId);
  if (!mine) throw new Refusal(404, 'Not found.');
  if (isDemoDistrictName(mine.district_name)) throw new Refusal(403, 'Reorder requests are not available for demo accounts.');
  const kind = typeof b.kind === 'string' && KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) throw new Refusal(400, 'Choose whether to renew as it is or change the number of seats.');
  const purchaseId = Number.isInteger(b.purchaseId) ? b.purchaseId : (typeof b.purchaseId === 'string' && /^\d{1,10}$/.test(b.purchaseId) ? Number(b.purchaseId) : null);
  if (!purchaseId) throw new Refusal(400, 'Choose a license.');
  let seats = null;
  if (kind === 'change_seats') {
    const v = b.seats;
    seats = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,6}$/.test(v.trim()) ? Number(v) : NaN);
    if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) throw new Refusal(400, `Type the number of seats you want as a whole number from 1 to ${MAX_SEATS.toLocaleString('en-US')}.`);
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') throw new Refusal(400, 'The note must be plain text.');
  const note = plain(b.note, NOTE_MAX);

  return guarded(async () => {
    const license = await licenseOf(conn, districtId, purchaseId, today);
    if (!license) throw new Refusal(404, 'Not found.');
    const current = license.seat_count === null || license.seat_count === undefined ? null : Number(license.seat_count);
    if (kind === 'change_seats' && current !== null && seats === current) throw new Refusal(400, 'That is the number of seats you already have. Choose "Renew as it is" instead.');
    let id;
    try {
      const [r] = await conn.query(
        `INSERT INTO crm_repeat_requests (district_id, school_id, purchase_id, kind, current_seats, requested_seats, note, state, open_flag, requested_by_site_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', 1, ?, ?)`, [districtId, license.sid || null, license.id, kind, current, seats, note, admin.siteUserId, now]);
      id = Number(r.insertId);
    } catch (err) {
      if (isDuplicate(err)) throw new Refusal(409, 'You already have a request waiting for this license. Cancel it first if you want to change it.', 'already_waiting');
      throw err;
    }
    // The deal is for staff to find the request; a failure here never loses the request.
    let dealId = null;
    try {
      dealId = await ensureDeal(conn, license, kind, seats, { now, today });
      if (dealId) await conn.query('UPDATE crm_repeat_requests SET opportunity_id = ? WHERE id = ?', [dealId, id]);
    } catch (err) { console.error('repeat request: could not open a deal:', err.message); }
    await audit(conn, {
      actorType: 'site_user', actorId: admin.siteUserId, actorEmail: admin.email, action: 'crm_repeat_requested', entityType: 'crm_repeat_request', entityId: id,
      newValue: { districtId, purchaseId: license.id, kind, currentSeats: current, requestedSeats: seats, opportunityId: dealId },
      reason: 'A district administrator asked to renew or change seats. Nothing was bought or changed.',
    });
    return { id, districtId, districtName: mine.district_name, schoolName: license.school_name || license.sdomain || null, purchaseId: license.id, kind, currentSeats: current, requestedSeats: seats, opportunityId: dealId };
  });
}

// Cancel while Waiting, by an administrator of that district. Anything else about another district is 404.
async function cancelRequest(conn, admin, requestId, { now }) {
  return guarded(async () => {
    const [[r]] = await conn.query('SELECT id, district_id, state FROM crm_repeat_requests WHERE id = ?', [Number(requestId) || 0]);
    if (!r || !(admin.districtIds || []).map(Number).includes(Number(r.district_id))) throw new Refusal(404, 'Not found.');
    const [u] = await conn.query("UPDATE crm_repeat_requests SET state = 'cancelled', open_flag = NULL, decided_at = ? WHERE id = ? AND state = 'waiting'", [now, r.id]);
    if (!u.affectedRows) throw new Refusal(409, 'This request is no longer waiting, so it cannot be cancelled.', 'not_waiting');
    await audit(conn, { actorType: 'site_user', actorId: admin.siteUserId, actorEmail: admin.email, action: 'crm_repeat_cancelled', entityType: 'crm_repeat_request', entityId: r.id });
    return { id: Number(r.id), state: 'cancelled' };
  });
}

// ---- staff side --------------------------------------------------------------------------------------------------------------------------------

// role: 'admin' | 'sales' | 'readonly'. Read-only gets no asker name. Returns { requests, total }.
async function listForStaff(conn, { state, page = 1, pageSize = 50, role, today }) {
  return guarded(async () => {
    const where = [], params = [];
    if (state && STATES.includes(state)) { where.push('r.state = ?'); params.push(state); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM crm_repeat_requests r ${w}`, params);
    const [rows] = await conn.query(
      `SELECT r.*, d.name AS district_name, s.display_name AS school_name, s.domain AS school_domain, o.name AS deal_name, o.owner_admin_id AS deal_owner_id, ow.username AS deal_owner_name,
              p.seat_count AS license_seats, p.expiration_date, su.first_name AS asker_first, su.last_name AS asker_last
       FROM crm_repeat_requests r LEFT JOIN districts d ON d.id = r.district_id LEFT JOIN schools s ON s.id = r.school_id LEFT JOIN crm_opportunities o ON o.id = r.opportunity_id
       LEFT JOIN admin_users ow ON ow.id = o.owner_admin_id LEFT JOIN purchases p ON p.id = r.purchase_id LEFT JOIN site_users su ON su.id = r.requested_by_site_user_id
       ${w} ORDER BY (r.state = 'waiting') DESC, r.id DESC LIMIT ${Math.min(200, Math.max(1, Number(pageSize) || 50))} OFFSET ${(Math.max(1, Number(page) || 1) - 1) * Math.min(200, Math.max(1, Number(pageSize) || 50))}`, params);
    const days = (a) => Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${String(a).slice(0, 10)}T12:00:00Z`)) / 86400000));
    return {
      total: Number(n),
      requests: rows.map(r => ({
        id: Number(r.id), state: r.state, kind: r.kind, districtName: r.district_name || null, schoolName: r.school_name || r.school_domain || null, purchaseId: Number(r.purchase_id),
        currentSeats: r.current_seats === null ? null : Number(r.current_seats), requestedSeats: r.requested_seats === null ? null : Number(r.requested_seats), note: r.note || null,
        dealId: r.opportunity_id ? Number(r.opportunity_id) : null, dealName: r.deal_name || null, dealOwnerId: r.deal_owner_id ? Number(r.deal_owner_id) : null, dealOwnerName: r.deal_owner_name || null,
        askedBy: role === 'readonly' ? null : [r.asker_first, r.asker_last].filter(Boolean).join(' ') || null,
        createdAt: r.created_at, decidedAt: r.decided_at || null, decisionNote: r.decision_note || null,
        waitingDays: r.state === 'waiting' ? days(r.created_at) : null, waitingTooLong: r.state === 'waiting' && days(r.created_at) >= WAITING_TOO_LONG_DAYS,
      })),
    };
  });
}

// action: 'approve' | 'decline'. CRM Admin, or the Sales user who owns the request's deal. Returns { id, state, askerEmail, ... } for the route to email on a decline.
async function decide(conn, requestId, action, { adminId, role, note, now, today }) {
  if (!['approve', 'decline'].includes(action)) throw new Refusal(400, 'Choose approve or decline.');
  const why = plain(note, NOTE_MAX);
  return guarded(async () => {
    const [[r]] = await conn.query(
      `SELECT r.*, pu.contact_id AS buyer_contact_id, o.owner_admin_id AS deal_owner_id, d.name AS district_name, s.display_name AS school_name, s.domain AS school_domain, su.email AS asker_email, su.first_name AS asker_first
       FROM crm_repeat_requests r LEFT JOIN crm_opportunities o ON o.id = r.opportunity_id LEFT JOIN districts d ON d.id = r.district_id LEFT JOIN schools s ON s.id = r.school_id
       LEFT JOIN site_users su ON su.id = r.requested_by_site_user_id LEFT JOIN purchases pu ON pu.id = r.purchase_id WHERE r.id = ?`, [Number(requestId) || 0]);
    if (!r) throw new Refusal(404, 'Request not found.');
    const mayDecide = role === 'admin' || (role === 'sales' && r.deal_owner_id && Number(r.deal_owner_id) === Number(adminId));
    if (!mayDecide) throw new Refusal(403, 'Only a CRM Admin, or the owner of this request’s deal, can decide it.');
    if (action === 'decline' && !why) throw new Refusal(400, 'Write a short note for the district that says why.');
    const state = action === 'approve' ? 'approved' : 'declined';
    const [u] = await conn.query("UPDATE crm_repeat_requests SET state = ?, open_flag = NULL, decided_by_admin_id = ?, decision_note = ?, decided_at = ? WHERE id = ? AND state = 'waiting'", [state, adminId, why, now, r.id]);
    if (!u.affectedRows) throw new Refusal(409, 'This request was already decided or cancelled. Reload the page.', 'not_waiting');
    let taskId = null;
    if (action === 'approve') {
      const label = r.kind === 'renew' ? 'renew as it is' : `change to ${r.requested_seats} seats`;
      // A task belongs to exactly one subject: the deal, else the buyer on the license.
      const onDeal = !!r.opportunity_id;
      const [t] = await conn.query(
        `INSERT INTO crm_tasks (opportunity_id, account_id, contact_id, title, details, due_on, state, assigned_admin_id, created_by_admin_id, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        [onDeal ? Number(r.opportunity_id) : null, onDeal ? null : (r.buyer_contact_id || null), `Draft and send the quote: ${label}`.slice(0, 255),
          `The district asked to ${label} (now ${r.current_seats === null ? 'unknown' : r.current_seats} seats). Open a draft quote with the usual tool, set the price yourself and send it. Nothing has been priced or sent yet.`,
          today, adminId, adminId, now]);
      taskId = Number(t.insertId);
    }
    await audit(conn, {
      actorType: 'admin', actorId: adminId, action: action === 'approve' ? 'crm_repeat_approved' : 'crm_repeat_declined', entityType: 'crm_repeat_request', entityId: r.id,
      newValue: { state, kind: r.kind, requestedSeats: r.requested_seats === null ? null : Number(r.requested_seats), taskId }, reason: why,
    });
    return {
      id: Number(r.id), state, taskId, askerEmail: r.asker_email || null, askerFirst: r.asker_first || null,
      districtName: r.district_name || null, schoolName: r.school_name || r.school_domain || null, decisionNote: why, dealId: r.opportunity_id ? Number(r.opportunity_id) : null,
    };
  });
}

module.exports = { Refusal, KINDS, STATES, MAX_SEATS, NOTE_MAX, WAITING_TOO_LONG_DAYS, overview, createRequest, cancelRequest, listForStaff, decide, ensureDeal, isMissing };

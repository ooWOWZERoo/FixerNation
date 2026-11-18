// Sales CRM phase 6: the "Trial and demo engagement" card on a deal or an account (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec", feature 1).
// Read only. It writes nothing and keeps no copy.
//
// Rules this file keeps (each has a test):
//  - Every number says where it came from. Each section names its SOURCE and its WINDOW, and the screen prints both.
//  - Unknown is never zero. A metric is { value, unknownReason, kind }: a real number (zero included) has a value and no reason; anything the system does not have has
//    value null and a plain-words reason. "No snapshot for this school yet" is unknown, "0 teachers teaching" is a saved zero.
//  - No student-level data and no person. Seats and snapshots are counted, never listed: invited_email, registered_site_user_id, and every name, id or email of a
//    student or teacher are never selected. Student totals under 10 are not shown ("fewer than 10"), the same small-group idea the district Program Use Report keeps.
//  - A demo shows its dates and counts only. The group's name (public_demo_invitations.label) is staff-only and is never selected here.
//  - No login history, no time spent, no score and no quiz result is read.
//  - G18 (FR-TRIAL-01): a TREND (the latest saved month against the one before it) and four plain-fact USAGE ALERTS. Both are only ever computed from numbers the card already shows,
//    each alert says what it saw in words and numbers, and an unknown never raises an alert (no snapshot, no seat records, a hidden small number: nothing is said). The trend refuses to
//    compare two months when a different number of schools reported in them. No score, no ranking and nothing is written, mailed or put on Needs Attention (the owner's choice).
// `conn` is the pool in the route and any query-capable handle in tests. SQL stays portable (no NOW(), no array parameters).
const cls = require('./crm-classification');
const { loadScope, demoInvitationIds } = require('./crm-timeline');

const STUDENT_FLOOR = 10;
const MONTHS_SHOWN = 3;
const MAX_PURCHASES = 20;
const marks = (ids) => ids.map(() => '?').join(',');
const dayOf = (v) => (v ? String(v).slice(0, 10) : null);

function isMissing(err) {
  return err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
}

// One number. A real value (zero included) has no reason; an absent one has null and the words that explain it. `kind` tells the screen how to say it.
function known(value) { return { value: Number(value), unknownReason: null, kind: null }; }
function unknown(reason) { return { value: null, unknownReason: reason, kind: 'unknown' }; }
function small(reason) { return { value: null, unknownReason: reason, kind: 'small' }; }

// ---- scope -------------------------------------------------------------------------------------------------------------------------

async function resolveScope(conn, kind, id) {
  const sc = await loadScope(conn, kind, id);
  if (!sc.ok) return null;
  const [[a]] = await conn.query('SELECT id, name, school_id, district_id FROM crm_accounts WHERE id = ?', [sc.accountId]);
  if (!a) return null;
  const quoteSql = kind === 'opportunity' ? 'SELECT id FROM quote_requests WHERE opportunity_id = ?' : null;
  let schoolIds = [];
  let linkNote = null;
  if (a.school_id) schoolIds = [Number(a.school_id)];
  else if (a.district_id) {
    const [rows] = await conn.query('SELECT id FROM schools WHERE district_id = ? ORDER BY id', [a.district_id]);
    schoolIds = rows.map(r => Number(r.id));
    if (!schoolIds.length) linkNote = 'This district account has no schools yet.';
  } else if (kind === 'opportunity') {
    // A deal on an account with no school link can still find its school through what was bought on the deal's own quotes.
    const [rows] = await conn.query(`SELECT DISTINCT p.school_id FROM purchases p WHERE p.school_id IS NOT NULL AND p.quote_id IN (${quoteSql})`, [id]);
    schoolIds = rows.map(r => Number(r.school_id));
  }
  if (!schoolIds.length && !linkNote) linkNote = 'No school is linked to this account, so usage cannot be read. Link a school on the account page.';
  return { sc, account: a, schoolIds, linkNote, quoteSql };
}

// ---- licenses ----------------------------------------------------------------------------------------------------------------------

async function licensesSection(conn, S, kind, id, today) {
  const section = { source: 'Purchases and license seats (counts only)', window: `As of ${today}`, items: [], unknownReason: null };
  const where = [];
  const params = [];
  if (kind === 'opportunity') { where.push(`p.quote_id IN (${S.quoteSql})`); params.push(id); }
  if (S.schoolIds.length) { where.push(`p.school_id IN (${marks(S.schoolIds)})`); params.push(...S.schoolIds); }
  if (kind === 'account' && S.sc.contactIds.length) {
    // Punch list B13: a person in two accounts must not bring the other account's purchases here, so a purchase found through a contact counts only when it is not pinned
    // to a school outside this account (a purchase with no school, or one for a school in scope).
    const inScope = S.schoolIds.length ? ` OR p.school_id IN (${marks(S.schoolIds)})` : '';
    where.push(`(p.contact_id IN (${marks(S.sc.contactIds)}) AND (p.school_id IS NULL${inScope}))`); params.push(...S.sc.contactIds, ...S.schoolIds);
  }
  if (!where.length) { section.unknownReason = 'Nothing has been bought through this account yet, and no school is linked to look one up.'; return section; }
  const [rows] = await conn.query(
    `SELECT p.id, p.product_type, p.payment_status, p.license_status, p.effective_date, p.expiration_date, p.seat_count, p.trial_expiration_date, p.trial_lesson_limit,
            p.is_trial_flag, lp.is_trial, lp.name AS product_name
     ${cls.PURCHASES_FROM} WHERE (${where.join(' OR ')}) ORDER BY p.id DESC LIMIT ${MAX_PURCHASES}`, params);
  if (!rows.length) { section.unknownReason = 'No purchase or trial is linked to this deal or account yet.'; return section; }
  const ids = rows.map(r => r.id);
  const [seatRows] = await conn.query(`SELECT purchase_id, status, COUNT(*) AS n FROM license_seats WHERE purchase_id IN (${marks(ids)}) GROUP BY purchase_id, status`, ids);
  const seats = {};
  for (const r of seatRows) (seats[r.purchase_id] = seats[r.purchase_id] || {})[r.status] = Number(r.n);
  for (const p of rows) {
    const trial = cls.isTrialLike(p);
    const s = seats[p.id];
    const bought = Number(p.seat_count) > 0 ? known(p.seat_count) : unknown('The number of seats bought was not recorded.');
    const noSeatRows = 'No seat records exist for this purchase.';
    const count = (status) => (s ? known(s[status] || 0) : unknown(noSeatRows));
    const endsOn = dayOf(trial ? (p.trial_expiration_date || p.expiration_date) : p.expiration_date);
    section.items.push({
      purchaseId: Number(p.id), product: p.product_name || (p.product_type === 'single_license' ? 'Single license' : p.product_type === 'group_license' ? 'Group license' : 'Purchase'),
      kind: trial ? 'trial' : 'paid', paymentStatus: p.payment_status, licenseStatus: p.license_status || 'active',
      startsOn: dayOf(p.effective_date), endsOn,
      endsOnUnknownReason: endsOn ? null : (trial ? 'This trial has no end date recorded.' : 'This license has no end date recorded.'),
      daysLeft: endsOn ? Math.round((Date.parse(`${endsOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) : null,
      trialLessonLimit: trial ? (p.trial_lesson_limit === null || p.trial_lesson_limit === undefined ? unknown('No lesson limit is recorded for this trial.') : known(p.trial_lesson_limit)) : null,
      seatsBought: bought, seatsRegistered: count('registered'), seatsPending: count('pending'), seatsAvailable: count('available'),
    });
  }
  return section;
}

// ---- program use -------------------------------------------------------------------------------------------------------------------

const SUM_COLS = ['teachers_licensed', 'teachers_activated', 'teachers_teaching', 'classrooms', 'classrooms_active', 'students_enrolled', 'students_active', 'activities'];

function schoolYearLabel(start) { const y = Number(start); return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; }
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthLabel(key) { const m = /^(\d{4})-(\d{2})$/.exec(String(key)); return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : String(key); }

async function programUseSection(conn, S) {
  const section = {
    source: 'Program use snapshots, saved by the site on the 1st of each month (counts only; no student or teacher is named)',
    window: `The latest ${MONTHS_SHOWN} saved months`, schoolsInScope: S.schoolIds.length, months: [], unknownReason: null,
  };
  if (!S.schoolIds.length) { section.unknownReason = S.linkNote; return section; }
  let rows;
  try {
    [rows] = await conn.query(
      `SELECT school_id, school_year_start, month, ${SUM_COLS.join(', ')}, created_at FROM program_use_snapshots WHERE school_id IN (${marks(S.schoolIds)}) ORDER BY month DESC, school_id`, S.schoolIds);
  } catch (err) {
    if (!isMissing(err)) throw err;
    section.unknownReason = 'Usage snapshots are not set up on this server yet.';
    return section;
  }
  if (!rows.length) {
    section.unknownReason = S.schoolIds.length === 1
      ? 'No usage snapshot has been saved for this school yet. The site saves one on the 1st of each month.'
      : 'No usage snapshot has been saved for any of these schools yet. The site saves them on the 1st of each month.';
    return section;
  }
  const byMonth = new Map();
  for (const r of rows) {
    if (!byMonth.has(r.month)) byMonth.set(r.month, []);
    byMonth.get(r.month).push(r);
  }
  for (const month of [...byMonth.keys()].sort().reverse().slice(0, MONTHS_SHOWN)) {
    const list = byMonth.get(month);
    const sum = Object.fromEntries(SUM_COLS.map(c => [c, list.reduce((t, r) => t + Number(r[c] || 0), 0)]));
    // Punch list B13: the floor applies to each student number. "Active" is a subset of "enrolled", so 10 enrolled with 1 active must not show the 1.
    const hideEnrolled = sum.students_enrolled < STUDENT_FLOOR;
    const hideActive = hideEnrolled || (sum.students_active > 0 && sum.students_active < STUDENT_FLOOR); // a real zero names nobody, so it stays
    const why = hideEnrolled ? `Fewer than ${STUDENT_FLOOR} students are enrolled, so student numbers are not shown.` : `Fewer than ${STUDENT_FLOOR} students were active, so that number is not shown.`;
    const savedOn = list.map(r => dayOf(r.created_at)).filter(Boolean).sort().pop() || null;
    section.months.push({
      month, label: monthLabel(month), schoolYear: schoolYearLabel(list[0].school_year_start), savedOn,
      schoolsReporting: list.length, schoolsInScope: S.schoolIds.length,
      teachersLicensed: known(sum.teachers_licensed), teachersActivated: known(sum.teachers_activated), teachersTeaching: known(sum.teachers_teaching),
      classrooms: known(sum.classrooms), classroomsActive: known(sum.classrooms_active), activities: known(sum.activities),
      studentsEnrolled: hideEnrolled ? small(why) : known(sum.students_enrolled), studentsActive: hideActive ? small(why) : known(sum.students_active),
    });
  }
  section.trend = trendOf(section.months);
  return section;
}

// ---- trend and alerts (G18) --------------------------------------------------------------------------------------------------------

const TREND_METRICS = [['teachersTeaching', 'teachers teaching'], ['classroomsActive', 'classrooms in use'], ['activities', 'activities finished'], ['studentsActive', 'students active']];
const monthIndex = (key) => { const m = /^(\d{4})-(\d{2})$/.exec(String(key)); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null; };
const STALE_MONTHS = 2; // a latest saved month older than this is too old to judge "now" from

// The latest saved month against the one before it. { comparedWith, note, metrics } where each metric is { change, direction, unknownReason }.
function trendOf(months) {
  if (months.length < 2) return { comparedWith: null, note: 'Only one month has been saved so far, so there is nothing to compare it with yet.', metrics: null };
  const [a, b] = months;
  if (a.schoolsReporting !== b.schoolsReporting) return { comparedWith: String(b.label), note: `${a.schoolsReporting} school${a.schoolsReporting === 1 ? '' : 's'} reported in ${a.label} and ${b.schoolsReporting} in ${b.label}, so the two months cannot be compared fairly.`, metrics: null };
  const gap = monthIndex(a.month) - monthIndex(b.month);
  const metrics = {};
  for (const [key] of TREND_METRICS) {
    const x = a[key], y = b[key];
    if (x.value === null || y.value === null) metrics[key] = { change: null, direction: null, unknownReason: x.value === null ? x.unknownReason : y.unknownReason };
    else { const change = x.value - y.value; metrics[key] = { change, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'same', unknownReason: null }; }
  }
  return { comparedWith: String(b.label), note: gap > 1 ? `The earlier saved month is ${gap} months before ${a.label}, not the month directly before.` : null, metrics };
}

// The four alerts the owner chose. Each is { key, text }. Only real, known numbers are used.
function alertsFor(licenses, programUse, today) {
  const out = [];
  const months = programUse.months || [];
  const latest = months[0];
  const fresh = latest && monthIndex(latest.month) !== null && monthIndex(today.slice(0, 7)) - monthIndex(latest.month) <= STALE_MONTHS;
  const prev = months[1];
  const comparable = latest && prev && latest.schoolsReporting === prev.schoolsReporting;
  const noActivity = fresh && latest.activities.value === 0;
  if (noActivity && latest.teachersLicensed.value > 0) out.push({ key: 'no_activity', text: `No activities were finished in ${latest.label}, although ${latest.teachersLicensed.value} teacher${latest.teachersLicensed.value === 1 ? ' is' : 's are'} licensed.` });
  if (fresh && comparable && prev.teachersTeaching.value !== null && latest.teachersTeaching.value !== null && prev.teachersTeaching.value >= 4 && latest.teachersTeaching.value * 2 <= prev.teachersTeaching.value)
    out.push({ key: 'teaching_fell', text: `Teachers teaching fell from ${prev.teachersTeaching.value} in ${prev.label} to ${latest.teachersTeaching.value} in ${latest.label}, a drop of half or more.` });
  for (const i of licenses.items || []) {
    if (i.daysLeft === null || i.daysLeft < 0 || i.licenseStatus === 'cancelled' || i.licenseStatus === 'suspended') continue;
    if (i.kind === 'paid' && i.daysLeft <= 60 && i.seatsBought.value > 0 && i.seatsRegistered.value !== null && i.seatsRegistered.value * 2 < i.seatsBought.value)
      out.push({ key: 'license_ending_low_use', text: `Purchase #${i.purchaseId} ends in ${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'} and only ${i.seatsRegistered.value} of its ${i.seatsBought.value} seats are signed up.` });
    if (i.kind === 'trial' && i.daysLeft <= 7 && noActivity)
      out.push({ key: 'trial_ending_quiet', text: `Trial #${i.purchaseId} has ${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'} left and no activities were finished in ${latest.label}.` });
  }
  return out;
}

// ---- demo --------------------------------------------------------------------------------------------------------------------------

async function demoSection(conn, S) {
  const section = { source: 'Prospect demo invitations and the visits the site recorded (counts only; the group is not named)', window: "Each demo's own start and end dates", linked: false, invitations: [], note: null, unknownReason: null };
  let ids;
  try { ids = await demoInvitationIds(conn, S.sc); } catch (err) {
    if (!isMissing(err)) throw err;
    section.unknownReason = 'Demo records are not set up on this server yet.';
    return section;
  }
  if (!ids.length) { section.note = 'No prospect demo is tied to this record. A demo is tied to a deal or account when a quote or support request came from it.'; return section; }
  section.linked = true;
  // NOTE: the label column is deliberately not in this SELECT.
  const [invs] = await conn.query(`SELECT id, status, starts_at, ends_at, ended_at FROM public_demo_invitations WHERE id IN (${marks(ids)}) ORDER BY id DESC`, ids);
  const counts = {};
  const slot = (id) => (counts[id] = counts[id] || { gate: 0, signIns: { district: 0, school: 0, teacher: 0, parent: 0, student: 0 }, total: 0 });
  let eventsReadable = true;
  try {
    const [ev] = await conn.query(`SELECT invitation_id, kind, detail, COUNT(*) AS n FROM public_demo_events WHERE invitation_id IN (${marks(ids)}) GROUP BY invitation_id, kind, detail`, ids);
    for (const r of ev) {
      const c = slot(r.invitation_id);
      if (r.kind === 'gate_entry') c.gate += Number(r.n);
      else if (r.kind === 'sign_in') { if (c.signIns[r.detail] !== undefined) c.signIns[r.detail] += Number(r.n); c.total += Number(r.n); }
    }
  } catch (err) { if (!isMissing(err)) throw err; eventsReadable = false; }
  for (const r of invs) {
    const c = slot(r.id);
    const metric = (v) => (eventsReadable ? known(v) : unknown('Demo visit counts cannot be read on this server.'));
    section.invitations.push({
      id: Number(r.id), open: r.status === 'active', startsOn: dayOf(r.starts_at), endsOn: dayOf(r.ended_at || r.ends_at),
      gateEntries: metric(c.gate), signInsTotal: metric(c.total),
      signIns: Object.fromEntries(Object.keys(c.signIns).map(k => [k, metric(c.signIns[k])])),
    });
  }
  section.note = 'These are only the visits the site recorded when someone entered the access code or signed in. "None recorded" does not mean nobody looked.';
  return section;
}

// ---- the whole card ----------------------------------------------------------------------------------------------------------------

async function engagementFor(conn, kind, id, { today = new Date().toISOString().slice(0, 10) } = {}) {
  if (kind !== 'opportunity' && kind !== 'account') return null;
  const S = await resolveScope(conn, kind, id);
  if (!S) return null;
  const safe = async (fn, fallback) => {
    try { return await fn(); } catch (err) {
      if (!isMissing(err)) throw err;
      return { ...fallback, unknownReason: 'This part is not set up on this server yet.' };
    }
  };
  const licenses = await safe(() => licensesSection(conn, S, kind, id, today), { source: 'Purchases and license seats (counts only)', window: `As of ${today}`, items: [] });
  const programUse = await safe(() => programUseSection(conn, S), { source: 'Program use snapshots', window: '', months: [] });
  return {
    kind, id: Number(id), accountId: Number(S.account.id), accountName: S.account.name, schoolsInScope: S.schoolIds.length, linkNote: S.linkNote,
    alerts: alertsFor(licenses, programUse, today), licenses, programUse,
    demo: await safe(() => demoSection(conn, S), { source: 'Prospect demo invitations', window: '', linked: false, invitations: [] }),
  };
}

module.exports = { engagementFor, trendOf, alertsFor, STUDENT_FLOOR, MONTHS_SHOWN, TREND_METRICS };

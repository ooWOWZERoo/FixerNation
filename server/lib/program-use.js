const pool = require('../db/pool');
const { getSeatCountsForPurchases } = require('./seat-counts');
const pog = require('./pog-evidence');

// District Program Use Report: how much the program is being USED, at school level (docs/reference/district-program-report-requirements.md).
// Reach (who is involved), dosage (how much they finish, month by month), and a flag for schools that need support. Standards coverage is
// NOT computed here: the route reuses lib/pog-evidence.js so the two screens can never disagree.
//
// RULES THAT MUST NOT ERODE (section 6 of the requirements):
//   - school level and up only. Nothing here returns a teacher, student or classroom name or id; classrooms and teachers are only counted.
//   - a small group is never shown on its own. Schools with fewer than `minStudents` enrolled students are merged into "Other schools
//     combined" until the combined group is big enough; teacher figures are hidden for any row with fewer than `minTeachers` activated
//     teachers ("1 of 2 teachers is teaching" points at a person). Merging, not hiding one row, so a hidden figure cannot be worked out
//     by subtraction.
//   - "active" means FINISHED something (a lesson completed, an assigned game finished, a free-play game finished and valid). Started-only
//     does not count and there is no login tracking. No score, quiz result or time is read.
//   - nothing here says or implies an outcome.
// Nobody checks access in this file: routes work out which schools a viewer may see and pass only those in.
// SQL stays plain (no NOW(), no array params) so test/program-use.test.js runs it on node:sqlite.

const DEFAULTS = { regularWeeks: 3, lowUsePct: 50, minTeachers: 5 };
const CHUNK = 400;
const clampInt = (raw, lo, hi, dflt) => { const n = parseInt(raw, 10); return Number.isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n)); };
const clampRegularWeeks = (raw) => clampInt(raw, 1, 4, DEFAULTS.regularWeeks);
const clampLowUsePct = (raw) => clampInt(raw, 10, 90, DEFAULTS.lowUsePct);
const clampMinTeachers = (raw) => clampInt(raw, 3, 50, DEFAULTS.minTeachers); // never below 3: "1 of 2" must not be showable
const marks = (list) => list.map(() => '?').join(',');
const chunks = (list, size = CHUNK) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
const uniq = (list) => [...new Set(list)];

// ---- calendar helpers (read as text so a time zone cannot move a day) --------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthsOf(startYear) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((7 + i) % 12) + 1, y = m >= 8 ? startYear : startYear + 1;
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const p = (n) => String(n).padStart(2, '0');
    out.push({ key: `${y}-${p(m)}`, label: `${MONTHS[m - 1]} ${y}`, short: MONTHS[m - 1].slice(0, 3), from: `${y}-${p(m)}-01 00:00:00`, to: `${ny}-${p(nm)}-01 00:00:00` });
  }
  return out;
}
// The Monday that starts the calendar week a finish falls in.
function weekKey(at) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at || ''));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86400000).toISOString().slice(0, 10);
}
const dayText = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);

// ---- scopes: which schools and classrooms belong to a district -------------------------------------------------------
// The same rule Graduate Evidence uses (routes/pog-evidence.js): a school's classrooms are those of teachers holding a registered seat
// on its purchase; a classroom whose teacher holds seats at two schools is counted once, under the lowest school id.
async function classroomsByPurchase(purchaseIds) {
  const out = new Map(purchaseIds.map((id) => [id, []]));
  if (!purchaseIds.length) return out;
  const [rows] = await pool.query(
    `SELECT DISTINCT ls.purchase_id, c.id AS classroom_id
     FROM license_seats ls JOIN classrooms c ON c.teacher_site_user_id = ls.registered_site_user_id
     WHERE ls.status = 'registered' AND ls.purchase_id IN (${marks(purchaseIds)})`, purchaseIds);
  for (const r of rows) out.get(r.purchase_id).push(r.classroom_id);
  return out;
}
// -> [{ key, label, purchaseIds, classroomIds }] one per school of the district.
async function districtSchoolGroups(districtId) {
  const [rows] = await pool.query(
    `SELECT DISTINCT p.id AS purchase_id, s.id AS school_id, s.display_name, s.domain
     FROM purchases p JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
     WHERE p.product_type = 'group_license' AND s.district_id = ? ORDER BY s.id, p.id`, [districtId]);
  const byPurchase = await classroomsByPurchase(uniq(rows.map((r) => r.purchase_id)));
  const seen = new Set();
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.school_id) || { key: `s${r.school_id}`, label: r.display_name || r.domain || 'School', purchaseIds: [], classroomIds: [] };
    if (!g.purchaseIds.includes(r.purchase_id)) g.purchaseIds.push(r.purchase_id);
    for (const cid of byPurchase.get(r.purchase_id) || []) if (!seen.has(cid)) { seen.add(cid); g.classroomIds.push(cid); }
    groups.set(r.school_id, g);
  }
  return [...groups.values()];
}

// One school administrator's school: the purchase they manage, named from its school. Classrooms by the same seat rule.
async function schoolGroupForPurchase(purchaseId) {
  const [rows] = await pool.query(
    `SELECT s.display_name, s.domain, p.school_domain FROM purchases p LEFT JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain) WHERE p.id = ? LIMIT 1`, [purchaseId]);
  if (!rows.length) return null;
  const byPurchase = await classroomsByPurchase([purchaseId]);
  const r = rows[0];
  return { key: `p${purchaseId}`, label: r.display_name || r.domain || r.school_domain || 'Your school', purchaseIds: [purchaseId], classroomIds: byPurchase.get(purchaseId) || [] };
}

// ---- data: finishes and enrollment -------------------------------------------------------------------------------------
// Every finished activity by an ACTIVE student in the given classrooms during the school year:
// [{ classroomId, studentId, key: 'l:<id>' | 'g:<id>', at }]. Removed students are left out, as in Graduate Evidence.
async function loadFinishes(classroomIds, bounds) {
  const out = [];
  for (const ids of chunks(classroomIds)) {
    const args = [bounds.from, bounds.to, ...ids];
    const [lessons] = await pool.query(
      `SELECT cs.classroom_id AS classroom_id, slp.student_id AS student_id, slp.curriculum_id AS ref, slp.completed_at AS at
       FROM student_lesson_progress slp JOIN classroom_students cs ON cs.id = slp.student_id
       WHERE cs.is_active = 1 AND slp.completed_at IS NOT NULL AND slp.completed_at >= ? AND slp.completed_at < ? AND cs.classroom_id IN (${marks(ids)})`, args);
    for (const r of lessons) out.push({ classroomId: r.classroom_id, studentId: r.student_id, key: `l:${r.ref}`, at: String(r.at) });
    const [assigned] = await pool.query(
      `SELECT cs.classroom_id AS classroom_id, sgc.student_id AS student_id, cga.game_id AS ref, sgc.completed_at AS at
       FROM student_game_completions sgc JOIN classroom_game_assignments cga ON cga.id = sgc.game_assignment_id JOIN classroom_students cs ON cs.id = sgc.student_id
       WHERE cs.is_active = 1 AND sgc.completed_at >= ? AND sgc.completed_at < ? AND cs.classroom_id IN (${marks(ids)})`, args);
    for (const r of assigned) out.push({ classroomId: r.classroom_id, studentId: r.student_id, key: `g:${r.ref}`, at: String(r.at) });
    const [played] = await pool.query(
      `SELECT cs.classroom_id AS classroom_id, bgs.student_id AS student_id, bgs.game_id AS ref, bgs.completed_at AS at
       FROM brain_game_sessions bgs JOIN classroom_students cs ON cs.id = bgs.student_id
       WHERE cs.is_active = 1 AND bgs.completed_at IS NOT NULL AND bgs.validation_status = 'valid' AND bgs.completed_at >= ? AND bgs.completed_at < ? AND cs.classroom_id IN (${marks(ids)})`, args);
    for (const r of played) out.push({ classroomId: r.classroom_id, studentId: r.student_id, key: `g:${r.ref}`, at: String(r.at) });
  }
  return out;
}
// -> { enrolled: Map(classroomId -> active students), teacher: Map(classroomId -> teacher id) }. Teacher ids are used to COUNT, never returned.
async function loadFacts(classroomIds) {
  const enrolled = new Map(), teacher = new Map();
  for (const ids of chunks(classroomIds)) {
    const [counts] = await pool.query(`SELECT classroom_id, COUNT(*) AS n FROM classroom_students WHERE is_active = 1 AND classroom_id IN (${marks(ids)}) GROUP BY classroom_id`, ids);
    for (const r of counts) enrolled.set(r.classroom_id, Number(r.n));
    const [rooms] = await pool.query(`SELECT id, teacher_site_user_id FROM classrooms WHERE id IN (${marks(ids)})`, ids);
    for (const r of rooms) teacher.set(r.id, r.teacher_site_user_id);
  }
  return { enrolled, teacher };
}

// ---- one school's numbers --------------------------------------------------------------------------------------------
// Pure: from a school's classrooms, their enrollment and teachers, and its finishes. Returns additive counts so schools can be merged.
function schoolMetrics({ classroomIds, enrolled, teacher, finishes, months, regularWeeks }) {
  const rooms = new Set(classroomIds);
  const own = finishes.filter((f) => rooms.has(f.classroomId));
  const roomsWithStudents = classroomIds.filter((id) => (enrolled.get(id) || 0) > 0);
  const byMonth = months.map((m) => {
    const inMonth = own.filter((f) => f.at.slice(0, 7) === m.key);
    const students = new Set(inMonth.map((f) => f.studentId));
    const acts = new Set(inMonth.map((f) => `${f.studentId}|${f.key}`));
    const weeksByRoom = new Map();
    for (const f of inMonth) { const s = weeksByRoom.get(f.classroomId) || new Set(); s.add(weekKey(f.at)); weeksByRoom.set(f.classroomId, s); }
    const active = [...weeksByRoom.keys()];
    return {
      key: m.key, studentsActive: students.size, activities: acts.size, classroomsActive: active.length,
      classroomsRegular: active.filter((id) => weeksByRoom.get(id).size >= regularWeeks).length,
      teachersTeaching: new Set(active.map((id) => teacher.get(id)).filter((t) => t != null)).size,
    };
  });
  return {
    enrolled: roomsWithStudents.reduce((n, id) => n + enrolled.get(id), 0),
    classrooms: roomsWithStudents.length,
    studentsActiveYear: new Set(own.map((f) => f.studentId)).size,
    teachersTeachingYear: new Set(own.map((f) => teacher.get(f.classroomId)).filter((t) => t != null)).size,
    activitiesYear: byMonth.reduce((n, m) => n + m.activities, 0), // each month counts a student's activity once; the months add up
    months: byMonth,
  };
}

// ---- merging and the small-group rules ---------------------------------------------------------------------------------
const ADD_FIELDS = ['enrolled', 'classrooms', 'studentsActiveYear', 'teachersTeachingYear', 'activitiesYear', 'licensed', 'activated'];
function addSchools(a, b) {
  const out = { ...a };
  for (const f of ADD_FIELDS) out[f] = (a[f] || 0) + (b[f] || 0);
  out.months = a.months.map((m, i) => ({ key: m.key, studentsActive: m.studentsActive + b.months[i].studentsActive, activities: m.activities + b.months[i].activities,
    classroomsActive: m.classroomsActive + b.months[i].classroomsActive, classroomsRegular: m.classroomsRegular + b.months[i].classroomsRegular, teachersTeaching: m.teachersTeaching + b.months[i].teachersTeaching }));
  return out;
}
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);

// `schools`: [{ key, label, licensed, activated, ...schoolMetrics }]. Returns the rows to SHOW (each with at least `minStudents` enrolled
// students, or none at all) and says whether the whole thing has to be hidden.
function applyRules(schools, { minStudents, minTeachers, lastFullKey, lowUsePct }) {
  const total = schools.reduce((n, s) => n + s.enrolled, 0);
  if (total < minStudents) return { suppressed: true, rows: [] };
  const visible = schools.filter((s) => s.enrolled >= minStudents || s.enrolled === 0).map((s) => ({ ...s, merged: 1 }));
  const small = schools.filter((s) => s.enrolled > 0 && s.enrolled < minStudents);
  let bucket = null;
  if (small.length) {
    bucket = small.reduce((acc, s) => addSchools(acc, s), { key: 'other', label: 'Other schools combined', enrolled: 0, classrooms: 0, studentsActiveYear: 0, teachersTeachingYear: 0, activitiesYear: 0, licensed: 0, activated: 0,
      months: schools[0].months.map((m) => ({ key: m.key, studentsActive: 0, activities: 0, classroomsActive: 0, classroomsRegular: 0, teachersTeaching: 0 })) });
    bucket.merged = small.length;
    const absorbable = visible.filter((s) => s.enrolled > 0).sort((a, b) => a.enrolled - b.enrolled);
    while (bucket.enrolled < minStudents && absorbable.length) {
      const s = absorbable.shift();
      visible.splice(visible.indexOf(s), 1);
      bucket = { ...addSchools(bucket, s), key: 'other', label: 'Other schools combined', merged: bucket.merged + s.merged };
    }
  }
  const rows = [...visible, ...(bucket ? [bucket] : [])].map((s) => {
    const lastFull = lastFullKey ? s.months.find((m) => m.key === lastFullKey) : null;
    // A row with fewer than `minTeachers` activated teachers hides everything that counts teachers or classrooms (a classroom is one
    // teacher's), including the support flag: "1 of 2 classrooms is in regular use" would point at a person.
    const showTeachers = s.activated >= minTeachers;
    let flag = null;
    if (!showTeachers) flag = 'hidden';
    else if (s.key !== 'other' && s.classrooms > 0) flag = !lastFull ? 'no_data_yet' : (pct(lastFull.classroomsRegular, s.classrooms) < lowUsePct ? 'low_use' : null);
    return {
      key: s.key, label: s.label, merged: s.merged,
      teachers: showTeachers ? { licensed: s.licensed, activated: s.activated, teaching: s.teachersTeachingYear } : null,
      studentsEnrolled: s.enrolled, studentsActive: s.studentsActiveYear, reach: pct(s.studentsActiveYear, s.enrolled),
      classrooms: showTeachers ? s.classrooms : null, classroomsRegularLastMonth: showTeachers && lastFull ? lastFull.classroomsRegular : null,
      activities: s.activitiesYear, activitiesPerActiveStudent: s.studentsActiveYear > 0 ? Math.round((s.activitiesYear / s.studentsActiveYear) * 10) / 10 : null,
      flag, months: s.months.map((m) => ({ key: m.key, studentsActive: m.studentsActive, activities: m.activities })),
    };
  });
  rows.sort((a, b) => (a.key === 'other') - (b.key === 'other') || String(a.label).localeCompare(String(b.label)));
  return { suppressed: false, rows };
}

// The month before `asOf`'s month, if it is inside the school year (August has none yet).
function lastFullMonth(months, asOfText) {
  const i = months.findIndex((m) => m.key === asOfText.slice(0, 7));
  return i > 0 ? months[i - 1].key : null;
}

// ---- the report --------------------------------------------------------------------------------------------------------
const emptyMonths = (months) => months.map((m) => ({ key: m.key, studentsActive: 0, activities: 0, classroomsActive: 0, classroomsRegular: 0, teachersTeaching: 0 }));
const emptyTotals = (months) => ({ enrolled: 0, classrooms: 0, studentsActiveYear: 0, teachersTeachingYear: 0, activitiesYear: 0, licensed: 0, activated: 0, months: emptyMonths(months) });
function readSettings(settings = {}) {
  return { regularWeeks: clampRegularWeeks(settings.regularWeeks), lowUsePct: clampLowUsePct(settings.lowUsePct), minTeachers: clampMinTeachers(settings.minTeachers), minStudents: pog.clampMinGroup(settings.minStudents) };
}

// Turns per-school numbers into the report the page shows: the small-group rules, the district totals, the month series. Shared by the live
// report (this school year) and the saved-snapshot report (a past school year), so the two can never apply the rules differently.
// `currentKey` marks the month "so far" and blanks later ones; null for a finished school year. `withFlags` is false for a past year (a
// support flag about last July would mean nothing).
function buildReport({ schools, months, schoolYear, asOfText, currentKey, lastFullKey, settings, schoolsLicensed, withFlags }) {
  const licensedTeachers = schools.reduce((n, s) => n + s.licensed, 0), activatedTeachers = schools.reduce((n, s) => n + s.activated, 0);
  const base = { schoolYear, asOf: asOfText, lastFullMonth: lastFullKey, settings, schoolsLicensed, teachersLicensed: licensedTeachers, teachersActivated: activatedTeachers };
  const ruled = applyRules(schools, { minStudents: settings.minStudents, minTeachers: settings.minTeachers, lastFullKey: withFlags ? lastFullKey : null, lowUsePct: settings.lowUsePct });
  if (ruled.suppressed) return { ...base, suppressed: true };
  if (!withFlags) ruled.rows.forEach((r) => { if (r.flag !== 'hidden') r.flag = null; });
  const all = schools.reduce((acc, s) => addSchools(acc, s), emptyTotals(months));
  return {
    ...base, suppressed: false,
    totals: { studentsEnrolled: all.enrolled, studentsActive: all.studentsActiveYear, reach: pct(all.studentsActiveYear, all.enrolled), classrooms: all.classrooms, activities: all.activitiesYear,
      activitiesPerActiveStudent: all.studentsActiveYear > 0 ? Math.round((all.activitiesYear / all.studentsActiveYear) * 10) / 10 : null },
    months: months.map((m, i) => ({ key: m.key, label: m.label, short: m.short, future: currentKey ? m.key > currentKey : false, current: currentKey ? m.key === currentKey : false,
      studentsActive: all.months[i].studentsActive, activities: all.months[i].activities, classroomsActive: all.months[i].classroomsActive, classroomsRegular: all.months[i].classroomsRegular })),
    schools: ruled.rows,
  };
}

// `groups`: [{ key, label, purchaseIds, classroomIds }] (what the route resolved and the viewer may see).
async function programReport({ groups, schoolYearStart, asOf = new Date(), settings: raw = {} }) {
  const settings = readSettings(raw);
  const bounds = pog.schoolYearBounds(schoolYearStart);
  const months = monthsOf(schoolYearStart);
  const asOfText = dayText(asOf);
  const classroomIds = uniq(groups.flatMap((g) => g.classroomIds));
  const [finishes, facts, seats] = await Promise.all([
    loadFinishes(classroomIds, bounds), loadFacts(classroomIds), getSeatCountsForPurchases(uniq(groups.flatMap((g) => g.purchaseIds))),
  ]);
  const schools = groups.map((g) => {
    const m = schoolMetrics({ classroomIds: g.classroomIds, enrolled: facts.enrolled, teacher: facts.teacher, finishes, months, regularWeeks: settings.regularWeeks });
    const counts = g.purchaseIds.map((id) => seats.get(id) || { total: 0, registered: 0 });
    return { key: g.key, label: g.label, licensed: counts.reduce((n, c) => n + c.total, 0), activated: counts.reduce((n, c) => n + c.registered, 0), ...m };
  });
  return buildReport({ schools, months, schoolYear: bounds.label, asOfText, currentKey: asOfText.slice(0, 7), lastFullKey: lastFullMonth(months, asOfText), settings, schoolsLicensed: groups.length, withFlags: true });
}

// ---- history: the monthly school-level snapshot (requirements section 8) ---------------------------------------------
// One row per school and month: counts only, no student id, no teacher id, no name, no text. Written ONCE for a finished month and never
// recomputed (a later run would read data that has since changed or been removed and overwrite the true totals). Counts are saved as they
// were; the small-group rules are applied when the rows are READ, never when they are saved.

// Rows for the given months of one school year. `groups` are one district's schools (key 's<id>').
async function snapshotRowsFor({ groups, schoolYearStart, monthKeys, districtId, source, settings: raw = {} }) {
  const settings = readSettings(raw);
  const bounds = pog.schoolYearBounds(schoolYearStart);
  const months = monthsOf(schoolYearStart);
  const classroomIds = uniq(groups.flatMap((g) => g.classroomIds));
  const [finishes, facts, seats] = await Promise.all([
    loadFinishes(classroomIds, bounds), loadFacts(classroomIds), getSeatCountsForPurchases(uniq(groups.flatMap((g) => g.purchaseIds))),
  ]);
  const rows = [];
  for (const g of groups) {
    const schoolId = Number(String(g.key).replace(/^s/, ''));
    if (!Number.isInteger(schoolId)) continue;
    const m = schoolMetrics({ classroomIds: g.classroomIds, enrolled: facts.enrolled, teacher: facts.teacher, finishes, months, regularWeeks: settings.regularWeeks });
    const rooms = new Set(g.classroomIds);
    const own = finishes.filter((f) => rooms.has(f.classroomId));
    const counts = g.purchaseIds.map((id) => seats.get(id) || { total: 0, registered: 0 });
    for (const key of monthKeys) {
      const mm = m.months.find((x) => x.key === key);
      if (!mm) continue;
      const upTo = own.filter((f) => f.at.slice(0, 7) <= key);
      rows.push({
        schoolYearStart, month: key, schoolId, districtId, source,
        teachersLicensed: counts.reduce((n, c) => n + c.total, 0), teachersActivated: counts.reduce((n, c) => n + c.registered, 0),
        teachersTeaching: mm.teachersTeaching, teachersTeachingYtd: new Set(upTo.map((f) => facts.teacher.get(f.classroomId)).filter((t) => t != null)).size,
        classrooms: m.classrooms, classroomsActive: mm.classroomsActive, classroomsRegular: mm.classroomsRegular,
        studentsEnrolled: m.enrolled, studentsActive: mm.studentsActive, studentsActiveYtd: new Set(upTo.map((f) => f.studentId)).size, activities: mm.activities,
      });
    }
  }
  return rows;
}

// Writes the rows that are not already there (a saved month is never touched again). Returns { written, skipped }.
async function writeSnapshotRows(rows) {
  let written = 0, skipped = 0;
  for (const r of rows) {
    const [have] = await pool.query('SELECT 1 AS found FROM program_use_snapshots WHERE school_year_start = ? AND month = ? AND school_id = ? LIMIT 1', [r.schoolYearStart, r.month, r.schoolId]);
    if (have.length) { skipped++; continue; }
    await pool.query(
      `INSERT INTO program_use_snapshots (school_year_start, month, school_id, district_id, teachers_licensed, teachers_activated, teachers_teaching, teachers_teaching_ytd,
         classrooms, classrooms_active, classrooms_regular, students_enrolled, students_active, students_active_ytd, activities, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.schoolYearStart, r.month, r.schoolId, r.districtId, r.teachersLicensed, r.teachersActivated, r.teachersTeaching, r.teachersTeachingYtd,
        r.classrooms, r.classroomsActive, r.classroomsRegular, r.studentsEnrolled, r.studentsActive, r.studentsActiveYtd, r.activities, r.source]);
    written++;
  }
  return { written, skipped };
}

// Which months a run should save: the month that just ended (monthly), or every finished month of the current school year (backfill).
function monthsToSnapshot({ today = new Date(), backfill = false }) {
  const t = dayText(today), startYear = pog.schoolYearStartOf(t);
  const months = monthsOf(startYear), current = t.slice(0, 7);
  const finished = months.filter((m) => m.key < current).map((m) => m.key);
  if (backfill) return { schoolYearStart: startYear, monthKeys: finished };
  const prev = finished.length ? finished[finished.length - 1] : null;
  if (!prev) {
    // On 1 August the month that just ended is July of the previous school year.
    const py = startYear - 1, last = monthsOf(py)[11].key;
    return last < current ? { schoolYearStart: py, monthKeys: [last] } : { schoolYearStart: py, monthKeys: [] };
  }
  return { schoolYearStart: startYear, monthKeys: [prev] };
}

// A finished school year, from saved rows only. Returns null when nothing was saved for those schools that year.
async function lastYearReport({ groups, schoolYearStart, settings: raw = {} }) {
  const settings = readSettings(raw);
  const ids = groups.map((g) => Number(String(g.key).replace(/^s/, ''))).filter(Number.isInteger);
  if (!ids.length) return null;
  const [rows] = await pool.query(
    `SELECT * FROM program_use_snapshots WHERE school_year_start = ? AND school_id IN (${marks(ids)}) ORDER BY month`, [schoolYearStart, ...ids]);
  if (!rows.length) return null;
  const months = monthsOf(schoolYearStart);
  const schools = groups.map((g) => {
    const id = Number(String(g.key).replace(/^s/, ''));
    const mine = rows.filter((r) => Number(r.school_id) === id);
    const latest = mine.length ? mine[mine.length - 1] : null;
    return {
      key: g.key, label: g.label, licensed: latest ? Number(latest.teachers_licensed) : 0, activated: latest ? Number(latest.teachers_activated) : 0,
      enrolled: latest ? Number(latest.students_enrolled) : 0, classrooms: latest ? Number(latest.classrooms) : 0,
      studentsActiveYear: latest ? Number(latest.students_active_ytd) : 0, teachersTeachingYear: latest ? Number(latest.teachers_teaching_ytd) : 0,
      activitiesYear: mine.reduce((n, r) => n + Number(r.activities), 0),
      months: months.map((m) => { const r = mine.find((x) => x.month === m.key); return { key: m.key, studentsActive: r ? Number(r.students_active) : 0, activities: r ? Number(r.activities) : 0,
        classroomsActive: r ? Number(r.classrooms_active) : 0, classroomsRegular: r ? Number(r.classrooms_regular) : 0, teachersTeaching: r ? Number(r.teachers_teaching) : 0 }; }),
    };
  });
  const have = new Set(rows.map((r) => r.month));
  const report = buildReport({ schools, months, schoolYear: pog.schoolYearBounds(schoolYearStart).label, asOfText: months[11].key + '-31', currentKey: null, lastFullKey: null, settings, schoolsLicensed: groups.length, withFlags: false });
  report.monthsSaved = months.filter((m) => have.has(m.key)).length;
  report.backfilledMonths = rows.filter((r) => r.source === 'backfill').map((r) => r.month).filter((v, i, a) => a.indexOf(v) === i).length;
  if (!report.suppressed) report.months.forEach((m) => { m.saved = have.has(m.key); });
  return report;
}

// Last year's attribute coverage from the Graduate Evidence year snapshot (pog_evidence_snapshots), one group per school, with the same small-group
// merge. The snapshot keeps classroom ids only, so a classroom is mapped to a school the way the live report does (its teacher's seat today).
async function snapshotStandards({ groups, schoolYearStart, minStudents }) {
  const ids = uniq(groups.flatMap((g) => g.classroomIds));
  if (!ids.length) return null;
  let rows = [];
  for (const part of chunks(ids)) {
    const [r] = await pool.query(`SELECT * FROM pog_evidence_snapshots WHERE state_code = 'NY' AND school_year_start = ? AND classroom_id IN (${marks(part)})`, [schoolYearStart, ...part]);
    rows = rows.concat(r);
  }
  if (!rows.length) return null;
  const itemsMeta = new Map(); // item id -> { code, title, framework, direct, supporting }
  for (const r of rows) if (!itemsMeta.has(r.item_id)) itemsMeta.set(r.item_id, { id: r.item_id, code: r.item_code, title: r.item_title, framework: r.framework_name, frameworkId: r.framework_id, direct: Number(r.direct_activities), supporting: Number(r.supporting_activities) });
  const roomGroup = new Map();
  for (const g of groups) for (const c of g.classroomIds) if (!roomGroup.has(c)) roomGroup.set(c, g);
  const byGroup = new Map(groups.map((g) => [g.key, { key: g.key, label: g.label, students: 0, items: {}, rooms: new Set() }]));
  for (const r of rows) {
    const g = roomGroup.get(r.classroom_id); if (!g) continue;
    const slot = byGroup.get(g.key);
    if (!slot.rooms.has(r.classroom_id)) { slot.rooms.add(r.classroom_id); slot.students += Number(r.students_counted); }
    const cur = slot.items[r.item_id] || { practiced: 0, touched: 0 };
    slot.items[r.item_id] = { practiced: cur.practiced + Number(r.practiced), touched: cur.touched + Number(r.touched) };
  }
  const merged = pog.groupWithMinimum([...byGroup.values()].filter((g) => g.students > 0).map(({ key, label, students, items }) => ({ key, label, students, items })), minStudents, 'Other schools combined');
  const frameworks = new Map();
  for (const m of itemsMeta.values()) {
    const f = frameworks.get(m.frameworkId) || { id: m.frameworkId, type: /portrait/i.test(m.framework) ? 'portrait_of_graduate' : 'sel_standards', name: m.framework, issuingBody: null, officialUrl: null, items: [] };
    const c = merged.suppressed ? null : merged.total.items[m.id] || { practiced: 0, touched: 0 };
    const status = !m.direct && !m.supporting ? 'no_connection' : (m.direct ? 'ok' : 'supporting_only');
    const item = { id: m.id, code: m.code, title: m.title, summary: null, directActivities: m.direct, supportingActivities: m.supporting, status };
    if (status !== 'no_connection' && c) Object.assign(item, { students: merged.total.students, practiced: c.practiced, touched: c.touched });
    f.items.push(item);
    frameworks.set(m.frameworkId, f);
  }
  const out = [...frameworks.values()].map((f) => ({ ...f, items: f.items.sort((a, b) => String(a.code).localeCompare(String(b.code))) }));
  return { suppressed: !!merged.suppressed, minGroup: minStudents, schoolYear: pog.schoolYearBounds(schoolYearStart).label, frameworks: out, students: merged.suppressed ? 0 : merged.total.students };
}

module.exports = {
  DEFAULTS, clampRegularWeeks, clampLowUsePct, clampMinTeachers, monthsOf, weekKey, readSettings,
  classroomsByPurchase, districtSchoolGroups, schoolGroupForPurchase, loadFinishes, loadFacts, schoolMetrics, applyRules, lastFullMonth, buildReport, programReport,
  snapshotRowsFor, writeSnapshotRows, monthsToSnapshot, lastYearReport, snapshotStandards,
};

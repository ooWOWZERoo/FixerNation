const pool = require('../db/pool');
const pog = require('./pog-evidence');
const pins = require('./portrait-pins');
const { classroomSchoolYear, purgeDate } = require('./student-retention');

// My Graduate Portrait, tier 2: the end-of-year KEEPSAKE (docs/reference/graduate-portrait-requirements.md section 5 and D4).
// A page the student, or a linked parent, opens and prints or saves. FNE keeps NOTHING: it is built from live records at the moment
// it is opened, never stored, never emailed. Same evidence as the tier 1 portrait, but for the CLASSROOM's own school year (so it
// still prints in August and September, after the calendar school year has rolled over), and:
//   - a student's own keepsake may include the words they pinned; a parent's NEVER does (D3: pinned words are the student's own);
//   - a teacher can switch it off for their class (classrooms.keepsake_enabled, on by default);
//   - the window is 1 June to the day before student data is due for deletion. The student-data purge does not exist yet (retention phase 4),
//     so until it does the window is simply "from the start of the classroom's school year, with no end". Set PURGE_BUILT to true in
//     the same release the purge ships, and the 1 June to purge-date window takes over.
// Nothing here checks WHO is asking: routes work out the student from a verified session (the student's own, or a parent's confirmed
// link) and pass only that student in. SQL stays plain so test/portrait-keepsake.test.js runs it on node:sqlite.

const PURGE_BUILT = false;
const STATE = 'NY'; // Graduate Evidence has New York frameworks only so far.

// -> { start, opensOn, closesOn|null, state: 'open' | 'not_yet' | 'closed' }. `classroom` needs academic_year and created_at.
function keepsakeWindow(classroom, today = new Date(), purgeBuilt = PURGE_BUILT) {
  const year = classroomSchoolYear(classroom) || { start: pog.currentSchoolYearStart(today) };
  const opensOn = purgeBuilt ? `${year.start + 1}-06-01` : `${year.start}-08-01`;
  // The purge deletes on the day data is due (a nightly job, so possibly before anyone is awake), so the last day to open it is the day BEFORE.
  const closesOn = purgeBuilt ? new Date(Date.parse(`${purgeDate(year.start)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : null;
  const now = (today instanceof Date ? today : new Date(today)).toISOString().slice(0, 10);
  const state = now < opensOn ? 'not_yet' : (closesOn && now > closesOn ? 'closed' : 'open');
  return { start: year.start, opensOn, closesOn, state };
}

// Whether a classroom's keepsake may be opened right now, without building it (the student page uses this to show or hide its link).
function keepsakeStatus(classroom, today = new Date()) {
  const w = keepsakeWindow(classroom, today);
  const enabled = classroom.keepsake_enabled === undefined || classroom.keepsake_enabled === null ? true : Number(classroom.keepsake_enabled) !== 0;
  return { enabled, window: w.state, available: enabled && w.state === 'open', opensOn: w.opensOn, closesOn: w.closesOn };
}

// Builds the keepsake for ONE student. Returns { ok: false, reason: 'off' | 'not_open' | 'closed' } or { ok: true, ... }.
// `includePins` is true only for the student's own keepsake.
async function buildKeepsake({ studentId, displayName, classroom, includePins, today = new Date() }) {
  const status = keepsakeStatus(classroom, today);
  if (!status.enabled) return { ok: false, reason: 'off' };
  if (status.window !== 'open') return { ok: false, reason: status.window === 'closed' ? 'closed' : 'not_open', opensOn: status.opensOn, closesOn: status.closesOn };
  const start = keepsakeWindow(classroom, today).start;
  const connections = await pog.loadConnections(STATE);
  const portrait = await pog.studentPortrait({ studentId, schoolYearStart: start, connections });
  const out = {
    ok: true,
    student: { displayName },
    className: classroom.name || '',
    madeOn: (today instanceof Date ? today : new Date(today)).toISOString().slice(0, 10),
    ...portrait,
  };
  if (includePins) {
    const itemIds = new Set(portrait.frameworks.flatMap((f) => f.items.map((i) => i.id)));
    out.pins = (await pins.listPins(studentId, start)).map((p) => ({ text: p.text, itemId: itemIds.has(p.itemId) ? p.itemId : null }));
  }
  return out;
}

async function loadClassroom(classroomId) {
  try {
    const [rows] = await pool.query('SELECT id, name, academic_year, created_at, keepsake_enabled FROM classrooms WHERE id = ?', [classroomId]);
    return rows[0] || null;
  } catch (err) {
    // Before the alter script has added keepsake_enabled, the keepsake simply counts as on (the default); nothing else breaks.
    if (err && err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    const [rows] = await pool.query('SELECT id, name, academic_year, created_at FROM classrooms WHERE id = ?', [classroomId]);
    return rows[0] || null;
  }
}

module.exports = { PURGE_BUILT, keepsakeWindow, keepsakeStatus, buildKeepsake, loadClassroom };

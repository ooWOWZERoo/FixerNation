const pool = require('../db/pool');
const pog = require('./pog-evidence');

// Graduate Evidence year snapshot (docs/reference/pog-evidence-requirements.md section 7, phase 5; retention decision D5).
//
// The student-data purge deletes student records about 60 days after a school year ends. De-identified year totals survive it:
// for each classroom, school year and graduate attribute, how many students were counted, how many practiced it, how many only
// touched it, and how many connected activities were finished. NO student id, name or text goes in the table, only counts, and a
// count is never a score. The classroom id stays meaningful because the classroom shell survives the purge.
//
// Two rules that must not erode:
//   1. A snapshot is written ONCE per classroom, school year and state, from the live data, and never recomputed afterwards (a later
//      run would read a purged classroom and overwrite true totals with zeros). An existing snapshot is left exactly as it is.
//   2. A school year that has not ended cannot be snapshotted: its totals would be frozen before they were finished.
// The purge (retention phase 4) must call snapshotClassroomYear() for a classroom BEFORE it deletes that classroom's students.
//
// Nothing reads the snapshot yet: the screens show the current school year only (owner decision, Release 152). It is kept so a
// "last year" view or a printed report can be built later without the data being gone.
// SQL stays plain so test/pog-evidence-snapshot.test.js runs it on node:sqlite.

// The school year `start` (Aug start .. Jul start+1) is over once today is on or after 1 August of start+1.
function schoolYearHasEnded(schoolYearStart, today = new Date()) {
  const { to } = pog.schoolYearBounds(schoolYearStart);
  return today.toISOString().slice(0, 19).replace('T', ' ') >= to;
}
// The most recent school year that has ended, as its start year (in August 2026, 2025; on 31 July 2027, still 2025).
const lastEndedSchoolYear = (today = new Date()) => pog.currentSchoolYearStart(today) - 1;

async function alreadySnapshotted(classroomId, schoolYearStart, state) {
  const [rows] = await pool.query(
    'SELECT 1 AS found FROM pog_evidence_snapshots WHERE classroom_id = ? AND school_year_start = ? AND state_code = ? LIMIT 1',
    [classroomId, schoolYearStart, state]);
  return rows.length > 0;
}

// Writes one classroom's snapshot for one finished school year. Returns { status, rows }:
//   'written' (rows written), 'exists' (already snapshotted, left alone), 'no_students' (nothing to record), 'not_ended' is thrown instead.
async function snapshotClassroomYear({ classroomId, schoolYearStart, state = 'NY', connections, today = new Date() }) {
  const id = Number(classroomId);
  if (!Number.isInteger(id) || id < 1) { const e = new Error('Not a classroom.'); e.status = 400; throw e; }
  if (!schoolYearHasEnded(schoolYearStart, today)) { const e = new Error('That school year has not ended yet, so it cannot be saved.'); e.status = 400; throw e; }
  const conns = connections || await pog.loadConnections(state);
  if (await alreadySnapshotted(id, schoolYearStart, conns.state)) return { status: 'exists', rows: 0 };

  const ev = await pog.classroomEvidence({ classroomIds: [id], schoolYearStart, connections: conns, withFinished: true });
  const c = ev.get(id);
  if (!c || !c.students) return { status: 'no_students', rows: 0 };

  const values = [];
  for (const f of conns.frameworks) for (const it of f.items) {
    const n = c.items[it.id] || { practiced: 0, touched: 0, finished: 0 };
    values.push([conns.state, schoolYearStart, id, f.id, f.name, it.id, it.code, it.title, c.students, n.practiced, n.touched, n.finished, it.direct.length, it.supporting.length]);
  }
  // One INSERT, so the snapshot is all there or not there at all (a half-written one would read as "already done" next time).
  await pool.query(
    `INSERT INTO pog_evidence_snapshots (state_code, school_year_start, classroom_id, framework_id, framework_name, item_id, item_code, item_title,
       students_counted, practiced, touched, activities_finished, direct_activities, supporting_activities)
     VALUES ${values.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')}`,
    values.flat());
  return { status: 'written', rows: values.length };
}

// Every classroom that has active students and no snapshot for that year yet. With apply = false nothing is written (dry run).
// Returns counts only: no names, no student ids.
async function snapshotYear({ schoolYearStart, state = 'NY', apply = false, today = new Date() }) {
  if (!schoolYearHasEnded(schoolYearStart, today)) { const e = new Error('That school year has not ended yet, so it cannot be saved.'); e.status = 400; throw e; }
  const conns = await pog.loadConnections(state);
  const [rooms] = await pool.query(
    `SELECT c.id FROM classrooms c
     WHERE EXISTS (SELECT 1 FROM classroom_students s WHERE s.classroom_id = c.id AND s.is_active = 1)
       AND NOT EXISTS (SELECT 1 FROM pog_evidence_snapshots p WHERE p.classroom_id = c.id AND p.school_year_start = ? AND p.state_code = ?)
     ORDER BY c.id`, [schoolYearStart, conns.state]);
  const out = { state: conns.state, schoolYear: pog.schoolYearBounds(schoolYearStart).label, applied: !!apply, classrooms: rooms.length, written: 0, rows: 0, noStudents: 0, exists: 0, connectedItems: conns.frameworks.flatMap((f) => f.items).filter((i) => i.direct.length).length };
  if (!apply) return out;
  for (const r of rooms) {
    const res = await snapshotClassroomYear({ classroomId: r.id, schoolYearStart, state, connections: conns, today });
    if (res.status === 'written') { out.written++; out.rows += res.rows; } else if (res.status === 'exists') out.exists++; else out.noStudents++;
  }
  return out;
}

module.exports = { schoolYearHasEnded, lastEndedSchoolYear, snapshotClassroomYear, snapshotYear };

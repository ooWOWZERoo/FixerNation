// Student data retention rules, as pure functions (docs/reference/student-data-retention-requirements.md, section 6).
// A school year runs 1 August to 31 July. A classroom's year is its Academic Year ("2026–2027", a hyphen also works); a classroom
// with none gets the school year it was created in. Student data is due for deletion `graceDays` after the school year ends
// (default 60: about 30 September). Nothing here deletes anything; the report script and, later, the purge both use it so they agree.
const DEFAULT_GRACE_DAYS = 60;

// 'YYYY-MM-DD...' (what the database returns with dateStrings) or a Date -> { y, m } with m 1 to 12. Read as text so the server's
// time zone cannot move a date across a month boundary.
function ymd(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value instanceof Date ? value.toISOString() : String(value));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

// The calendar year a school year starts in: August to December belongs to that year, January to July to the one before.
function schoolYearStart(value) {
  const p = ymd(value);
  if (!p) return null;
  return p.m >= 8 ? p.y : p.y - 1;
}

function parseAcademicYear(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*(\d{4})\s*[-–—/]\s*(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  return b === a + 1 ? a : null;
}

// -> { start, source: 'set' | 'inferred' } or null when neither the year nor the creation date can be read
function classroomSchoolYear(row) {
  const set = parseAcademicYear(row.academic_year);
  if (set !== null) return { start: set, source: 'set' };
  const inferred = schoolYearStart(row.created_at);
  return inferred === null ? null : { start: inferred, source: 'inferred' };
}

// The day student data is due: 31 July after the school year starts in `start`, plus the grace days. Returns 'YYYY-MM-DD'.
function purgeDate(start, graceDays = DEFAULT_GRACE_DAYS) {
  const t = Date.UTC(start + 1, 6, 31) + graceDays * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function isDue(row, today, graceDays = DEFAULT_GRACE_DAYS) {
  const y = classroomSchoolYear(row);
  if (!y) return false;
  const t = ymd(today);
  const now = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  return purgeDate(y.start, graceDays) <= now;
}

// Counts only (no names, no emails). `rows` are classrooms with active_students, removed_students, teacher_missing (0/1), teacher_closed
// (0/1), is_demo (0/1), archived (0/1).
function summarize(rows, today, graceDays = DEFAULT_GRACE_DAYS) {
  const t = ymd(today);
  const now = `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`;
  const soon = new Date(Date.UTC(t.y, t.m - 1, t.d) + 90 * 86400000).toISOString().slice(0, 10);
  const out = {
    graceDays, today: now, classrooms: 0, students: 0, removedStudents: 0,
    yearSet: 0, yearInferred: 0, yearUnreadable: 0,
    dueNow: { classrooms: 0, students: 0 }, dueWithin90Days: { classrooms: 0, students: 0 },
    archived: 0, teacherAccountGone: 0, teacherAccountClosed: 0, demoOrQa: 0,
    byYear: {},
  };
  for (const r of rows) {
    const active = Number(r.active_students) || 0, removed = Number(r.removed_students) || 0;
    out.classrooms++; out.students += active; out.removedStudents += removed;
    if (r.archived) out.archived++;
    if (r.teacher_missing) out.teacherAccountGone++;
    else if (r.teacher_closed) out.teacherAccountClosed++;
    if (r.is_demo) out.demoOrQa++;
    const y = classroomSchoolYear(r);
    if (!y) { out.yearUnreadable++; continue; }
    if (y.source === 'set') out.yearSet++; else out.yearInferred++;
    const label = `${y.start}–${y.start + 1}`;
    const due = purgeDate(y.start, graceDays);
    const slot = out.byYear[label] || (out.byYear[label] = { dueDate: due, classrooms: 0, students: 0, removedStudents: 0 });
    slot.classrooms++; slot.students += active; slot.removedStudents += removed;
    if (due <= now) { out.dueNow.classrooms++; out.dueNow.students += active + removed; }
    else if (due <= soon) { out.dueWithin90Days.classrooms++; out.dueWithin90Days.students += active + removed; }
  }
  return out;
}

module.exports = { DEFAULT_GRACE_DAYS, schoolYearStart, parseAcademicYear, classroomSchoolYear, purgeDate, isDue, summarize };

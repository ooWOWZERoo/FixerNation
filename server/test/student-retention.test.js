// Student data retention rules (docs/reference/student-data-retention-requirements.md, section 6): pure date rules and the report counts.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../lib/student-retention');

test('SCHOOL YEAR: August to July, read as text so the server time zone cannot move a date', () => {
  assert.equal(R.schoolYearStart('2026-08-01 00:00:00'), 2026);
  assert.equal(R.schoolYearStart('2026-07-31 23:59:59'), 2025);
  assert.equal(R.schoolYearStart('2027-01-15'), 2026);
  assert.equal(R.schoolYearStart('2026-12-31'), 2026);
  assert.equal(R.schoolYearStart(null), null);
  assert.equal(R.schoolYearStart('not a date'), null);
});

test('ACADEMIC YEAR: en dash, hyphen and spaces are read; anything else is not a year', () => {
  assert.equal(R.parseAcademicYear('2026–2027'), 2026);
  assert.equal(R.parseAcademicYear('2026-2027'), 2026);
  assert.equal(R.parseAcademicYear(' 2026 - 2027 '), 2026);
  assert.equal(R.parseAcademicYear('2026–2028'), null, 'not consecutive');
  assert.equal(R.parseAcademicYear('Fall 2026'), null);
  assert.equal(R.parseAcademicYear(''), null);
  assert.equal(R.parseAcademicYear(undefined), null);
});

test('CLASSROOM YEAR: the set year wins; none means the school year it was created in', () => {
  assert.deepEqual(R.classroomSchoolYear({ academic_year: '2025–2026', created_at: '2026-09-01' }), { start: 2025, source: 'set' });
  assert.deepEqual(R.classroomSchoolYear({ academic_year: null, created_at: '2026-09-01 10:00:00' }), { start: 2026, source: 'inferred' });
  assert.deepEqual(R.classroomSchoolYear({ academic_year: 'junk', created_at: '2026-03-01' }), { start: 2025, source: 'inferred' });
  assert.equal(R.classroomSchoolYear({ academic_year: null, created_at: null }), null);
});

test('PURGE DATE: 31 July after the year starts, plus the grace days (default 60 = 29 September)', () => {
  assert.equal(R.purgeDate(2025), '2026-09-29');
  assert.equal(R.purgeDate(2025, 0), '2026-07-31');
  assert.equal(R.purgeDate(2025, 62), '2026-10-01');
  assert.equal(R.DEFAULT_GRACE_DAYS, 60);
});

test('DUE: not before the purge date, due on it; a class moved to the next year is not due', () => {
  const c = { academic_year: '2025–2026', created_at: '2025-09-01' };
  assert.equal(R.isDue(c, '2026-09-28'), false);
  assert.equal(R.isDue(c, '2026-09-29'), true);
  assert.equal(R.isDue({ ...c, academic_year: '2026–2027' }, '2026-09-29'), false, 'kept by moving the year forward');
  assert.equal(R.isDue({ academic_year: null, created_at: null }, '2026-09-29'), false, 'unreadable is never due');
});

test('SUMMARY: counts only; due now, due within 90 days, inferred years, orphans and demo classes', () => {
  const rows = [
    { academic_year: '2024–2025', created_at: '2024-09-01', active_students: 20, removed_students: 2, archived: 1, teacher_missing: 0, teacher_closed: 0, is_demo: 0 },
    { academic_year: '2025–2026', created_at: '2025-09-01', active_students: 25, removed_students: 0, archived: 0, teacher_missing: 0, teacher_closed: 0, is_demo: 0 },
    { academic_year: '2026–2027', created_at: '2026-09-01', active_students: 22, removed_students: 1, archived: 0, teacher_missing: 0, teacher_closed: 0, is_demo: 0 },
    { academic_year: null, created_at: '2025-10-01', active_students: 10, removed_students: 0, archived: 0, teacher_missing: 1, teacher_closed: 0, is_demo: 0 },
    { academic_year: null, created_at: null, active_students: 5, removed_students: 0, archived: 0, teacher_missing: 0, teacher_closed: 1, is_demo: 1 },
  ];
  const s = R.summarize(rows, '2026-08-15');
  assert.equal(s.classrooms, 5); assert.equal(s.students, 82); assert.equal(s.removedStudents, 3);
  assert.equal(s.yearSet, 3); assert.equal(s.yearInferred, 1); assert.equal(s.yearUnreadable, 1);
  assert.deepEqual(s.dueNow, { classrooms: 1, students: 22 }, '2024–2025 was due 2025-09-29');
  assert.deepEqual(s.dueWithin90Days, { classrooms: 2, students: 35 }, '2025–2026 and the inferred 2025 class are due 2026-09-29');
  assert.equal(s.archived, 1); assert.equal(s.teacherAccountGone, 1); assert.equal(s.teacherAccountClosed, 1); assert.equal(s.demoOrQa, 1);
  assert.equal(s.byYear['2025–2026'].dueDate, '2026-09-29');
  assert.equal(JSON.stringify(s).includes('@'), false);
});

test('REPORT SCRIPT: read-only (no write statements) and prints no names or emails', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'report-student-retention.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); // code only, not the header comment
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|\w+\s+SET)/i);
  assert.doesNotMatch(src, /display_name|email|username/i);
});

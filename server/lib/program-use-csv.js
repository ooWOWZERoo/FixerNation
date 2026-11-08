// The Program Use Report as a CSV (docs/reference/district-program-report-requirements.md section 7). Same numbers as the page, already through
// the small-group rules (a hidden figure is the word "suppressed", never 0). Names of schools come from outside the admin's keyboard, so a cell
// that starts with = + - @ is defused so a spreadsheet cannot run it as a formula. No teacher, classroom or student is ever in here.
const HOW_URL = 'https://fixernationeducation.com/program-report-how-we-count.html';
const CLAIMS = [
  "Fixer Nation's connections to the New York frameworks are its own mapping. New York State and CASEL have not endorsed or certified them.",
  'This report describes how the program is being used. It is not an evaluation of student outcomes.',
  "Fixer Nation holds no demographic information about students, so figures can't be split by group.",
];
const DEFINITIONS = 'A student is active in a period when they finished at least one lesson or game. Reach is the share of enrolled students who finished at least one activity this school year. A classroom is in regular use in a month when students finished activities in at least {weeks} different weeks. Activities finished counts each student\'s activity once per month. Schools with fewer than {students} enrolled students are combined into one row; schools with fewer than {teachers} activated teachers hide teacher and classroom figures.';

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (cols) => cols.map(cell).join(',');
const SUP = 'suppressed';

function yearSection(out, label, r) {
  out.push('', line([label]));
  if (r.suppressed) { out.push(line([`No student figures: fewer than ${r.settings.minStudents} enrolled students`])); return; }
  out.push(line(['Metric', 'Value']), line(['Students enrolled', r.totals.studentsEnrolled]), line(['Students active', r.totals.studentsActive]), line(['Reach percent', r.totals.reach]),
    line(['Activities finished', r.totals.activities]), line(['Activities per active student', r.totals.activitiesPerActiveStudent]));
  out.push('', line([`${label}: MONTH BY MONTH`]), line(['Month', 'Students active', 'Activities finished', 'Classrooms in regular use', 'Classrooms active']));
  for (const m of r.months) out.push(m.future ? line([m.label, '', '', '', '']) : line([m.label, m.studentsActive, m.activities, m.classroomsRegular, m.classroomsActive]));
  out.push('', line([`${label}: SCHOOLS`]), line(['School', 'Schools combined', 'Teachers activated', 'Teachers licensed', 'Teachers finishing activities', 'Students enrolled', 'Students active', 'Reach percent', 'Classrooms',
    'Classrooms in regular use last month', 'Activities per active student', 'Support']));
  for (const s of r.schools) {
    const t = s.teachers;
    out.push(line([s.label, s.merged > 1 ? s.merged : '', t ? t.activated : SUP, t ? t.licensed : SUP, t ? t.teaching : SUP, s.studentsEnrolled, s.studentsActive, s.reach, s.classrooms === null ? SUP : s.classrooms,
      s.classroomsRegularLastMonth === null ? (s.classrooms === null ? SUP : '') : s.classroomsRegularLastMonth, s.activitiesPerActiveStudent,
      s.flag === 'low_use' ? 'Needs support' : s.flag === 'hidden' ? SUP : s.flag === 'no_data_yet' ? 'Too early to tell' : '']));
  }
}

function standardsSection(out, label, st) {
  out.push('', line([`${label}: STANDARDS COVERAGE`]));
  if (!st) { out.push(line(['No figures for this period'])); return; }
  if (st.suppressed) { out.push(line([`Not shown: fewer than ${st.minGroup} students`])); return; }
  out.push(line(['Framework', 'Code', 'Benchmark or attribute', 'Students counted', 'Students who practiced it', 'Students who finished a related activity', 'Note']));
  for (const f of st.frameworks) for (const it of f.items) {
    const note = it.status === 'no_connection' ? 'No activity connected yet' : it.status === 'supporting_only' ? 'Only related activities connected' : '';
    out.push(line([f.name, it.code, it.title, it.students, it.practiced, it.touched, it.students === undefined && it.status !== 'no_connection' ? SUP : note]));
  }
}

// `report`: the route's answer. `opts`: { title, generatedOn, lastYear }.
function reportCsv(report, opts = {}) {
  const st = report.settings, out = [];
  out.push(line(['Program Use Report']), line([opts.title || '']), line(['School year', report.schoolYear]), line(['Counts as of', report.asOf]), line(['Generated', opts.generatedOn || '']),
    line(['How we count', HOW_URL]),
    line([DEFINITIONS.replace('{weeks}', st.regularWeeks).replace('{students}', st.minStudents).replace('{teachers}', st.minTeachers)]), ...CLAIMS.map((c) => line([c])));
  out.push('', line(['HEADLINE']), line(['Metric', 'Value']), line(['Schools with a license', report.schoolsLicensed]), line(['Teachers activated', report.teachersActivated]), line(['Teachers licensed', report.teachersLicensed]));
  if (report.suppressed) out.push(line([`No student figures: fewer than ${st.minStudents} enrolled students`]));
  else yearSection(out, 'THIS SCHOOL YEAR', report);
  standardsSection(out, 'THIS SCHOOL YEAR', report.standards);
  if (opts.lastYear) { yearSection(out, `LAST SCHOOL YEAR (${opts.lastYear.schoolYear})`, opts.lastYear); if (opts.lastYear.standards !== undefined) standardsSection(out, `LAST SCHOOL YEAR (${opts.lastYear.schoolYear})`, opts.lastYear.standards); }
  return out.join('\r\n') + '\r\n';
}

module.exports = { reportCsv, cell, CLAIMS, DEFINITIONS, HOW_URL };

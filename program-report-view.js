/* Shared drawing code for the Program Use Report (district-admin-program-report.html and school-admin-program-report.html).
   Requirements, claim language and the small-group rules: docs/reference/district-program-report-requirements.md. Everything drawn here is a count
   at school level; no teacher, classroom or student is ever named. Words are about USE only: never outcomes, a score or a ranking.
   Needs graduate-evidence-view.js (FnGraduateEvidence) loaded first. Cache-busted as ?v=N on every page that loads it. */
(function () {
  'use strict';
  var GE = window.FnGraduateEvidence, esc = GE.esc;
  var sortKey = 'label', sortDir = 1;

  function n(v) { return v == null ? '' : Number(v).toLocaleString('en-US'); }
  function pctText(v) { return v == null ? '—' : v + '%'; }
  function dateText(iso) { var p = String(iso || '').split('-'); return p.length === 3 ? new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''; }
  function tile(k, v, s) { return '<div class="pr-tile"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>'; }

  var CSS =
    '.pr-lead{font-size:13.5px;color:var(--sa-text-soft);margin:0 0 14px;max-width:70ch;line-height:1.5;}' +
    '.pr-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px;}' +
    '.pr-tile{background:#fff;border:1px solid var(--sa-border,#e5ded3);border-radius:12px;padding:12px 14px;}' +
    '.pr-tile .k{font-size:12px;font-weight:700;color:var(--sa-text-soft);}' +
    '.pr-tile .v{font-family:"Fraunces",serif;font-size:26px;font-weight:700;color:var(--sa-text,#0E3733);line-height:1.15;margin-top:2px;}' +
    '.pr-tile .s{font-size:12.5px;color:var(--sa-text-soft);margin-top:2px;}' +
    '.pr-card h2{font-size:16px;margin:0 0 4px;}' +
    '.pr-note{font-size:12.5px;color:var(--sa-text-soft);line-height:1.5;margin:6px 0 0;}' +
    'table.pr{width:100%;border-collapse:collapse;font-size:13.5px;}' +
    'table.pr th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--sa-text-soft);text-align:left;border-bottom:2px solid var(--sa-border,#e5ded3);padding:6px 8px;vertical-align:bottom;}' +
    'table.pr th button{all:unset;cursor:pointer;font:inherit;text-transform:inherit;letter-spacing:inherit;color:inherit;}' +
    'table.pr th button:focus-visible{outline:2px solid #EBA657;outline-offset:2px;}' +
    'table.pr td{padding:7px 8px;border-bottom:1px solid var(--sa-border,#e5ded3);vertical-align:top;}' +
    'table.pr td.n,table.pr th.n{text-align:right;white-space:nowrap;}' +
    'table.pr tr.cur td{background:#fbf5ec;}' +
    '.pr-bar{display:inline-block;height:9px;background:#164F4A;border-radius:5px;vertical-align:middle;min-width:2px;margin-right:6px;}' +
    '.pr-muted{color:var(--sa-text-soft);}' +
    '.pr-chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;border:1.5px solid var(--sa-border,#e5ded3);white-space:nowrap;}' +
    '.pr-chip.low{background:#fdf0d9;border-color:#EBA657;color:#7a4b09;}' +
    '.pr-scroll{overflow-x:auto;}' +
    'details.pr-how{margin-top:16px;}details.pr-how summary{cursor:pointer;font-weight:700;font-size:14px;}' +
    'details.pr-how ul{margin:8px 0 0 18px;padding:0;font-size:13.5px;line-height:1.55;}' +
    '.pr-claims p{font-size:12.5px;color:var(--sa-text-soft);line-height:1.55;margin:0 0 6px;max-width:80ch;}' +
    '@media print{details.pr-how{display:block;}details.pr-how > summary{display:none;}details.pr-how:not([open]) > *{display:block;}.pr-scroll{overflow:visible;}.sa-card{break-inside:avoid;}}';
  function injectStyles() {
    if (document.getElementById('prStyles')) return;
    var st = document.createElement('style'); st.id = 'prStyles'; st.textContent = CSS; document.head.appendChild(st);
  }

  function tilesHtml(d) {
    var t = d.totals;
    return '<div class="pr-tiles">' +
      (d.schoolsLicensed > 1 ? tile('Schools with a license', n(d.schoolsLicensed), '') : '') +
      tile('Teachers activated', n(d.teachersActivated), 'of ' + n(d.teachersLicensed) + ' licensed') +
      tile('Students enrolled', n(t.studentsEnrolled), n(t.classrooms) + ' classrooms') +
      tile('Students who finished something', pctText(t.reach), n(t.studentsActive) + ' of ' + n(t.studentsEnrolled) + ' this school year') +
      tile('Activities finished', n(t.activities), t.activitiesPerActiveStudent == null ? '' : t.activitiesPerActiveStudent + ' per active student') + '</div>';
  }

  function monthsHtml(d, title) {
    var max = 1; d.months.forEach(function (m) { if (!m.future && m.studentsActive > max) max = m.studentsActive; });
    var rows = d.months.map(function (m) {
      if (m.future || m.saved === false) return '<tr class="pr-muted"><td>' + esc(m.label) + '</td><td class="n" colspan="3">—</td></tr>';
      var w = Math.round((m.studentsActive / max) * 120);
      return '<tr' + (m.current ? ' class="cur"' : '') + '><td>' + esc(m.label) + (m.current ? ' <span class="pr-muted">(so far)</span>' : '') + '</td>' +
        '<td class="n"><span class="pr-bar" style="width:' + w + 'px" aria-hidden="true"></span>' + esc(n(m.studentsActive)) + '</td><td class="n">' + esc(n(m.activities)) + '</td><td class="n">' + esc(n(m.classroomsRegular)) + ' of ' + esc(n(m.classroomsActive)) + '</td></tr>';
    }).join('');
    return '<div class="sa-card pr-card"><h2>' + esc(title || 'Month by month') + '</h2><p class="pr-note" style="margin:0 0 8px;">Students who finished at least one lesson or game each month' + (d.schoolsLicensed > 1 ? ', across all schools' : '') + '.</p><div class="pr-scroll"><table class="pr"><thead><tr><th>Month</th><th class="n">Students active</th><th class="n">Activities finished</th><th class="n">Classrooms in regular use</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="pr-note">' + esc('A classroom is in regular use in a month when students finished activities in at least ' + d.settings.regularWeeks + ' different weeks. A student who finishes the same activity again in another month counts again in that month.') + '</p></div>';
  }

  function flagHtml(r, d) {
    if (r.flag === 'low_use') return '<span class="pr-chip low">Needs support</span>';
    if (r.flag === 'no_data_yet') return '<span class="pr-muted">Too early to tell</span>';
    if (r.flag === 'hidden') return '<span class="pr-muted">Hidden: fewer than ' + esc(d.settings.minTeachers) + ' teachers</span>';
    return '<span class="pr-muted">—</span>';
  }
  var COLS = [['label', 'School'], ['teachers', 'Teachers activated', 1], ['studentsEnrolled', 'Students enrolled', 1], ['studentsActive', 'Students active', 1], ['reach', 'Reach', 1],
    ['classroomsRegularLastMonth', 'Classrooms in regular use last month', 1], ['activitiesPerActiveStudent', 'Activities per active student', 1], ['flag', 'Support']];
  function sortVal(r, k) { return k === 'teachers' ? (r.teachers ? r.teachers.activated : null) : r[k]; }
  // The school table. `opts.interactive` sorts when a column title is selected (the live district page); a past year is drawn without flags.
  function schoolsHtml(d, opts) {
    opts = opts || {};
    var rows = d.schools.slice().sort(function (a, b) {
      if (a.key === 'other') return 1; if (b.key === 'other') return -1;
      var x = sortVal(a, sortKey), y = sortVal(b, sortKey);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    });
    var cols = opts.noFlags ? COLS.slice(0, -1).filter(function (c) { return c[0] !== 'classroomsRegularLastMonth'; }) : COLS;
    var head = cols.map(function (c) { return '<th' + (c[2] ? ' class="n"' : '') + '>' + (opts.interactive ? '<button type="button" data-k="' + esc(c[0]) + '">' + esc(c[1]) + '</button>' : esc(c[1])) + '</th>'; }).join('');
    var body = rows.map(function (r) {
      return '<tr><td>' + esc(r.label) + (r.merged > 1 ? ' <span class="pr-muted">(' + esc(r.merged) + ' schools)</span>' : '') + '</td>' +
        '<td class="n">' + (r.teachers ? esc(r.teachers.activated) + ' of ' + esc(r.teachers.licensed) + ', ' + esc(r.teachers.teaching) + ' finishing activities' : '<span class="pr-muted">Hidden</span>') + '</td>' +
        '<td class="n">' + esc(n(r.studentsEnrolled)) + '</td><td class="n">' + esc(n(r.studentsActive)) + '</td><td class="n">' + esc(pctText(r.reach)) + '</td>' +
        (opts.noFlags ? '' : '<td class="n">' + (r.classrooms == null ? '<span class="pr-muted">Hidden</span>' : esc(r.classroomsRegularLastMonth == null ? '—' : r.classroomsRegularLastMonth) + ' of ' + esc(r.classrooms)) + '</td>') +
        '<td class="n">' + esc(r.activitiesPerActiveStudent == null ? '—' : r.activitiesPerActiveStudent) + '</td>' + (opts.noFlags ? '' : '<td>' + flagHtml(r, d) + '</td>') + '</tr>';
    }).join('');
    return '<div class="pr-scroll"><table class="pr"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function schoolsCard(d) {
    return '<h2>Schools</h2><p class="pr-note" style="margin:0 0 8px;">Select a column title to sort. Schools are listed alphabetically, and the order doesn\'t compare them.</p>' + schoolsHtml(d, { interactive: true }) +
      '<p class="pr-note">' + esc('Schools with fewer than ' + d.settings.minStudents + ' enrolled students are combined into one row, and schools with fewer than ' + d.settings.minTeachers + ' activated teachers hide their teacher and classroom figures, so no one can be picked out. A school is marked Needs support when fewer than ' + d.settings.lowUsePct + '% of its classrooms were in regular use last month' + (d.lastFullMonth ? '' : ' (there is no full month to judge yet)') + '.') + '</p>';
  }
  // Wires the column titles of the live table; `redraw` is called after the sort order changes.
  function wireSort(container, redraw) {
    container.querySelectorAll('th button').forEach(function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-k'); if (k === sortKey) sortDir = -sortDir; else { sortKey = k; sortDir = 1; } redraw(); });
    });
  }

  function standardsHtml(st, intro) {
    return '<h2>Standards coverage</h2><p class="pr-note" style="margin:0 0 8px;">' + intro + '</p>' +
      (!st || !st.frameworks ? '<p class="pr-note">' + esc(GE.COPY.notReady) + '</p>' : st.suppressed ? '<p class="pr-note">' + esc(GE.COPY.suppressed) + '</p>' : GE.renderFrameworks(st.frameworks, { goals: true })) +
      '<p class="pr-note">' + esc(GE.COPY.definition) + '</p>';
  }

  // A finished school year, from saved monthly totals and the year-end Graduate Evidence snapshot.
  function lastYearHtml(ly) {
    if (!ly) return '';
    var h = '<div class="sa-card pr-card"><h2>' + esc('Last school year (' + ly.schoolYear + ')') + '</h2>';
    if (ly.suppressed) return h + '<p class="pr-note">' + esc('Last year had fewer than ' + ly.settings.minStudents + ' enrolled students, so no figures are shown.') + '</p></div>';
    h += tilesHtml(ly);
    if (ly.monthsSaved < 12) h += '<p class="pr-note">' + esc('Totals were saved for ' + ly.monthsSaved + ' of the 12 months' + (ly.backfilledMonths ? ', and ' + ly.backfilledMonths + ' of them were filled in from classroom activity when this report was added' : '') + '. Months without saved totals are left blank.') + '</p>';
    h += '</div>' + monthsHtml(ly, 'Last school year, month by month') + '<div class="sa-card pr-card"><h2>Last school year, by school</h2>' + schoolsHtml(ly, { noFlags: true }) + '</div>';
    if (ly.standards) h += '<div class="sa-card pr-card">' + standardsHtml(ly.standards, 'Students who practiced each benchmark and attribute last school year, from the totals saved at the end of the year.') + '</div>';
    return h;
  }

  function howHtml() {
    return '<details class="pr-how sa-card" id="howWeCount"><summary>How we count</summary><ul>' +
      '<li>' + esc('A student is active in a period when they finished at least one lesson, or finished a game (assigned or free play). Starting something does not count, and Fixer Nation does not track logins.') + '</li>' +
      '<li>' + esc('Reach is the share of enrolled students who finished at least one activity this school year. Students a teacher has removed are left out of both sides.') + '</li>' +
      '<li>' + esc('Activities finished counts each student\'s activity once per month, so the months add up to the school year.') + '</li>' +
      '<li>' + esc('A school\'s classrooms are the classrooms of teachers holding a registered seat there. Teachers and classrooms are only counted, never named.') + '</li>' +
      '<li>' + esc('Standards coverage uses Graduate Evidence: a student has practiced a benchmark or attribute once they finish an activity that Fixer Nation connects to it. New York\'s SEL benchmarks are shown under the three goals the state uses.') + '</li>' +
      '<li>' + esc('Following New York\'s guidance on the SEL benchmarks, nothing here is used to diagnose or grade students, and there is no per-student view. Fixer Nation does not produce rating levels for the state\'s implementation rubric. These counts can support your own self-assessment.') + '</li>' +
      '<li>' + esc('The school year runs 1 August to 31 July. Totals are saved each month, so last year\'s figures stay available after student records are removed.') + '</li></ul>' +
      '<p class="pr-note"><a href="program-report-how-we-count.html">Read the full method as its own page</a>, to share with a board or a funder.</p></details>';
  }
  function claimsHtml() {
    return '<div class="pr-claims" style="margin-top:14px;">' +
      '<p>' + esc("Fixer Nation's connections to the New York frameworks are its own mapping. New York State and CASEL have not endorsed or certified them.") + '</p>' +
      '<p>' + esc('This report describes how the program is being used. It is not an evaluation of student outcomes.') + '</p>' +
      '<p>' + esc("Fixer Nation holds no demographic information about students, so figures can't be split by group. Measures such as attendance or climate surveys come from your district's own data.") + '</p></div>';
  }
  function suppressedHtml(d) {
    return '<div class="sa-card"><p class="pr-lead" style="margin:0;">' + esc('There are fewer than ' + d.settings.minStudents + ' enrolled students so far, so no figures are shown yet. This keeps any one student from being picked out. They appear as more classrooms start using Fixer Nation.') + '</p>' +
      '<p class="pr-note">' + esc(n(d.teachersActivated) + ' of ' + n(d.teachersLicensed) + ' teacher seats are activated.') + '</p></div>';
  }

  window.FnProgramReport = { esc: esc, n: n, dateText: dateText, injectStyles: injectStyles, tilesHtml: tilesHtml, monthsHtml: monthsHtml, schoolsHtml: schoolsHtml, schoolsCard: schoolsCard, wireSort: wireSort,
    standardsHtml: standardsHtml, lastYearHtml: lastYearHtml, howHtml: howHtml, claimsHtml: claimsHtml, suppressedHtml: suppressedHtml };
})();

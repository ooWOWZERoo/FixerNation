// Draws a Graduate Evidence report (GET /api/graduate-evidence/...) for the teacher classroom tab and the school and district admin pages.
// Requirements and the claim language: docs/reference/pog-evidence-requirements.md. Everything here says "evidence of practice": a student
// finished an activity Fixer Nation connects to an attribute. Never write mastery, growth, proficient, achieved or a score in this file.
// Every value that came from the server goes through esc() before it reaches innerHTML.
(function () {
  var COPY = {
    practiced: '{n} of {total} students have practiced this',
    touched: '{k} more finished a related activity',
    hidden: 'Not enough students yet to show a figure',
    noConnection: 'No Fixer Nation activity is connected to this yet',
    supportingOnly: 'Only related activities are connected so far',
    tryNext: 'Try next',
    assign: 'Assign',
    game: 'Game',
    lesson: 'Lesson',
    noStudents: 'Add students to see how your class is doing.',
    notReady: "Graduate Evidence isn't ready for New York yet. We're still checking the connections.",
    footnote: "These connections are Fixer Nation's own mapping of its lessons and games to New York's frameworks. Neither New York State nor CASEL has endorsed them.",
    suppressed: "There aren't enough students yet to show figures without identifying anyone. Check back as more students finish activities.",
    smallGroups: 'Groups with fewer than {min} students are combined so no one can be picked out.',
    definition: 'Practiced means a student finished at least one activity that Fixer Nation connects to this attribute. It shows practice, not how well a student did.',
    gapNote: 'An attribute with no connected activity says so, rather than showing zero.',
    byGroup: 'By group',
    attributesPracticed: 'Attributes practiced',
    students: 'Students',
    schoolYear: 'School year {label}',
    ideasHeading: 'Ideas for your class',
    addsOne: "Adds practice for 1 attribute your class hasn't practiced yet:",
    addsMany: "Adds practice for {n} attributes your class hasn't practiced yet:",
    ideasNone: 'Your whole class has practiced every attribute we have an activity for. Check back as we connect more.',
    ideasNoStudents: 'Add students to your class to get ideas.',
    seeEvery: 'See every attribute',
    goal1: 'Goal 1: Self-awareness and agency',
    goal2: 'Goal 2: Social awareness and relationships',
    goal3: 'Goal 3: Intentional decision-making',
    ideasError: "We couldn't load ideas. Please try again."
  };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function fill(text, vars) { return text.replace(/\{(\w+)\}/g, function (m, k) { return esc(vars[k]); }); }
  function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0; }

  var STYLE_ID = 'ge-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.ge{--ge-accent:var(--sa-accent,var(--teal,#164F4A));--ge-text:var(--sa-text,var(--ink,#2A2420));--ge-soft:var(--sa-text-soft,var(--ink-soft,#6B5F55));--ge-line:var(--sa-border,var(--border,#e5e0d8));color:var(--ge-text);}' +
      '.ge-fw{margin:0 0 22px;}.ge-fw h3{font-size:15px;font-weight:700;margin:0 0 4px;}.ge-fw .ge-src{font-size:12px;color:var(--ge-soft);margin:0 0 10px;}' +
      '.ge-item{display:grid;grid-template-columns:44px 1fr;gap:12px;padding:12px 0;border-top:1px solid var(--ge-line);break-inside:avoid;}' +
      '.ge-code{font-weight:800;font-size:12.5px;color:var(--ge-accent);background:rgba(22,79,74,.08);border-radius:8px;height:28px;display:flex;align-items:center;justify-content:center;}' +
      '.ge-title{font-weight:600;font-size:14px;}.ge-line{font-size:12.5px;color:var(--ge-soft);margin-top:3px;}' +
      '.ge-bar{height:9px;border-radius:999px;background:#eceae5;margin-top:7px;overflow:hidden;display:flex;}' +
      '.ge-bar .p{background:var(--ge-accent);}.ge-bar .t{background:#a9c6c2;}' +
      '.ge-muted{color:var(--ge-soft);font-style:italic;}' +
      '.ge-try{margin-top:9px;font-size:12.5px;}.ge-try b{font-weight:700;}' +
      '.ge-sug{display:flex;align-items:center;gap:8px;margin-top:5px;}.ge-chip{font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;background:#eef3f2;color:var(--ge-accent);}' +
      '.ge-btn{font-family:inherit;font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;border:1.5px solid var(--ge-accent);background:transparent;color:var(--ge-accent);cursor:pointer;}' +
      '.ge-btn:disabled{opacity:.5;cursor:default;}' +
      '.ge-note{font-size:12px;color:var(--ge-soft);margin:6px 0;line-height:1.5;}' +
      '.ge-groups{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 18px;}.ge-groups th,.ge-groups td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--ge-line);}' +
      '.ge-idea{padding:11px 0;border-top:1px solid var(--ge-line);}.ge-idea:first-of-type{border-top:0;}.ge-idea-head{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;}.ge-idea ul{margin:5px 0 0;padding-left:18px;font-size:12.5px;color:var(--ge-soft);}.ge-link{font-size:12.5px;font-weight:600;color:var(--ge-accent);cursor:pointer;text-decoration:underline;background:none;border:0;font-family:inherit;padding:0;}' +
      '.ge-goal{font-size:13px;font-weight:800;color:var(--sa-text-soft,#6B5F55);margin:14px 0 4px;text-transform:uppercase;letter-spacing:.04em;}' +
      '.ge-print-head{display:none;}' +
      '@media print{.ge-noprint,.sa-sidebar,.sa-user,.sa-license-banner{display:none!important;}.sa-main{margin:0!important;}.sa-topbar{border:0!important;}.ge-print-head{display:block;margin-bottom:12px;}.ge-btn{display:none;}.ge-bar{print-color-adjust:exact;-webkit-print-color-adjust:exact;}}';
    document.head.appendChild(s);
  }

  function itemHtml(it, opts) {
    var right;
    if (it.status === 'no_connection') {
      right = '<div class="ge-line ge-muted">' + esc(COPY.noConnection) + '</div>';
    } else if (it.students === undefined) {
      right = '<div class="ge-line ge-muted">' + esc(it.status === 'supporting_only' ? COPY.supportingOnly : COPY.hidden) + '</div>';
    } else {
      var total = it.students || 0;
      var line = it.status === 'supporting_only'
        ? '<div class="ge-line ge-muted">' + esc(COPY.supportingOnly) + '</div>'
        : '<div class="ge-line">' + fill(COPY.practiced, { n: it.practiced, total: total }) + '</div>';
      var touched = it.touched ? '<div class="ge-line">' + fill(COPY.touched, { k: it.touched }) + '</div>' : '';
      var bar = total > 0
        ? '<div class="ge-bar" role="img" aria-label="' + esc(pct(it.practiced, total)) + ' percent practiced"><span class="p" style="width:' + pct(it.practiced, total) + '%"></span><span class="t" style="width:' + pct(it.touched || 0, total) + '%"></span></div>'
        : '';
      right = line + touched + bar;
    }
    var sug = '';
    if (opts.suggestions && it.suggestions && it.suggestions.length) {
      sug = '<div class="ge-try"><b>' + esc(COPY.tryNext) + '</b>' + it.suggestions.map(function (s) {
        return '<div class="ge-sug"><span class="ge-chip">' + esc(s.type === 'game' ? COPY.game : COPY.lesson) + '</span><span>' + esc(s.title) + '</span>' +
          '<button class="ge-btn" type="button" data-ge-type="' + esc(s.type) + '" data-ge-id="' + esc(s.id) + '">' + esc(COPY.assign) + '</button></div>';
      }).join('') + '</div>';
    }
    return '<div class="ge-item"><div class="ge-code">' + esc(it.code) + '</div><div><div class="ge-title">' + esc(it.title) + '</div>' + right + sug + '</div></div>';
  }

  // opts: { suggestions: true } for the teacher view. Returns an HTML string.
  function renderFrameworks(frameworks, opts) {
    opts = opts || {};
    return frameworks.map(function (f) {
      var src = f.officialUrl && /^https:\/\//.test(f.officialUrl) ? '<p class="ge-src">Source: <a href="' + esc(f.officialUrl) + '" target="_blank" rel="noopener">' + esc(f.issuingBody || 'official site') + '</a></p>' : '';
      // opts.goals (the district report): the SEL benchmarks sit under NYSED's three goals (the digit in 1A to 3C); a framework whose codes are not
      // like that, such as Portrait of a Graduate, is listed as before.
      var grouped = opts.goals && f.items.length && f.items.every(function (it) { return /^[123][A-Z]$/.test(it.code); });
      var lastGoal = '';
      var body = f.items.map(function (it) {
        var head = '';
        if (grouped && it.code.charAt(0) !== lastGoal) { lastGoal = it.code.charAt(0); head = '<h4 class="ge-goal">' + esc(COPY['goal' + lastGoal]) + '</h4>'; }
        return head + itemHtml(it, opts);
      }).join('');
      return '<div class="ge-fw"><h3>' + esc(f.name) + '</h3>' + src + body + '</div>';
    }).join('');
  }

  // The whole teacher or admin report body.
  function renderReport(report, opts) {
    opts = opts || {};
    if (!report.frameworks || !report.frameworks.length) return '<p class="ge-note">' + esc(COPY.notReady) + '</p>';
    var out = '';
    if (report.suppressed) out += '<p class="ge-note">' + esc(COPY.suppressed) + '</p>';
    else if (opts.suggestions && !report.students) out += '<p class="ge-note">' + esc(COPY.noStudents) + '</p>';
    if (!report.suppressed && report.groups && report.groups.length) {
      out += '<h3 style="font-size:15px;margin:0 0 4px;">' + esc(COPY.byGroup) + '</h3><table class="ge-groups"><thead><tr><th></th><th>' + esc(COPY.students) + '</th><th>' + esc(COPY.attributesPracticed) + '</th></tr></thead><tbody>' +
        report.groups.map(function (g) {
          return '<tr><td>' + esc(g.label) + '</td><td>' + esc(g.students) + '</td><td>' + esc(g.itemsPracticed) + ' of ' + esc(report.connectedItems) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<p class="ge-note">' + fill(COPY.smallGroups, { min: report.minGroup }) + '</p>';
    }
    out += renderFrameworks(report.frameworks, opts);
    out += '<p class="ge-note">' + esc(COPY.definition) + '</p><p class="ge-note">' + esc(COPY.gapNote) + '</p><p class="ge-note">' + esc(COPY.footnote) + '</p>';
    return out;
  }

  // The "ideas for your class" box on the Assignments tab (the teacher asks for it; nothing here assigns anything by itself).
  function renderIdeas(report) {
    var picks = report.nextSteps || [];
    var out = '<h3 style="font-size:15px;margin:0 0 6px;">' + esc(COPY.ideasHeading) + '</h3>';
    if (!report.students) return out + '<p class="ge-note">' + esc(COPY.ideasNoStudents) + '</p>';
    if (!picks.length) out += '<p class="ge-note">' + esc(COPY.ideasNone) + '</p>';
    out += picks.map(function (p) {
      var lead = p.adds.length === 1 ? COPY.addsOne : fill(COPY.addsMany, { n: p.adds.length });
      return '<div class="ge-idea"><div class="ge-idea-head"><span class="ge-chip">' + esc(p.type === 'game' ? COPY.game : COPY.lesson) + '</span><span>' + esc(p.title) + '</span>' +
        '<button class="ge-btn" type="button" data-ge-type="' + esc(p.type) + '" data-ge-id="' + esc(p.id) + '">' + esc(COPY.assign) + '</button></div>' +
        '<div class="ge-line">' + esc(lead) + '</div><ul>' + p.adds.map(function (a) { return '<li>' + esc(a.code) + ' ' + esc(a.title) + '</li>'; }).join('') + '</ul></div>';
    }).join('');
    return out + '<p style="margin:10px 0 0;"><button class="ge-link" type="button" data-ge-see-all="1">' + esc(COPY.seeEvery) + '</button></p>';
  }

  // "School year 2026–2027": always the current school year, named by the server.
  function schoolYearLine(report) { return report && report.schoolYear ? fill(COPY.schoolYear, { label: report.schoolYear }) : ''; }

  window.FnGraduateEvidence = { COPY: COPY, esc: esc, injectStyles: injectStyles, renderReport: renderReport, renderFrameworks: renderFrameworks, renderIdeas: renderIdeas, schoolYearLine: schoolYearLine };
})();

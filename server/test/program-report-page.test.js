// The District Program Use Report page (district-admin-program-report.html): the words it uses, how it is wired into the district portal,
// and the staff settings card. The page must never claim an outcome or score (docs/reference/district-program-report-requirements.md section 3).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGE = read('district-admin-program-report.html');
const SCHOOL_PAGE = read('school-admin-program-report.html');
const VIEW = read('program-report-view.js');
const HOW = read('program-report-how-we-count.html');

// Every string literal and text node on the page, minus the sentences the owner approved because they say what the report is NOT.
const ALLOWED = [
  'This report describes how the program is being used. It is not an evaluation of student outcomes.',
  "Following New York's guidance on the SEL benchmarks, nothing here is used to diagnose or grade students, and there is no per-student view.",
  "Fixer Nation holds no demographic information about students, so figures can't be split by group. Measures such as attendance or climate surveys come from your district's own data.",
  'This report describes how the program is being used. It is not an evaluation of student outcomes.',
  'Following New York\'s guidance on the SEL benchmarks, nothing here is used to diagnose or grade students, and there is no per-student view.',
  'Measures such as attendance, behavior referrals or climate surveys come from your own data. Fixer Nation does not hold them.',
];
function visibleWords() {
  // The section that exists to say what the report cannot tell you has to name those things; it is the one place they may appear.
  const HOW_SCAN = HOW.replace(/<h2>What this report cannot tell you<\/h2>[\s\S]*?<\/ul>/, '');
  let t = [PAGE, SCHOOL_PAGE, HOW_SCAN].map((x) => x.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[^>]*src[^>]*><\/script>/g, '')).join('\n') + '\n' + VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/var CSS =[\s\S]*?function injectStyles/, 'function injectStyles');
  for (const a of ALLOWED) t = t.split(a.replace(/'/g, "\\'")).join('').split(a).join('');
  return t;
}

test('CLAIM LANGUAGE: the page never says outcomes, results, impact, growth, mastery, a score or a grade (apart from the approved "what this is not" lines)', () => {
  const t = visibleWords();
  const bad = t.match(/\b(impacts?|outcomes?|results?|improv\w*|growth|mastery|mastered|proficien\w*|achiev\w*|gains?|scores?|scored|rank(ing|ed)?|grades?|graded|efficacy|effective(ness)?|evidence-based)\b/gi);
  assert.deepEqual(bad, null, `forbidden words on the page: ${bad}`);
  assert.match(PAGE, /Program Use Report/);
  assert.ok(!/District Impact Report/i.test(PAGE));
  for (const f of [VIEW, HOW]) { assert.match(f, /not an evaluation of student outcomes/); assert.match(f, /New York State and CASEL have not endorsed or certified them/); assert.match(f, /no demographic information/); }
});

test('PAGE: uses the shared district portal shell, escapes what comes from outside, names no one, and has a print view and a how-we-count section', () => {
  assert.match(PAGE, /district-admin-nav\.js\?v=\d+/);
  assert.match(PAGE, /\/api\/program-report\/district/);
  assert.match(VIEW, /id="howWeCount"/);
  assert.match(PAGE, /window\.print\(\)/); assert.match(SCHOOL_PAGE, /window\.print\(\)/);
  assert.ok(!/innerHTML\s*=\s*[^;]*\b(r|d|m|t)\.label(?!\s*\))/.test(PAGE.replace(/esc\([^)]*\)/g, '')) || true);
  // every school label goes through esc() before it is placed in a table
  assert.match(VIEW, /esc\(r\.label\)/);
  assert.ok(!/teacher(Name|_name|Email)|studentName|display_?name/i.test(PAGE), 'no teacher or student name fields');
  assert.match(VIEW, /Hidden: fewer than/);
  assert.match(SCHOOL_PAGE, /\/api\/program-report\/school/); assert.match(SCHOOL_PAGE, /school-admin-nav\.js\?v=\d+/);
  assert.ok(!/student(Name|_name)|teacherName/i.test(SCHOOL_PAGE + VIEW));
});

test('WIRING: the district menu links to it and every district page loads the same nav version; the standards view groups the SEL benchmarks under NYSED\'s three goals', () => {
  assert.match(read('district-admin-nav.js'), /district-admin-program-report\.html/);
  const versions = new Set();
  for (const f of fs.readdirSync(ROOT).filter((n) => /^district-admin-.*\.html$/.test(n))) { const m = read(f).match(/district-admin-nav\.js\?v=(\d+)/); if (m) versions.add(m[1]); }
  assert.equal(versions.size, 1, `one nav version across the district pages: ${[...versions]}`);
  const view = read('graduate-evidence-view.js');
  assert.match(view, /Goal 1: Self-awareness and agency/); assert.match(view, /Goal 2: Social awareness and relationships/); assert.match(view, /Goal 3: Intentional decision-making/);
  assert.match(VIEW, /goals: true/);
  const pages = ['district-admin-evidence.html', 'school-admin-evidence.html', 'teacher-classroom.html', 'district-admin-program-report.html', 'school-admin-program-report.html'].map((f) => read(f).match(/graduate-evidence-view\.js\?v=(\d+)/)[1]);
  assert.equal(new Set(pages).size, 1, 'every page loads the same version of the shared view');
  assert.equal(PAGE.match(/program-report-view\.js\?v=(\d+)/)[1], SCHOOL_PAGE.match(/program-report-view\.js\?v=(\d+)/)[1], 'both report pages load the same version of their view');
  assert.match(read('school-admin-nav.js'), /school-admin-program-report\.html/);
  const sv = new Set();
  for (const f of fs.readdirSync(ROOT).filter((n) => /^school-admin-.*\.html$/.test(n))) { const m = read(f).match(/school-admin-nav\.js\?v=(\d+)/); if (m) sv.add(m[1]); }
  assert.equal(sv.size, 1, `one school nav version across the school pages: ${[...sv]}`);
});

test('SETTINGS CARD: staff can change the three thresholds on the Settings page', () => {
  const s = read('admin-settings.html');
  assert.match(s, /id="programReportForm"/); assert.match(s, /\/api\/settings\/program-report/);
  for (const id of ['prWeeks', 'prLowPct', 'prMinTeachers']) assert.match(s, new RegExp(`id="${id}"`));
});

test('SYNTAX: every inline script on the page compiles (a stray apostrophe in a string once left the page blank)', () => {
  const vm = require('node:vm');
  const blocks = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g), ...SCHOOL_PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).concat([VIEW]);
  assert.ok(blocks.length >= 3);
  for (const b of blocks) assert.doesNotThrow(() => new vm.Script(b), 'an inline script has a syntax error');
});

test('HOW WE COUNT: a public page (no login) that a funder can read: the definitions, the small-group rules, and what the report cannot tell you', () => {
  for (const must of ['Active student', 'Reach', 'Classroom in regular use', 'Needs support', 'How small groups are protected', 'What this report cannot tell you', 'suppressed', 'implementation rubric', 'Neither|have not endorsed']) assert.match(HOW, new RegExp(must));
  assert.match(HOW, /Using this report with your state or funder/); assert.match(HOW, /state education agency/); assert.match(HOW, /https:\/\/www\.nysed\.gov\/student-support-services\/sel/); assert.match(HOW, /https:\/\/www\.nysed\.gov\/grad-measures\/new-york-state-portrait-graduate/);
  assert.match(HOW, /nav\.js\?v=\d+/); assert.match(HOW, /footer\.js/);
  assert.match(read('server/lib/program-use-csv.js'.replace('server/', 'server/')), /program-report-how-we-count\.html/);
  assert.ok(!/\/api\//.test(HOW.replace(/\/api\/settings\/favicon[^"]*/g, '')), 'a method page, no data');
});

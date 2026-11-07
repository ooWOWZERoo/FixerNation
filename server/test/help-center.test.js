// Release 123: the Help center (docs/reference/help-centre-requirements.md). One list of answers in help-center.js, shown by help.html;
// nothing is public until it is marked reviewed; every answer points at a real Get help topic and a real help video; search and the
// audience tabs behave; the page is linked from the footer, the portal menus, the Get help page and the Contact page.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function load(file, extra = {}) {
  const ctx = { window: {}, document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} }) }, location: { pathname: '/help.html', search: '', hash: '' }, URLSearchParams, ...extra };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read(file), ctx);
  return ctx;
}
const HC = load('help-center.js').FNHelpCenter;
const videos = load('help-videos.js').FNHelpVideos;
const TOPICS = ['cant_sign_in', 'invitation_or_seat', 'students_or_classroom', 'parents', 'billing_or_license', 'something_broke', 'other'];

test('every entry is complete: unique id, a question, an answer or steps, a known audience and a real Get help topic', () => {
  assert.ok(HC.entries.length >= 100, 'a useful set');
  assert.ok(HC.visible(false).length >= 100, 'enough reviewed answers that visitors always find something');
  const ids = new Set();
  const audiences = HC.audiences.map(a => a.id);
  for (const e of HC.entries) {
    assert.match(e.id, /^[a-z0-9-]+$/, e.id); assert.ok(!ids.has(e.id), `duplicate id ${e.id}`); ids.add(e.id);
    assert.ok(/[.?]$/.test(String(e.q || '').replace(/["']+$/, '')), `${e.id}: a question or a plain statement`);
    assert.ok(e.a || (e.steps && e.steps.length), `${e.id}: has an answer`);
    assert.ok(Array.isArray(e.for) && e.for.length && e.for.every(a => audiences.includes(a)), `${e.id}: audience`);
    assert.ok(TOPICS.includes(e.help), `${e.id}: Get help topic ${e.help}`);
    assert.equal(typeof e.reviewed, 'boolean', `${e.id}: reviewed flag`);
    assert.ok(e.topic, `${e.id}: topic`);
  }
});

test('a video link must be a real video id from help-videos.js', () => {
  const real = new Set(videos.videos.map(v => v.id));
  for (const e of HC.entries.filter(x => x.video)) assert.ok(real.has(e.video), `${e.id} points at ${e.video}`);
});

test('the Get help topics the page offers are the same ones the support server accepts', () => {
  const sup = fs.readFileSync(path.join(ROOT, 'server/lib/support.js'), 'utf8');
  for (const t of TOPICS) assert.ok(sup.includes(t + ':'), t);
  const page = read('support.html');
  for (const t of TOPICS) assert.ok(page.includes(`['${t}',`), t);
});

test('nothing is public until reviewed: visitors see only reviewed entries; preview shows all', () => {
  assert.equal(HC.visible(true).length, HC.entries.length);
  assert.deepEqual(HC.visible(false), HC.entries.filter(e => e.reviewed));
});

test('audience tabs: Everyone shows all; a role shows its own plus the "everyone" ones', () => {
  const all = HC.entries;
  assert.equal(HC.forAudience(all, 'everyone').length, all.length);
  const teachers = HC.forAudience(all, 'teacher');
  assert.ok(teachers.some(e => e.for.includes('teacher')) && teachers.some(e => e.for.includes('everyone')));
  assert.ok(teachers.every(e => e.for.includes('teacher') || e.for.includes('everyone')));
  assert.ok(!teachers.some(e => e.id === 'district-pog'));
  const students = HC.forAudience(all, 'student');
  assert.ok(students.some(e => e.id === 'student-pin'));
  assert.ok(!students.some(e => e.id === 'school-cant-invite'));
});

test('search matches every typed word in the question, answer, steps and topic, in any case', () => {
  const all = HC.entries;
  assert.ok(HC.search(all, 'LOCKED').some(e => e.id === 'teacher-student-cant-sign-in'), 'a word that is in the steps');
  assert.ok(HC.search(all, 'pin reset').some(e => e.id === 'teacher-student-cant-sign-in'), 'two words, either order');
  assert.equal(HC.search(all, 'zzzzqqq').length, 0);
  assert.equal(HC.search(all, '   ').length, all.length, 'blank search shows everything');
  assert.ok(HC.search(all, 'microsoft').every(e => /microsoft/i.test(`${e.q} ${e.a} ${e.topic}`)));
});

test('the copy follows the house style: no em dashes, no curly quotes, no figures an owner can change in Settings', () => {
  const text = JSON.stringify(HC.entries);
  assert.ok(!/—|–/.test(text), 'no em or en dashes');
  assert.ok(!/[‘’“”]/.test(text), 'straight quotes only');
  assert.ok(!/\b(40|10|3) (lessons|plans|swaps)\b/.test(text), 'no lesson or swap numbers');
});

test('facts that must match the system: reset 1 hour, verification 24 hours, invitations 14 days, 5 tries then about 15 minutes', () => {
  const by = (id) => HC.byId(id);
  assert.match(by('link-expired').a, /one hour/); assert.match(by('link-expired').a, /24 hours/);
  assert.match(by('school-invite-expired').a, /14 days/);
  assert.match(by('teacher-invite-parent').a, /14 days/);
  assert.match(by('teacher-student-cant-sign-in').steps.join(' '), /five wrong tries/); assert.match(by('teacher-student-cant-sign-in').steps.join(' '), /15 minutes/);
  const src = fs.readFileSync(path.join(ROOT, 'server/lib/pin-lockout.js'), 'utf8');
  assert.match(src, /max: 5/); assert.match(src, /15 \* 60 \* 1000/);
  assert.match(fs.readFileSync(path.join(ROOT, 'server/lib/teacher-invitations.js'), 'utf8'), /INVITATION_EXPIRY_DAYS = 14/);
  assert.match(fs.readFileSync(path.join(ROOT, 'server/routes/classrooms.js'), 'utf8'), /PARENT_INVITE_EXPIRY_DAYS = 14/);
});

test('WIRING: page, footer, portal menus, Get help panel, Contact pointer and the anonymous "answer opened" count', () => {
  const page = read('help.html');
  assert.match(page, /help-center\.js\?v=6/); assert.match(page, /help-videos\.js/); assert.match(page, /fnTrackEvent\('faq_open', e\.id\)/);
  assert.match(page, /preview/); assert.match(page, /noindex/);
  assert.ok(!/innerHTML/.test(page), 'answers are written with textContent only');
  assert.match(read('footer.js'), /help\.html">Help center/);
  assert.match(read('school-admin-nav.js'), /help\.html\?aud=school/); assert.match(read('district-admin-nav.js'), /help\.html\?aud=district/);
  const sp = read('support.html');
  assert.match(sp, /Check these answers first/); assert.match(sp, /help-center\.js\?v=6/); assert.match(sp, /See all answers/);
  assert.match(read('contact.html'), /href="help\.html"/);
  assert.match(read('server/routes/analytics.js'), /EVENT_TYPE_PATTERN = \/\^\[a-z_\]\{1,32\}\$\//);
});

test('GET HELP VIDEOS: G1 and G2 are on the Get help page, G3 is staff-only and stays off the public list; none shows until it has a url', () => {
  const by = (id) => videos.videos.find(v => v.id === id);
  assert.equal(JSON.stringify(by('G1').pages), '["support.html"]'); assert.equal(JSON.stringify(by('G2').pages), '["support.html"]');
  assert.equal(JSON.stringify(by('G3').pages), '["admin-support.html","admin-support-errors.html"]'); assert.equal(by('G3').listed, false); assert.equal(by('G3').group, 'staff');
  for (const id of ['G1', 'G2', 'G3']) assert.ok(videos.videos.find(v => v.id === id) && !videos.recorded(by(id)) === !by(id).url, `${id} is hidden until published`);
  assert.match(read('help-videos.js'), /v\.listed !== false/);
  assert.match(read('support.html'), /help-videos\.js\?v=17/); assert.match(read('admin-support.html'), /help-videos\.js\?v=17/);
  for (const f of fs.readdirSync(ROOT).filter(n => n.endsWith('.html'))) {
    const m = read(f).match(/help-videos\.js\?v=(\d+)/);
    if (m) assert.equal(m[1], '17', `${f} loads help-videos.js at the current version`);
  }
  assert.ok(HC.entries.some(e => e.video === 'G1') && HC.entries.some(e => e.video === 'G2'), 'the Help center points at both user videos');
});

test('SEEDED ANSWERS: the site has no public support email, so no answer tells people to email us; contact goes through Get help or the Contact page', () => {
  for (const e of HC.entries) {
    const text = `${e.a} ${(e.steps || []).join(' ')}`;
    assert.ok(!/email (us|support|the team at)|support@/i.test(text), `${e.id} must say "send us a request" instead`);
    assert.ok(e.a.split(/\s+/).length <= 80, `${e.id} is too long for a quick answer`);
  }
});

test('SEEDED ANSWERS: pricing, response-time promises, privacy and legal wording and research claims stay drafts until the owner reads them', () => {
  const drafts = new Set(HC.entries.filter(e => !e.reviewed).map(e => e.id));
  for (const id of ['ferpa-requests', 'student-data-retention']) assert.ok(drafts.has(id), `${id} is a draft`);
  // Release 140: the owner answered these, so they are published in the owner's words
  for (const id of ['student-no-email', 'student-data-sale-ads', 'data-deletion', 'privacy-paperwork', 'content-focus', 'outcome-evidence', 'casel-alignment', 'teacher-seat-cost', 'teacher-single-license-price', 'quote-response-time', 'setup-time', 'parent-preview', 'parent-access-cost', 'district-licensing', 'student-data-collected', 'site-visitor-privacy']) assert.ok(!drafts.has(id), `${id} is published`);
  const text = HC.visible(false).map(e => e.a).join(' ');
  assert.ok(!/\$[1-9]/.test(text), "no dollar prices in a reviewed answer (the only dollar figure allowed is the $0 quote that needs no PO)");
});

test('every audience tab has answers for visitors, and a search for a common word finds some', () => {
  const pub = HC.visible(false);
  for (const a of HC.audiences) assert.ok(HC.forAudience(pub, a.id).length >= 15, `${a.id} has plenty`);
  for (const word of ['password', 'invitation', 'pin', 'seat', 'classroom', 'email', 'license', 'parent']) assert.ok(HC.search(pub, word).length >= 3, word);
});

test('OWNER-SUPPLIED ANSWERS: pricing, refunds, trials, hours, devices, renewals, SSO, training, accessibility are published; data retention stays a draft', () => {
  const by = (id) => HC.byId(id);
  for (const id of ['license-price', 'refunds', 'free-trial-demo', 'discounts', 'tax-forms', 'how-renewal-works', 'office-hours', 'supported-devices', 'google-clever-sso', 'training', 'accessibility']) assert.equal(by(id).reviewed, true, id);
  assert.match(by('office-hours').a, /8 a\.m\. to 5 p\.m\., Monday through Friday/);
  assert.match(by('supported-devices').a, /Chrome is preferred/);
  assert.match(by('license-price').a, /quote/); assert.match(by('refunds').a, /case by case/);
  assert.ok(!/phone|call us|\d{3}-\d{3}-\d{4}/i.test(by('office-hours').a), 'no phone number is given: the site has none');
  assert.equal(by('student-data-retention').reviewed, false, 'a purge promise stays a draft until the system really does it');
  const src = fs.readFileSync(path.join(ROOT, 'server/routes/site-auth.js'), 'utf8');
  assert.match(src, /microsoft-oauth/, 'Microsoft is the only outside sign-in the answer mentions');
});

// Sales CRM phase 6, feature 1: the "Trial and demo engagement" card on a deal and an account (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec").
// Real routes and real SQL (node:sqlite) from test/helpers/crm-env.js. What must hold: an unknown is never shown as a zero, every part names its source and dates, no person
// or student-level field and no demo group name ever leaves the server, a student total under 10 is not shown, and all three CRM roles can read it (and only when the
// Hub is on). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
for (const col of ['seat_count INTEGER', 'school_domain TEXT', 'expiration_date TEXT', 'effective_date TEXT']) db.exec(`ALTER TABLE purchases ADD COLUMN ${col}`);
db.exec("CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, invited_email TEXT, status TEXT NOT NULL DEFAULT 'pending', registered_site_user_id INTEGER)");
db.exec(`CREATE TABLE program_use_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, school_year_start INTEGER NOT NULL, month TEXT NOT NULL, school_id INTEGER NOT NULL, district_id INTEGER,
  teachers_licensed INTEGER NOT NULL, teachers_activated INTEGER NOT NULL, teachers_teaching INTEGER NOT NULL, teachers_teaching_ytd INTEGER NOT NULL DEFAULT 0, classrooms INTEGER NOT NULL,
  classrooms_active INTEGER NOT NULL, classrooms_regular INTEGER NOT NULL DEFAULT 0, students_enrolled INTEGER NOT NULL, students_active INTEGER NOT NULL, students_active_ytd INTEGER NOT NULL DEFAULT 0,
  activities INTEGER NOT NULL, source TEXT DEFAULT 'monthly', created_at TEXT DEFAULT '2026-11-01 04:15:00', UNIQUE (school_year_start, month, school_id))`);
db.exec("CREATE TABLE public_demo_events (id INTEGER PRIMARY KEY AUTOINCREMENT, window_id INTEGER, kind TEXT, detail TEXT, invitation_id INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");

const quoteAcceptStub = { router: require('express').Router(), acceptQuoteViaPO: async () => { throw new Error('not used'); } };
env.install(pool, { [path.join(env.SERVER, 'routes/quote-accept.js')]: quoteAcceptStub });
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/opportunities', R('crm-opportunities.js')], ['/api/crm/accounts', R('crm-accounts.js')]]);
test.after(() => server.close());

const adminId = env.addAdmin(db, 'boss', 'admin');
const salesId = env.addAdmin(db, 'rep', 'sales');
const readId = env.addAdmin(db, 'viewer', 'readonly');
env.enable(db);

const SECRET_LABEL = 'Springfield Unified SECRET Group';
const SECRET_EMAIL = 'teacher.person@example.com';
const STUDENT_NAME = 'Kaylee Studentname';

let seq = 0;
function school(name) { const id = ++seq; db.prepare('INSERT INTO schools (id, domain, display_name) VALUES (?, ?, ?)').run(id, `e${id}.example.com`, name); return id; }
function account(name, { schoolId = null, districtId = null } = {}) {
  return Number(db.prepare('INSERT INTO crm_accounts (name, account_type, school_id, district_id) VALUES (?, ?, ?, ?)').run(name, districtId ? 'district' : 'school', schoolId, districtId).lastInsertRowid);
}
function deal(accountId, name = 'A deal') { return Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, state) VALUES (?, ?, 2, 'open')").run(accountId, name).lastInsertRowid); }
function purchase(contactId, f = {}) {
  const r = db.prepare(`INSERT INTO purchases (contact_id, product_type, payment_status, amount_cents, school_id, seat_count, effective_date, expiration_date, trial_lesson_limit, trial_expiration_date, quote_id, license_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contactId, f.type || 'group_license', f.status || 'paid', f.amount === undefined ? 100000 : f.amount, f.schoolId || null, f.seats === undefined ? 10 : f.seats,
    f.starts || '2026-08-01', f.ends === undefined ? '2027-07-31' : f.ends, f.trialLimit === undefined ? null : f.trialLimit, f.trialEnds || null, f.quoteId || null, f.licenseStatus || 'active');
  return Number(r.lastInsertRowid);
}
const seats = (pid, status, n) => { for (let i = 0; i < n; i++) db.prepare('INSERT INTO license_seats (purchase_id, invited_email, status) VALUES (?, ?, ?)').run(pid, status === 'pending' ? SECRET_EMAIL : null, status); };
function snapshot(schoolId, month, f = {}) {
  db.prepare(`INSERT INTO program_use_snapshots (school_year_start, month, school_id, teachers_licensed, teachers_activated, teachers_teaching, classrooms, classrooms_active, students_enrolled, students_active, activities, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(2026, month, schoolId, f.licensed ?? 10, f.activated ?? 8, f.teaching ?? 5, f.rooms ?? 6, f.roomsActive ?? 4, f.enrolled ?? 120, f.active ?? 60, f.activities ?? 300, f.saved || `${month}-28 04:15:00`);
}
const get = async (url, who = adminId) => call('GET', url, undefined, who);
const walk = (v, fn, p = '') => { if (Array.isArray(v)) v.forEach((x, i) => walk(x, fn, `${p}[${i}]`)); else if (v && typeof v === 'object') { fn(v, p); for (const [k, x] of Object.entries(v)) walk(x, fn, `${p}.${k}`); } };

const buyer = env.addContact(db, 'buyer@example.com', 'Buyer');
const sA = school('Aspen Elementary');
const acctA = account('Aspen Elementary', { schoolId: sA });
const dealA = deal(acctA, 'Aspen renewal');
const pA = purchase(buyer, { schoolId: sA, seats: 10 });
seats(pA, 'registered', 4); seats(pA, 'pending', 2); seats(pA, 'available', 4);
snapshot(sA, '2026-08'); snapshot(sA, '2026-09'); snapshot(sA, '2026-10', { teaching: 0, active: 0, activities: 0, roomsActive: 0 }); snapshot(sA, '2026-07');

test('LICENSES: seats are counts by status; the invited email and any person are never in the payload', async () => {
  const r = await get(`/api/crm/opportunities/${dealA}/engagement`);
  assert.equal(r.status, 200);
  const item = r.json.licenses.items[0];
  assert.equal(item.purchaseId, pA);
  assert.equal(item.kind, 'paid');
  assert.deepEqual([item.seatsBought.value, item.seatsRegistered.value, item.seatsPending.value, item.seatsAvailable.value], [10, 4, 2, 4]);
  assert.equal(item.endsOn, '2027-07-31');
  assert.equal(item.endsOnUnknownReason, null);
  assert.equal(JSON.stringify(r.json).includes(SECRET_EMAIL), false);
  assert.match(r.json.licenses.source, /Purchases and license seats/);
  assert.match(r.json.licenses.window, /^As of \d{4}-\d{2}-\d{2}$/);
});

test('PROGRAM USE: the latest three saved months, newest first, each with its month, school year and the day it was saved; a real zero stays a zero', async () => {
  const r = await get(`/api/crm/accounts/${acctA}/engagement`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = r.json.programUse;
  assert.deepEqual(p.months.map(m => m.month), ['2026-10', '2026-09', '2026-08'], 'three months, the July one is left off');
  assert.equal(p.months[0].label, 'October 2026');
  assert.equal(p.months[0].schoolYear, '2026-27');
  assert.equal(p.months[0].savedOn, '2026-10-28');
  assert.match(p.source, /Program use snapshots/);
  assert.match(p.window, /latest 3 saved months/);
  const oct = p.months[0];
  assert.equal(oct.teachersTeaching.value, 0, 'a saved zero is a zero');
  assert.equal(oct.teachersTeaching.unknownReason, null);
  assert.equal(oct.studentsActive.value, 0);
});

test('UNKNOWN IS NEVER ZERO: no snapshot, no school link, no seat records, no seat count, no end date, a missing table', async () => {
  // a school with no snapshot at all
  const sB = school('Birch'); const aB = account('Birch', { schoolId: sB });
  let r = await get(`/api/crm/accounts/${aB}/engagement`);
  assert.deepEqual(r.json.programUse.months, []);
  assert.match(r.json.programUse.unknownReason, /No usage snapshot has been saved for this school yet/);
  // an account with no school or district
  const aC = account('Cedar (no school)');
  r = await get(`/api/crm/accounts/${aC}/engagement`);
  assert.match(r.json.programUse.unknownReason, /No school is linked to this account/);
  assert.match(r.json.linkNote, /Link a school/);
  assert.match(r.json.licenses.unknownReason, /Nothing has been bought/);
  // a purchase with no seat records, no seat count, no end date
  const sD = school('Dogwood'); const aD = account('Dogwood', { schoolId: sD });
  const pD = purchase(buyer, { schoolId: sD, seats: null, ends: null });
  r = await get(`/api/crm/accounts/${aD}/engagement`);
  const it = r.json.licenses.items[0];
  assert.equal(it.purchaseId, pD);
  for (const m of [it.seatsBought, it.seatsRegistered, it.seatsPending, it.seatsAvailable]) { assert.equal(m.value, null); assert.ok(m.unknownReason); }
  assert.equal(it.endsOn, null);
  assert.match(it.endsOnUnknownReason, /no end date/);
  // the table is not there yet (code deployed before the alter or the first snapshot)
  db.exec('ALTER TABLE program_use_snapshots RENAME TO program_use_snapshots_off');
  r = await get(`/api/crm/accounts/${acctA}/engagement`);
  assert.equal(r.status, 200);
  assert.match(r.json.programUse.unknownReason, /not set up on this server yet/);
  db.exec('ALTER TABLE program_use_snapshots_off RENAME TO program_use_snapshots');
});

test('EVERY METRIC IS EITHER A NUMBER OR A REASON, never both, never neither', async () => {
  const sE = school('Elm'); const aE = account('Elm', { schoolId: sE });
  purchase(buyer, { schoolId: sE, seats: null }); snapshot(sE, '2026-10', { enrolled: 4, active: 2 });
  for (const url of [`/api/crm/opportunities/${dealA}/engagement`, `/api/crm/accounts/${acctA}/engagement`, `/api/crm/accounts/${aE}/engagement`]) {
    const r = await get(url);
    let seen = 0;
    walk(r.json, (o) => {
      if ('value' in o && 'unknownReason' in o) {
        seen++;
        assert.ok((o.value === null) !== (o.unknownReason === null), `${url}: ${JSON.stringify(o)}`);
        if (o.value === null) assert.ok(['unknown', 'small'].includes(o.kind));
      }
    });
    assert.ok(seen > 5, 'the walk found the metrics');
  }
});

test('STUDENT FLOOR: under 10 enrolled, student numbers are not shown; at 10 they are; teacher and classroom counts are shown either way', async () => {
  const sF = school('Fir Small'); const aF = account('Fir Small', { schoolId: sF });
  snapshot(sF, '2026-10', { enrolled: 9, active: 7 });
  let m = (await get(`/api/crm/accounts/${aF}/engagement`)).json.programUse.months[0];
  assert.equal(m.studentsEnrolled.value, null); assert.equal(m.studentsEnrolled.kind, 'small');
  assert.equal(m.studentsActive.value, null); assert.equal(m.studentsActive.kind, 'small');
  assert.match(m.studentsActive.unknownReason, /Fewer than 10 students/);
  assert.equal(m.teachersTeaching.value, 5);
  assert.equal(m.classroomsActive.value, 4);
  const sG = school('Fir Big'); const aG = account('Fir Big', { schoolId: sG });
  snapshot(sG, '2026-10', { enrolled: 10, active: 3 });
  m = (await get(`/api/crm/accounts/${aG}/engagement`)).json.programUse.months[0];
  assert.deepEqual([m.studentsEnrolled.value, m.studentsActive.value], [10, 3]);
});

test('DISTRICT: its schools are added together month by month and the screen is told how many reported', async () => {
  const dist = Number(db.prepare("INSERT INTO districts (name) VALUES ('Grove District')").run().lastInsertRowid);
  const s1 = school('Grove 1'), s2 = school('Grove 2'); db.prepare('UPDATE schools SET district_id = ? WHERE id IN (?, ?)').run(dist, s1, s2);
  const aDist = account('Grove District', { districtId: dist });
  snapshot(s1, '2026-10', { teaching: 3, enrolled: 100, active: 50 });
  const m = (await get(`/api/crm/accounts/${aDist}/engagement`)).json.programUse.months[0];
  assert.equal(m.schoolsReporting, 1); assert.equal(m.schoolsInScope, 2);
  assert.equal(m.teachersTeaching.value, 3);
  snapshot(s2, '2026-10', { teaching: 4, enrolled: 100, active: 10 });
  const m2 = (await get(`/api/crm/accounts/${aDist}/engagement`)).json.programUse.months[0];
  assert.equal(m2.schoolsReporting, 2);
  assert.equal(m2.teachersTeaching.value, 7);
});

test('TRIALS: a trial shows as a trial with its own end date and lesson limit; a trial with no limit says so', async () => {
  const sH = school('Hazel'); const aH = account('Hazel', { schoolId: sH });
  purchase(buyer, { schoolId: sH, status: 'paid', trialLimit: 3, trialEnds: '2026-12-01', ends: null });
  purchase(buyer, { schoolId: sH, trialEnds: '2026-12-05', ends: null });
  const items = (await get(`/api/crm/accounts/${aH}/engagement`)).json.licenses.items;
  assert.equal(items.length, 2);
  for (const t of items) assert.equal(t.kind, 'trial');
  const withLimit = items.find(t => t.trialLessonLimit.value === 3);
  assert.ok(withLimit); assert.equal(withLimit.endsOn, '2026-12-01');
  const noLimit = items.find(t => t.trialLessonLimit.value === null);
  assert.match(noLimit.trialLessonLimit.unknownReason, /No lesson limit/);
});

test('A DEAL ON AN UNLINKED ACCOUNT finds its school through the purchases on its own quotes', async () => {
  const sI = school('Ivy'); const aI = account('Ivy (not linked)');
  const dI = deal(aI, 'Ivy deal');
  const q = Number(db.prepare("INSERT INTO quote_requests (email, opportunity_id, contact_id) VALUES ('buyer@example.com', ?, ?)").run(dI, buyer).lastInsertRowid);
  purchase(buyer, { schoolId: sI, quoteId: q }); snapshot(sI, '2026-10');
  const r = await get(`/api/crm/opportunities/${dI}/engagement`);
  assert.equal(r.json.schoolsInScope, 1);
  assert.equal(r.json.programUse.months[0].month, '2026-10');
  assert.equal(r.json.linkNote, null);
});

test('DEMO: dates and counts only; the group name is never in the payload; zero recorded is a zero, and an unreadable table is unknown', async () => {
  const sJ = school('Juniper'); const aJ = account('Juniper', { schoolId: sJ }); const dJ = deal(aJ, 'Juniper deal');
  let r = await get(`/api/crm/opportunities/${dJ}/engagement`);
  assert.equal(r.json.demo.linked, false);
  assert.match(r.json.demo.note, /No prospect demo is tied/);

  const inv = Number(db.prepare("INSERT INTO public_demo_invitations (label, workspace_id, status, starts_at, ends_at, ended_at) VALUES (?, 1, 'ended', '2026-10-01 09:00:00', '2026-10-08 09:00:00', '2026-10-08 09:00:00')").run(SECRET_LABEL).lastInsertRowid);
  db.prepare("INSERT INTO quote_requests (email, opportunity_id, demo_invitation_id) VALUES ('x@example.com', ?, ?)").run(dJ, inv);
  r = await get(`/api/crm/opportunities/${dJ}/engagement`);
  assert.equal(r.json.demo.linked, true);
  const d = r.json.demo.invitations[0];
  assert.equal(d.startsOn, '2026-10-01'); assert.equal(d.endsOn, '2026-10-08'); assert.equal(d.open, false);
  assert.equal(d.gateEntries.value, 0, 'the table is readable and has no rows for it: a recorded zero');
  assert.match(r.json.demo.note, /None recorded/);
  for (const [kind, detail, n] of [['gate_entry', null, 3], ['sign_in', 'teacher', 2], ['sign_in', 'student', 5]]) for (let i = 0; i < n; i++) db.prepare('INSERT INTO public_demo_events (window_id, kind, detail, invitation_id) VALUES (0, ?, ?, ?)').run(kind, detail, inv);
  r = await get(`/api/crm/opportunities/${dJ}/engagement`);
  const d2 = r.json.demo.invitations[0];
  assert.equal(d2.gateEntries.value, 3); assert.equal(d2.signInsTotal.value, 7);
  assert.equal(d2.signIns.teacher.value, 2); assert.equal(d2.signIns.student.value, 5); assert.equal(d2.signIns.parent.value, 0);
  assert.equal(JSON.stringify(r.json).includes(SECRET_LABEL), false, 'the group is staff-only and never selected here');
  assert.equal(JSON.stringify(r.json).toLowerCase().includes('label'), false);

  db.exec('ALTER TABLE public_demo_events RENAME TO public_demo_events_off');
  r = await get(`/api/crm/opportunities/${dJ}/engagement`);
  assert.equal(r.status, 200);
  assert.equal(r.json.demo.invitations[0].gateEntries.value, null);
  assert.match(r.json.demo.invitations[0].gateEntries.unknownReason, /cannot be read/);
  db.exec('ALTER TABLE public_demo_events_off RENAME TO public_demo_events');
});

const ALLOWED = new Set(['kind', 'id', 'accountId', 'accountName', 'schoolsInScope', 'linkNote', 'licenses', 'programUse', 'demo', 'source', 'window', 'items', 'unknownReason', 'purchaseId', 'product',
  'paymentStatus', 'licenseStatus', 'startsOn', 'endsOn', 'endsOnUnknownReason', 'daysLeft', 'trialLessonLimit', 'seatsBought', 'seatsRegistered', 'seatsPending', 'seatsAvailable', 'value',
  'schoolsReporting', 'months', 'month', 'label', 'schoolYear', 'savedOn', 'teachersLicensed', 'teachersActivated', 'teachersTeaching', 'classrooms', 'classroomsActive', 'activities',
  'studentsEnrolled', 'studentsActive', 'linked', 'invitations', 'note', 'open', 'gateEntries', 'signInsTotal', 'signIns', 'district', 'school', 'teacher', 'parent', 'student']);
test('KEY WHITELIST: the payload contains only keys on the list (a new field has to be added here on purpose)', async () => {
  for (const url of [`/api/crm/opportunities/${dealA}/engagement`, `/api/crm/accounts/${acctA}/engagement`]) {
    const r = await get(url);
    walk(r.json, (o) => { for (const k of Object.keys(o)) if (k !== 'unknownReason' && k !== 'kind') assert.ok(ALLOWED.has(k), `unexpected key "${k}" in ${url}`); });
    const text = JSON.stringify(r.json);
    for (const bad of [SECRET_EMAIL, STUDENT_NAME, '@example.com', 'password', 'invited_email', 'registered_site_user_id', 'student_id', 'username']) assert.equal(text.includes(bad), false, bad);
  }
  const code = fs.readFileSync(path.join(env.SERVER, 'lib/crm-engagement.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /invited_email|registered_site_user_id|classroom_students|student_lesson_progress|(FROM|JOIN)\s+classrooms|site_users/);
  assert.doesNotMatch(code, /\blabel\b\s*(,|FROM)|SELECT[^;`]*\blabel\b/i, 'the demo group name is never selected');
});

test('ACCESS: all three roles read it; signed out is refused; an unknown id is 404; while the Hub is off it is 404', async () => {
  for (const who of [adminId, salesId, readId]) {
    assert.equal((await get(`/api/crm/opportunities/${dealA}/engagement`, who)).status, 200);
    assert.equal((await get(`/api/crm/accounts/${acctA}/engagement`, who)).status, 200);
  }
  assert.equal((await call('GET', `/api/crm/opportunities/${dealA}/engagement`)).status, 401);
  assert.equal((await get('/api/crm/opportunities/99999/engagement')).status, 404);
  assert.equal((await get('/api/crm/accounts/99999/engagement')).status, 404);
  env.enable(db, false);
  assert.equal((await get(`/api/crm/opportunities/${dealA}/engagement`)).status, 404);
  assert.equal((await get(`/api/crm/accounts/${acctA}/engagement`)).status, 404);
  env.enable(db, true);
});

test('READ ONLY MEANS READ ONLY: the card writes nothing; the routes are GET only', async () => {
  const before = JSON.stringify(['purchases', 'license_seats', 'crm_opportunities', 'crm_accounts', 'program_use_snapshots', 'school_audit_log'].map(t => db.prepare(`SELECT * FROM ${t}`).all()));
  await get(`/api/crm/opportunities/${dealA}/engagement`); await get(`/api/crm/accounts/${acctA}/engagement`);
  assert.equal(JSON.stringify(['purchases', 'license_seats', 'crm_opportunities', 'crm_accounts', 'program_use_snapshots', 'school_audit_log'].map(t => db.prepare(`SELECT * FROM ${t}`).all())), before);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.notEqual((await call(method, `/api/crm/opportunities/${dealA}/engagement`, {}, adminId)).status, 200);
  const code = fs.readFileSync(path.join(env.SERVER, 'lib/crm-engagement.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE)\b/);
});

test('THE CARD says where each part comes from and unknown in words; it is mounted on the deal and the account page and escapes what it prints', () => {
  const root = path.join(env.SERVER, '..');
  const panels = fs.readFileSync(path.join(root, 'crm-panels.js'), 'utf8');
  const block = panels.slice(panels.indexOf('P.engagement'), panels.indexOf('P.attribution'));
  assert.match(block, /Source:/);
  assert.match(block, /Dates:/);
  assert.match(block, />Unknown</);
  assert.match(block, /does not mean zero/);
  assert.doesNotMatch(block, /innerHTML\s*=\s*[^;]*\b(m|i|d)\.(unknownReason|product|accountName)\b(?!\))/, 'text from the server goes through esc()');
  assert.match(fs.readFileSync(path.join(root, 'admin-crm-opportunity.html'), 'utf8'), /FnCrmPanels\.engagement\(/);
  assert.match(fs.readFileSync(path.join(root, 'admin-crm-account.html'), 'utf8'), /FnCrmPanels\.engagement\(/);
});

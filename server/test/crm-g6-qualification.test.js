// Sales CRM punch list G6 (PRD FR-QUAL-01, FR-QUAL-03): optional qualification answers on a deal and a plain "what is still unknown" list that blocks nothing and has no score.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const Q = require(path.join(env.SERVER, 'lib/crm-qualification.js'));
const { server, call } = env.listen([
  ['/api/crm/accounts', require(path.join(env.SERVER, 'routes/crm-accounts.js'))],
  ['/api/crm/opportunities', require(path.join(env.SERVER, 'routes/crm-opportunities.js'))],
]);
test.after(() => server.close());

const admin = env.addAdmin(db, 'g6owner', 'admin');
const sales = env.addAdmin(db, 'g6rep', 'sales');
const sales2 = env.addAdmin(db, 'g6rep2', 'sales');
const viewer = env.addAdmin(db, 'g6viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);

async function newDeal(body = {}, as = sales) {
  const acct = await call('POST', '/api/crm/accounts', { name: 'G6 District ' + Math.random(), accountType: 'district' }, admin);
  const r = await call('POST', '/api/crm/opportunities', { accountId: acct.json.id, name: 'G6 deal', ...body }, as);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}
const detail = async (id, as = sales) => (await call('GET', `/api/crm/opportunities/${id}`, undefined, as)).json;

test('NOTHING IS REQUIRED: a deal with none of the answers saves, moves and shows twelve gaps; no score appears anywhere', async () => {
  const id = await newDeal();
  const d = await detail(id);
  assert.equal(d.qualification.total, 12); assert.equal(d.qualification.known, 0); assert.equal(d.qualification.missing.length, 12);
  assert.deepEqual(Object.keys(d.opportunity.qualification).sort(), ['funding', 'grades', 'need', 'procurementPath', 'risks', 'schools', 'students', 'teachers']);
  assert.ok(Object.values(d.opportunity.qualification).every(v => v === null));
  assert.doesNotMatch(JSON.stringify(d.qualification), /score|rating|\bhot\b|\bwarm\b|\bcold\b/i);
  const put = await call('PUT', `/api/crm/opportunities/${id}`, { name: 'G6 renamed', expectedUpdatedAt: d.opportunity.updatedAt }, sales);
  assert.equal(put.status, 200, 'saving without any answer is fine');
  const mv = await call('POST', `/api/crm/opportunities/${id}/stage`, { stageKey: 'discovery', reason: 'moved', overrideReason: 'no next step yet' }, sales);
  assert.equal(mv.status, 200, JSON.stringify(mv.json));
});

test('SAVE AND SHOW: all eight answers are saved, trimmed and shown; blanks clear them; the deal edit audit row holds before and after', async () => {
  const id = await newDeal();
  const body = { schools: '12', teachers: 340, students: '8200', grades: ' K-8 ', need: 'Weekly SEL lessons for every homeroom', funding: 'Title IV', procurementPath: 'Board vote in March', risks: 'Budget freeze' };
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, body, sales)).status, 200);
  let q = (await detail(id)).opportunity.qualification;
  assert.deepEqual(q, { schools: 12, teachers: 340, students: 8200, grades: 'K-8', need: 'Weekly SEL lessons for every homeroom', funding: 'Title IV', procurementPath: 'Board vote in March', risks: 'Budget freeze' });
  const row = get("SELECT * FROM school_audit_log WHERE action = 'crm_opportunity_updated' AND entity_id = ? ORDER BY id DESC", id);
  assert.match(row.new_value, /qual_schools/); assert.match(row.old_value || row.prev_value || '', /qual_schools|null/);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { schools: '', need: null, risks: '   ' }, sales)).status, 200);
  q = (await detail(id)).opportunity.qualification;
  assert.equal(q.schools, null); assert.equal(q.need, null); assert.equal(q.risks, null); assert.equal(q.teachers, 340, 'what was not sent is left alone');
});

test('CHECKS: a count must be a whole number from 0 to 1,000,000; a long note is cut; the message says what to type', async () => {
  const id = await newDeal();
  for (const bad of [{ schools: -1 }, { teachers: 1.5 }, { students: '12abc' }, { students: 1000001 }, { schools: {} }, { teachers: [] }, { students: true }]) {
    const r = await call('PUT', `/api/crm/opportunities/${id}`, bad, sales);
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.match(r.json.error, /whole number from 0 to 1,000,000, or blank/);
  }
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { schools: 0, need: 'x'.repeat(5000), grades: 'g'.repeat(500) }, sales)).status, 200);
  const q = (await detail(id)).opportunity.qualification;
  assert.equal(q.schools, 0); assert.equal(q.need.length, 1000); assert.equal(q.grades.length, 64);
  assert.equal(get('SELECT qual_need FROM crm_opportunities WHERE id = ?', id).qual_need.length, 1000);
});

test('THE LIST: champion and decision maker come from the buying committee; start of use and competitor are the deal\'s own fields; known and missing add up', async () => {
  const id = await newDeal({ competitor: 'Rival SEL', targetImplementationDate: '2027-08-15' });
  const champ = env.addContact(db, 'champ@school.test', 'Chris Champion');
  const dm = env.addContact(db, 'dm@school.test', 'Dana Decider');
  db.prepare('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, ?)').run(id, champ, 'champion');
  db.prepare('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, ?)').run(id, dm, 'finance');
  await call('PUT', `/api/crm/opportunities/${id}`, { schools: 3, funding: 'Grant' }, sales);
  const a = (await detail(id)).qualification;
  const by = Object.fromEntries(a.criteria.map(c => [c.key, c]));
  assert.equal(by.champion.known, true); assert.equal(by.champion.value, 'Chris Champion'); assert.equal(by.champion.where, 'committee');
  assert.equal(by.decisionMaker.known, false, 'a finance contact is not the decision maker');
  assert.equal(by.competitor.value, 'Rival SEL'); assert.equal(by.targetDate.known, true);
  assert.equal(by.schools.value, 3); assert.equal(by.funding.value, 'Grant');
  assert.equal(a.known + a.missing.length, a.total); assert.equal(a.known, 5);
  assert.ok(a.missing.every(m => !['schools', 'funding', 'champion', 'competitor', 'targetDate'].includes(m.key)));
  assert.ok(a.missing.find(m => m.key === 'decisionMaker' && m.where === 'committee'));
  // Q.assess on its own never throws on an old row with none of the columns.
  assert.equal(Q.assess({}, []).known, 0);
});

test('WHO CAN CHANGE IT: the deal rules apply unchanged (owner or CRM Admin edits; another rep and Read-only are refused); everyone with a CRM role can read it', async () => {
  const id = await newDeal({}, sales);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { schools: 4 }, sales2)).status, 403);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { schools: 4 }, viewer)).status, 403);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { schools: 4 }, admin)).status, 200);
  assert.equal((await detail(id, viewer)).opportunity.qualification.schools, 4);
  assert.equal((await call('PUT', `/api/crm/opportunities/${id}`, { schools: 5, expectedUpdatedAt: '1999-01-01 00:00:00' }, sales)).status, 409, 'the stale-edit check still covers these fields');
});

test('A NEW DEAL MAY CARRY THEM TOO, and a stored value is never shown as markup (the page escapes it)', async () => {
  const id = await newDeal({ schools: 2, need: '<img src=x onerror=alert(1)>' });
  assert.equal((await detail(id)).opportunity.qualification.schools, 2);
  const page = fs.readFileSync(path.join(env.SERVER, '..', 'admin-crm-opportunity.html'), 'utf8');
  assert.match(page, /What we know \(/); assert.match(page, /Nothing is blocked by a gap here/);
  assert.match(page, /esc\(r\.value\)/); assert.match(page, /esc\(q\.need \|\| ''\)/);
  assert.doesNotMatch(page, /innerHTML\s*=\s*[^;]*qa\.criteria[^;]*\+\s*r\.value\b/);
});

test('FILES: schema.sql and the alter script carry the eight columns; the alter script checks before adding; the lib has no score or write of its own', () => {
  const schema = fs.readFileSync(path.join(env.SERVER, 'db/schema.sql'), 'utf8');
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-add-crm-qualification.js'), 'utf8');
  const lib = fs.readFileSync(path.join(env.SERVER, 'lib/crm-qualification.js'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const c of ['qual_schools', 'qual_teachers', 'qual_students', 'qual_grades', 'qual_need', 'qual_funding', 'qual_procurement_path', 'qual_risks']) { assert.match(schema, new RegExp(c)); assert.match(alter, new RegExp(c)); }
  assert.match(alter, /information_schema\.COLUMNS/); assert.match(alter, /ER_DUP_FIELDNAME/);
  assert.doesNotMatch(lib, /\bscore\b|INSERT INTO|UPDATE \w+ SET|DELETE FROM/i);
  require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, 'scripts/alter-add-crm-qualification.js')]);
});

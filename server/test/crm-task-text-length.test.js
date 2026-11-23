// A CRM task's title may be 510 characters and its details 2000 (doubled from 255 and 1000). Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/tasks', R('crm-tasks.js')]]);
test.after(() => server.close());

const rep = env.addAdmin(db, 'tasklenrep', 'sales');
env.enable(db, true);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Task length district', 'district')").run().lastInsertRowid);
const deal = Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, stage_entered_at) VALUES (?, 'Task length deal', 1, ?, '2026-11-01 10:00:00')").run(acct, rep.id || rep.adminId || rep).lastInsertRowid);
const get = (sql, ...a) => db.prepare(sql).get(...a);

test('LENGTH: a task keeps up to 510 characters of title and 2000 of details, and anything longer is cut at that point, on create and on edit', async () => {
  const made = await call('POST', '/api/crm/tasks', { opportunityId: deal, title: 'T'.repeat(510), details: 'D'.repeat(2000) }, rep);
  assert.equal(made.status, 201);
  let row = get('SELECT title, details FROM crm_tasks WHERE id = ?', made.json.id);
  assert.equal(row.title.length, 510); assert.equal(row.details.length, 2000);
  const over = await call('POST', '/api/crm/tasks', { opportunityId: deal, title: 'T'.repeat(700), details: 'D'.repeat(3000) }, rep);
  assert.equal(over.status, 201);
  row = get('SELECT title, details FROM crm_tasks WHERE id = ?', over.json.id);
  assert.equal(row.title.length, 510, 'cut at 510'); assert.equal(row.details.length, 2000, 'cut at 2000');
  const edit = await call('PUT', `/api/crm/tasks/${made.json.id}`, { title: 'E'.repeat(800), details: 'F'.repeat(2500) }, rep);
  assert.equal(edit.status, 200);
  row = get('SELECT title, details FROM crm_tasks WHERE id = ?', made.json.id);
  assert.equal(row.title.length, 510); assert.equal(row.details.length, 2000);
});

test('THE SCREENS AND THE DATABASE agree with the server: both task forms allow 510 and 2000, the schema is that wide, and the alter script widens only', () => {
  const root = path.join(env.SERVER, '..');
  for (const f of ['crm-panels.js', 'admin-crm-tasks.html']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(src, /id="tTitle" maxlength="510"/, `${f}: title`);
    assert.match(src, /id="tDetails" maxlength="2000"/, `${f}: details`);
  }
  const schema = fs.readFileSync(path.join(env.SERVER, 'db', 'schema.sql'), 'utf8');
  const tbl = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS crm_tasks ('));
  assert.match(tbl, /title VARCHAR\(510\) NOT NULL/); assert.match(tbl, /details VARCHAR\(2000\) NULL/);
  const alter = fs.readFileSync(path.join(env.SERVER, 'scripts', 'alter-widen-crm-task-text.js'), 'utf8');
  assert.match(alter, />= len\) \{ console\.log\(`Skipped/, 'never narrows');
  assert.doesNotThrow(() => new (require('node:vm').Script)(alter.replace(/^require[^\n]*\n/, '')));
});

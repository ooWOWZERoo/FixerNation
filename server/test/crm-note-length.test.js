// A CRM note may be 10000 characters (doubled from 5000). Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const env = require('./helpers/crm-env');

const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/notes', R('crm-notes.js')]]);
test.after(() => server.close());

const rep = env.addAdmin(db, 'notelenrep', 'sales');
env.enable(db, true);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('Note length district', 'district')").run().lastInsertRowid);
const get = (sql, ...a) => db.prepare(sql).get(...a);

test('LENGTH: a note keeps up to 10000 characters and anything longer is cut there, on create and on edit; the old version is kept whole', async () => {
  const made = await call('POST', '/api/crm/notes', { accountId: acct, body: 'N'.repeat(10000) }, rep);
  assert.equal(made.status, 201);
  assert.equal(get('SELECT body FROM crm_notes WHERE id = ?', made.json.id).body.length, 10000);
  const over = await call('POST', '/api/crm/notes', { accountId: acct, body: 'N'.repeat(15000) }, rep);
  assert.equal(over.status, 201);
  assert.equal(get('SELECT body FROM crm_notes WHERE id = ?', over.json.id).body.length, 10000, 'cut at 10000');
  const edit = await call('PUT', `/api/crm/notes/${made.json.id}`, { body: 'E'.repeat(12000) }, rep);
  assert.equal(edit.status, 200);
  assert.equal(get('SELECT body FROM crm_notes WHERE id = ?', made.json.id).body.length, 10000);
  assert.equal(get('SELECT body FROM crm_note_versions WHERE note_id = ?', made.json.id).body.length, 10000, 'the earlier version is kept in full');
});

test('THE SCREEN agrees with the server: both note boxes allow 10000, and the body columns are TEXT so no alter script is needed', () => {
  const root = path.join(env.SERVER, '..');
  const panels = fs.readFileSync(path.join(root, 'crm-panels.js'), 'utf8');
  assert.match(panels, /id="noteBody" maxlength="10000"/); assert.match(panels, /id="enBody" maxlength="10000"/);
  const schema = fs.readFileSync(path.join(env.SERVER, 'db', 'schema.sql'), 'utf8');
  for (const t of ['crm_notes', 'crm_note_versions']) {
    const tbl = schema.slice(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${t} (`)).split('ENGINE')[0];
    assert.match(tbl, /\bbody TEXT NOT NULL/, `${t}.body is TEXT`);
  }
});

// Sales CRM punch list G15 (PROC-01): the standard procurement steps COI, board approval and contract; an owner on each step; files attached to a step.
// Real routes and real SQL (node:sqlite). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const env = require('./helpers/crm-env');

const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'fne-g15-files-'));
process.env.CRM_FILES_DIR = FILES;
const { db, pool } = env.makeDb();
env.install(pool);
const R = (f) => require(path.join(env.SERVER, 'routes', f));
const { server, call } = env.listen([['/api/crm/checklists', R('crm-checklists.js')], ['/api/crm/files', R('crm-files.js')], ['/api/crm/attention', R('crm-attention.js')]]);
const port = server.address().port;
test.after(() => { server.close(); fs.rmSync(FILES, { recursive: true, force: true }); });
const STD = require(path.join(env.SERVER, 'lib/crm-checklist-standard.js'));
const A = require(path.join(env.SERVER, 'lib/crm-attention.js'));

const admin = env.addAdmin(db, 'g15boss', 'admin'), sales = env.addAdmin(db, 'g15rep', 'sales'), sales2 = env.addAdmin(db, 'g15rep2', 'sales'), viewer = env.addAdmin(db, 'g15viewer', 'readonly');
env.enable(db, true);
const get = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const ymd = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const acct = Number(db.prepare("INSERT INTO crm_accounts (name, account_type) VALUES ('G15 District', 'district')").run().lastInsertRowid);
const deal = (owner) => Number(db.prepare("INSERT INTO crm_opportunities (account_id, name, stage_id, owner_admin_id, stage_entered_at) VALUES (?, 'G15 deal', 1, ?, '2026-11-01 10:00:00')").run(acct, owner).lastInsertRowid);
const mine = deal(sales), theirs = deal(sales2);
const step = (d, label = 'A step', f = {}) => Number(db.prepare('INSERT INTO crm_opportunity_checklist_items (opportunity_id, label, status, due_on, sort_order, owner_admin_id) VALUES (?, ?, ?, ?, 10, ?)').run(d, label, f.status || 'open', f.due || null, f.owner || null).lastInsertRowid);
const tpl = (name, steps, active = 1) => Number(db.prepare('INSERT INTO crm_procurement_templates (name, items_json, is_active) VALUES (?, ?, ?)').run(name, JSON.stringify(steps.map(label => ({ label }))), active).lastInsertRowid);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const file = (d, name = 'coi.pdf', item = null) => Number(db.prepare("INSERT INTO crm_attachments (opportunity_id, original_name, stored_name, kind, mime, size_bytes, uploaded_by_admin_id, checklist_item_id) VALUES (?, ?, ?, 'pdf', 'application/pdf', 100, ?, ?)").run(d, name, `s${Math.random().toString(16).slice(2)}`, admin, item).lastInsertRowid);
function upload(adminId, fields, f) {
  const boundary = '----g15' + Math.random().toString(16).slice(2); const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), f.data, Buffer.from('\r\n'), Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => { const r = http.request({ port, method: 'POST', path: '/api/crm/files', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, 'x-admin': String(adminId) } }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') })); }); r.on('error', reject); r.end(body); });
}
const reset = () => db.exec('DELETE FROM crm_opportunity_checklist_items; DELETE FROM crm_attachments; DELETE FROM crm_procurement_templates; DELETE FROM school_audit_log; DELETE FROM crm_attention_states; DELETE FROM crm_attention_events');
const list = (d, who = sales) => call('GET', `/api/crm/checklists?opportunityId=${d}`, undefined, who);

test('THE STANDARD STEPS: a saved checklist is offered only the ones it lacks (any capitals), the onboarding checklist is never offered them, and the starter list for a new install has all three', () => {
  assert.deepEqual(STD.missingFor('Standard school or district purchase', ['Purchase order received']), STD.STANDARD_EXTRA_STEPS);
  assert.deepEqual(STD.missingFor('X', ['certificate of INSURANCE (coi) sent']), STD.STANDARD_EXTRA_STEPS.slice(1));
  assert.deepEqual(STD.missingFor('Onboarding', ['Welcome call']), []); assert.deepEqual(STD.missingFor('onboarding', []), []);
  assert.deepEqual(STD.missingFor('X', STD.STANDARD_EXTRA_STEPS), []);
  assert.match(STD.STANDARD_EXTRA_STEPS.join(' '), /COI/); assert.match(STD.STANDARD_EXTRA_STEPS.join(' '), /Board/); assert.match(STD.STANDARD_EXTRA_STEPS.join(' '), /Contract/);
  const seed = fs.readFileSync(path.join(env.SERVER, 'scripts/alter-create-crm-execution.js'), 'utf8');
  for (const s of STD.STANDARD_EXTRA_STEPS) assert.ok(seed.includes(s), s);
});

test('ONE CLICK TO ADD THEM: CRM Admin only, added after the checklist\'s own steps, a second click adds nothing, deals that already copied it are not touched, and it is in the audit log', async () => {
  reset();
  const t = tpl('Standard school or district purchase', ['W-9', 'Purchase order received']), onboarding = tpl('Onboarding', ['Welcome call']);
  const d = mine; step(d, 'W-9');
  const shown = (await call('GET', '/api/crm/checklists/templates', undefined, sales)).json.templates;
  assert.deepEqual(shown.find(x => x.id === t).missingStandardSteps, STD.STANDARD_EXTRA_STEPS); assert.deepEqual(shown.find(x => x.id === onboarding).missingStandardSteps, []);
  for (const who of [sales, viewer]) assert.equal((await call('POST', `/api/crm/checklists/templates/${t}/add-standard`, {}, who)).status, 403);
  assert.equal((await call('POST', `/api/crm/checklists/templates/${t}/add-standard`, {})).status, 401); assert.equal((await call('POST', '/api/crm/checklists/templates/99999/add-standard', {}, admin)).status, 404);
  const r = await call('POST', `/api/crm/checklists/templates/${t}/add-standard`, {}, admin);
  assert.equal(r.status, 200); assert.equal(r.json.added, 3);
  const after = (await call('GET', '/api/crm/checklists/templates', undefined, admin)).json.templates.find(x => x.id === t);
  assert.deepEqual(after.steps, ['W-9', 'Purchase order received', ...STD.STANDARD_EXTRA_STEPS]); assert.deepEqual(after.missingStandardSteps, []);
  assert.equal((await call('POST', `/api/crm/checklists/templates/${t}/add-standard`, {}, admin)).json.added, 0, 'a second click adds nothing');
  assert.equal(all('SELECT * FROM crm_opportunity_checklist_items WHERE opportunity_id = ?', d).length, 1, 'a deal that already copied the checklist is untouched');
  assert.equal((await call('POST', `/api/crm/checklists/templates/${onboarding}/add-standard`, {}, admin)).json.added, 0);
  assert.ok(all("SELECT new_value FROM school_audit_log WHERE action = 'crm_checklist_template_updated'").some(r2 => r2.new_value.includes('addedStandardSteps')));
  // A copy made now carries the new steps.
  assert.equal((await call('POST', '/api/crm/checklists/apply', { opportunityId: theirs, templateId: t }, admin)).json.added, 5);
  // A full checklist takes only what fits.
  const big = tpl('Full', Array.from({ length: 29 }, (_, i) => `step ${i}`));
  assert.equal((await call('POST', `/api/crm/checklists/templates/${big}/add-standard`, {}, admin)).json.added, 1);
});

test('A STEP HAS AN OWNER: named when added or edited, checked against real staff, blank means the deal owner, shown to everyone who can read the list, and audited', async () => {
  reset();
  const add = (body, who = sales) => call('POST', '/api/crm/checklists', { opportunityId: mine, label: 'Get the COI', ...body }, who);
  assert.equal((await add({ ownerAdminId: 99999 })).status, 400); assert.equal((await add({ ownerAdminId: 'abc' })).status, 400);
  assert.equal(all('SELECT * FROM crm_opportunity_checklist_items').length, 0, 'nothing refused was saved');
  const id = (await add({ ownerAdminId: sales2 })).json.id;
  assert.equal(get('SELECT owner_admin_id o FROM crm_opportunity_checklist_items WHERE id = ?', id).o, sales2);
  const shown = (await list(mine, viewer)).json.items[0]; assert.equal(shown.ownerAdminId, sales2); assert.equal(shown.ownerName, 'g15rep2');
  assert.equal((await call('PUT', `/api/crm/checklists/${id}`, { ownerAdminId: admin }, sales)).status, 200); assert.equal(get('SELECT owner_admin_id o FROM crm_opportunity_checklist_items WHERE id = ?', id).o, admin);
  assert.equal((await call('PUT', `/api/crm/checklists/${id}`, { ownerAdminId: 99999 }, sales)).status, 400);
  assert.equal((await call('PUT', `/api/crm/checklists/${id}`, { ownerAdminId: null }, sales)).status, 200); assert.equal(get('SELECT owner_admin_id o FROM crm_opportunity_checklist_items WHERE id = ?', id).o, null);
  assert.equal((await call('PUT', `/api/crm/checklists/${id}`, { ownerAdminId: admin }, viewer)).status, 403); assert.equal((await call('PUT', `/api/crm/checklists/${id}`, { ownerAdminId: admin }, sales2)).status, 403, 'not their deal');
  assert.ok(all("SELECT new_value FROM school_audit_log WHERE action = 'crm_checklist_item_updated'").some(r => r.new_value.includes('ownerAdminId')));
});

test('THE OWNER CAN TICK THEIR OWN STEP on someone else\'s deal, and only tick it: no other change, Read-only never, a step with no owner never', async () => {
  reset();
  const s1 = step(mine, 'Owned by rep2', { owner: sales2 }), s2 = step(mine, 'Nobody owns');
  assert.equal((await call('PUT', `/api/crm/checklists/${s1}`, { status: 'done' }, sales2)).status, 200); assert.equal(get('SELECT status FROM crm_opportunity_checklist_items WHERE id = ?', s1).status, 'done');
  assert.ok(get('SELECT completed_by_admin_id c FROM crm_opportunity_checklist_items WHERE id = ?', s1).c === sales2);
  assert.equal((await call('PUT', `/api/crm/checklists/${s1}`, { status: 'open' }, sales2)).status, 200, 'and untick');
  for (const body of [{ label: 'Renamed' }, { status: 'done', label: 'Renamed' }, { ownerAdminId: sales2 }, { dueOn: ymd(3) }, { note: 'x' }]) assert.equal((await call('PUT', `/api/crm/checklists/${s1}`, body, sales2)).status, 403, JSON.stringify(body));
  assert.equal((await call('PUT', `/api/crm/checklists/${s2}`, { status: 'done' }, sales2)).status, 403);
  db.prepare('UPDATE crm_opportunity_checklist_items SET owner_admin_id = ? WHERE id = ?').run(viewer, s2);
  assert.equal((await call('PUT', `/api/crm/checklists/${s2}`, { status: 'done' }, viewer)).status, 403, 'Read-only never writes');
  assert.equal(get('SELECT label FROM crm_opportunity_checklist_items WHERE id = ?', s1).label, 'Owned by rep2');
});

test('NEEDS ATTENTION: an overdue step goes to the step\'s owner, else the deal owner', async () => {
  reset();
  const a = step(mine, 'Owned', { due: ymd(-3), owner: sales2 }), b = step(mine, 'Not owned', { due: ymd(-3) });
  const items = (await A.evaluate(pool, { today: ymd(0) })).filter(i => i.ruleKey === 'checklist_overdue');
  assert.equal(items.find(i => i.subjectId === a).ownerAdminId, sales2); assert.equal(items.find(i => i.subjectId === a).ownerName, 'g15rep2');
  assert.equal(items.find(i => i.subjectId === b).ownerAdminId, sales, 'the deal owner when the step has none');
});

test('FILES ON A STEP: pick one of the deal\'s own files or upload new; only this deal\'s steps; the list is for people who may see files; the file stays on the deal if the step goes', async () => {
  reset();
  const s1 = step(mine, 'COI'), sOther = step(theirs, 'Their step');
  const f1 = file(mine, 'coi.pdf'), fOther = file(theirs, 'theirs.pdf');
  assert.equal((await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: sOther }, sales)).status, 400, 'another deal\'s step');
  assert.equal((await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: 'abc' }, sales)).status, 400); assert.equal((await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: 99999 }, sales)).status, 400);
  assert.equal((await call('POST', `/api/crm/files/${fOther}/attach`, { checklistItemId: s1 }, sales)).status, 404, 'a file on someone else\'s deal answers like a missing one');
  assert.equal((await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: s1 }, viewer)).status, 403);
  assert.equal((await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: s1 }, sales)).status, 200);
  let d = (await list(mine, sales)).json; assert.deepEqual(d.files.map(f => [f.name, f.itemId]), [['coi.pdf', s1]]);
  assert.equal((await list(mine, admin)).json.files.length, 1);
  assert.equal((await list(mine, viewer)).json.files, null, 'Read-only is never shown files'); assert.equal((await list(theirs, sales)).json.files, null, 'nor Sales, on a deal that is not theirs');
  const up = await upload(sales, { opportunityId: mine, checklistItemId: s1 }, { name: 'logo.png', data: PNG });
  assert.equal(up.status, 201, JSON.stringify(up.json)); assert.equal(get('SELECT checklist_item_id c FROM crm_attachments WHERE id = ?', up.json.id).c, s1);
  assert.equal((await upload(sales, { opportunityId: mine, checklistItemId: sOther }, { name: 'x.png', data: PNG })).status, 400, 'another deal\'s step');
  assert.equal((await upload(sales, { accountId: acct, checklistItemId: s1 }, { name: 'x.png', data: PNG })).status, 400, 'a step belongs to a deal');
  assert.equal(all('SELECT * FROM crm_attachments WHERE opportunity_id = ?', mine).length, 2, 'a refused upload leaves nothing behind');
  assert.equal((await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: null }, sales)).status, 200); assert.equal(get('SELECT checklist_item_id c FROM crm_attachments WHERE id = ?', f1).c, null);
  await call('POST', `/api/crm/files/${f1}/attach`, { checklistItemId: s1 }, sales);
  assert.equal((await call('DELETE', `/api/crm/checklists/${s1}`, undefined, sales)).status, 200);
  assert.ok(get('SELECT id FROM crm_attachments WHERE id = ?', f1), 'the file stays on the deal'); assert.equal(get('SELECT checklist_item_id c FROM crm_attachments WHERE id = ?', f1).c, null);
  assert.ok(all("SELECT id FROM school_audit_log WHERE action = 'crm_file_attached'").length >= 2);
});

test('BEFORE THE ALTER SCRIPT: the checklist still lists and saves, and a file still uploads, when the new columns are not there', async () => {
  reset();
  const s1 = step(mine, 'Plain');
  db.exec('ALTER TABLE crm_opportunity_checklist_items DROP COLUMN owner_admin_id; ALTER TABLE crm_attachments DROP COLUMN checklist_item_id;');
  try {
    const l = await list(mine, sales); assert.equal(l.status, 200); assert.equal(l.json.items[0].ownerAdminId, null); assert.deepEqual(l.json.files, []);
    assert.equal((await call('POST', '/api/crm/checklists', { opportunityId: mine, label: 'Added' }, sales)).status, 201);
    assert.equal((await call('PUT', `/api/crm/checklists/${s1}`, { label: 'Renamed' }, sales)).status, 200);
    assert.equal((await call('DELETE', `/api/crm/checklists/${s1}`, undefined, sales)).status, 200);
    assert.equal((await upload(sales, { opportunityId: mine }, { name: 'ok.png', data: PNG })).status, 201);
    assert.ok(await A.evaluate(pool, { today: ymd(0) }));
  } finally { db.exec('ALTER TABLE crm_opportunity_checklist_items ADD COLUMN owner_admin_id INTEGER; ALTER TABLE crm_attachments ADD COLUMN checklist_item_id INTEGER;'); }
});

test('PAGES AND FILES: owner, files and the one-click button are wired and escaped; the alter script and schema carry both columns; nothing about files is at a public address', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, f), 'utf8');
  const panels = read('../crm-panels.js'), settings = read('../admin-crm-settings.html');
  for (const k of ['sOwner', 'attachDialog', 'stepFiles', 'data-detach', 'checklistItemId', '/attach']) assert.ok(panels.includes(k), k);
  assert.match(panels, /esc\(f\.name\)/); assert.match(panels, /esc\(i\.ownerName\)/); assert.match(panels, /\/api\/crm\/files\/' \+ esc\(f\.id\) \+ '\/download/);
  assert.doesNotMatch(panels, /uploads\/crm-private/);
  assert.match(settings, /data-tpl-std/); assert.match(settings, /add-standard/); assert.match(settings, /esc\(t\.missingStandardSteps/);
  for (const c of ['owner_admin_id', 'checklist_item_id']) { assert.match(read('scripts/alter-add-crm-checklist-owner-files.js'), new RegExp(c)); assert.match(read('db/schema.sql'), new RegExp(c)); }
  assert.match(read('scripts/alter-add-crm-checklist-owner-files.js'), /information_schema\.COLUMNS/);
  for (const f of ['lib/crm-checklist-standard.js', 'routes/crm-checklists.js', 'routes/crm-files.js', 'scripts/alter-add-crm-checklist-owner-files.js']) require('node:child_process').execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
});

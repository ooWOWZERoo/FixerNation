// Customer Hub: the contact / account / deal picker (crm-common.js, C.picker). The Tasks page "Add a task" dialog said "Pick what the task is about" to people who had typed a name
// and pressed Add, because the list had nothing chosen. Real crm-common.js, run with a tiny fake page. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const env = require('./helpers/crm-env');

const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');

// A fake <select>: setting innerHTML to <option value="..."> rows builds its options, like a browser.
function fakeSelect() {
  const s = { options: [], selectedIndex: -1 };
  Object.defineProperty(s, 'innerHTML', { set(html) { s.options = [...String(html).matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(m => ({ value: m[1], disabled: /disabled/.test(m[2]) })); s.selectedIndex = -1; }, get() { return ''; } });
  Object.defineProperty(s, 'value', { get() { return s.selectedIndex >= 0 && s.options[s.selectedIndex] ? s.options[s.selectedIndex].value : ''; } });
  return s;
}
function load() {
  const search = { value: '', handlers: [], addEventListener(ev, fn) { this.handlers.push(fn); } };
  const select = fakeSelect();
  const form = { querySelector(sel) { return sel.includes('data-pick-q') ? search : sel.includes('data-pick=') ? select : null; } };
  const ctx = { window: { location: { search: '', pathname: '/' } }, fnEscape: (v) => String(v), URLSearchParams, document: {}, history: {}, setTimeout, clearTimeout };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(read('crm-common.js'), ctx);
  const C = ctx.window.FnCrm;
  C.debounce = (fn) => fn; // no waiting in a test
  return { C, search, select, form };
}
const rowsOf = (...names) => names.map((n, i) => ({ id: i + 1, name: n, email: `${n.toLowerCase()}@example.com` }));
const answer = (rows) => Promise.resolve({ ok: true, data: { contacts: rows } });
const tick = () => new Promise(r => setImmediate(r));

test('PICKER (Add a task): with preselect, the first match is chosen for you, so typing a name and pressing Add works', async () => {
  const { C, select, form } = load();
  C.api = () => answer(rowsOf('Ada', 'Bo'));
  C.picker(form, 'contacts', { preselect: true });
  await tick();
  assert.equal(select.value, '1');
});

test('PICKER: a row you already clicked stays chosen when the list is refreshed by more typing; if it is gone, the first match is chosen', async () => {
  const { C, search, select, form } = load();
  let rows = rowsOf('Ada', 'Bo', 'Cy');
  C.api = () => answer(rows);
  const p = C.picker(form, 'contacts', { preselect: true });
  await tick();
  select.selectedIndex = 2; // clicked Cy
  assert.equal(select.value, '3');
  rows = rowsOf('Ada', 'Bo', 'Cy', 'Di');
  search.value = 'a'; p.refresh(); await tick();
  assert.equal(select.value, '3', 'still Cy');
  rows = rowsOf('Zed'); // Cy is no longer in the results
  p.refresh(); await tick();
  assert.equal(select.value, '1');
});

test('PICKER: merge dialogs do NOT get a row chosen for them (merging into whichever came first would be a destructive guess)', async () => {
  const { C, select, form } = load();
  C.api = () => answer(rowsOf('Ada', 'Bo'));
  C.picker(form, 'contacts'); // no preselect, as the merge dialogs call it
  await tick();
  assert.equal(select.value, '', 'nothing chosen until the person clicks');
  for (const f of ['admin-crm-contact.html', 'admin-crm-account.html']) assert.doesNotMatch(read(f), /preselect/, f);
});

test('PICKER: an answer that arrives after a newer search is dropped, and "No matches" can never be chosen', async () => {
  const { C, search, select, form } = load();
  const waiting = [];
  C.api = () => new Promise(res => waiting.push(res));
  const p = C.picker(form, 'contacts', { preselect: true });   // search 1
  search.value = 'b'; p.refresh();                               // search 2
  waiting[1]({ ok: true, data: { contacts: rowsOf('Bo') } }); await tick();
  assert.equal(select.value, '1');
  waiting[0]({ ok: true, data: { contacts: rowsOf('Old1', 'Old2') } }); await tick();
  assert.equal(select.options.length, 1, 'the slow first answer did not overwrite the newer one');
  search.value = 'nobody'; p.refresh(); waiting[2]({ ok: true, data: { contacts: [] } }); await tick();
  assert.equal(select.value, '', 'no matches: nothing is chosen');
  assert.ok(select.options[0].disabled);
});

test('PAGE: the Add a task dialog asks for the preselect, says what to do in plain words, and every CRM page loads the new crm-common.js version', () => {
  const tasks = read('admin-crm-tasks.html');
  assert.match(tasks, /C\.picker\(dlg\.form, kind, \{ preselect: true \}\)/);
  assert.match(tasks, /Click the deal, account or contact in the list first\./);
  assert.doesNotMatch(tasks, /Pick what the task is about/);
});

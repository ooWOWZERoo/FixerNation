// Help center answers edited in the browser (docs/reference/help-support-tools-requirements.md, section A). Staff save an override for a
// file answer or a brand-new answer; visitors get only published text; drafts and deleted answers never leave the staff route; the page
// lays the rows over help-center.js and falls back to the file when nothing (or nothing reachable) is saved.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const ROOT = path.join(SERVER, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE admin_users (id INTEGER PRIMARY KEY, username TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE help_answers (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', audiences TEXT NOT NULL DEFAULT 'everyone', topic TEXT NOT NULL DEFAULT '', help_topic TEXT NOT NULL DEFAULT 'other', video TEXT NOT NULL DEFAULT '', question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', steps TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0, updated_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE help_answer_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, answer_id TEXT NOT NULL, snapshot TEXT NOT NULL, saved_by INTEGER, saved_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO admin_users (id, username) VALUES (7, 'ada');
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/\?/g, () => {
    const p = rawParams[i++];
    params.push(p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};

let signedIn = true;
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: {
    requireAuth: (req, res, next) => { if (!signedIn) return res.status(401).json({ error: 'Not signed in' }); req.user = { userId: 7 }; next(); },
  },
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/help-center', require(path.join(SERVER, 'routes/help-center.js')));
app.use('/api/admin/help-answers', require(path.join(SERVER, 'routes/admin-help-answers.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, body = null) {
  return new Promise((resolve, reject) => {
    const data = body !== null ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {}, headers: res.headers }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}
const reset = () => { for (const t of ['help_answers', 'help_answer_versions', 'school_audit_log']) db.exec(`DELETE FROM ${t}`); signedIn = true; };
const good = (o = {}) => ({
  question: 'How do I find my invoice?', answer: 'Open your account page and choose Invoices.', steps: ['Sign in.', 'Choose Invoices.'],
  topic: 'Billing', helpTopic: 'billing_or_license', video: '', audiences: ['school', 'district'], status: 'published', ...o,
});

test('PUBLIC: only published text is sent; a draft or deleted answer is sent as an id to hide, with no text, history or author', async () => {
  reset();
  await call('PUT', '/api/admin/help-answers/find-invoice', good());
  await call('PUT', '/api/admin/help-answers/secret-draft', good({ question: 'Secret privacy wording?', answer: 'Not ready for visitors.', status: 'draft' }));
  await call('PUT', '/api/admin/help-answers/old-answer', good({ question: 'An old answer?', status: 'deleted' }));
  const r = await call('GET', '/api/help-center');
  assert.equal(r.status, 200);
  assert.equal(r.headers['cache-control'], 'public, max-age=60');
  assert.deepEqual(r.json.entries.map(e => e.id), ['find-invoice']);
  assert.deepEqual(r.json.entries[0], { id: 'find-invoice', for: ['school', 'district'], topic: 'Billing', help: 'billing_or_license', q: 'How do I find my invoice?', a: 'Open your account page and choose Invoices.', reviewed: true, steps: ['Sign in.', 'Choose Invoices.'] });
  assert.deepEqual(r.json.hidden.sort(), ['old-answer', 'secret-draft']);
  const raw = JSON.stringify(r.json);
  assert.ok(!/Secret privacy|Not ready|ada|updated|saved/.test(raw), 'no draft text, author or dates');
});

test('STAFF: save creates the row the first time, keeps the earlier version on each later save, and writes the audit log by id', async () => {
  reset();
  assert.equal((await call('PUT', '/api/admin/help-answers/find-invoice', good())).status, 200);
  assert.equal((await call('PUT', '/api/admin/help-answers/find-invoice', good({ answer: 'A second wording.' }))).status, 200);
  const list = await call('GET', '/api/admin/help-answers');
  assert.equal(list.json.answers.length, 1);
  assert.equal(list.json.answers[0].a, 'A second wording.');
  assert.equal(list.json.answers[0].status, 'published');
  const v = await call('GET', '/api/admin/help-answers/find-invoice/versions');
  assert.equal(v.json.versions.length, 1);
  assert.equal(v.json.versions[0].entry.a, 'Open your account page and choose Invoices.');
  assert.equal(v.json.versions[0].savedBy, 'ada');
  const log = db.prepare('SELECT action, reason, actor_id FROM school_audit_log ORDER BY id').all();
  assert.deepEqual(log.map(l => l.action), ['help_answer_created', 'help_answer_edited']);
  assert.ok(log.every(l => l.reason === 'find-invoice' && l.actor_id === 7), 'the id, never the text');
  const un = await call('PUT', '/api/admin/help-answers/find-invoice', good({ status: 'draft' }));
  assert.equal(un.status, 200);
  assert.equal(db.prepare('SELECT action FROM school_audit_log ORDER BY id DESC LIMIT 1').get().action, 'help_answer_draft');
});

test('STAFF: revert removes the override (the file answer shows again), keeping the last version; nothing to revert is a 404', async () => {
  reset();
  await call('PUT', '/api/admin/help-answers/find-invoice', good());
  assert.equal((await call('DELETE', '/api/admin/help-answers/find-invoice', {})).status, 200);
  assert.equal((await call('GET', '/api/admin/help-answers')).json.answers.length, 0);
  assert.equal((await call('GET', '/api/admin/help-answers/find-invoice/versions')).json.versions.length, 1);
  assert.equal((await call('DELETE', '/api/admin/help-answers/find-invoice', {})).status, 404);
});

test('VALIDATION: what is refused, and what is quietly tidied', async () => {
  reset();
  const put = (body, id = 'some-answer') => call('PUT', `/api/admin/help-answers/${id}`, body);
  assert.equal((await put(good(), 'Bad_Id')).status, 400, 'an id must be a lowercase slug');
  assert.equal((await put(good(), 'ab')).status, 400, 'too short');
  assert.equal((await put(good({ question: '' }))).status, 400);
  assert.equal((await put(good({ answer: '', steps: [] }))).status, 400, 'an answer or steps');
  assert.equal((await put(good({ audiences: [] }))).status, 400);
  assert.equal((await put(good({ audiences: ['martians'] }))).status, 400, 'unknown audiences are dropped, leaving none');
  assert.equal((await put(good({ helpTopic: 'nope' }))).status, 400);
  assert.equal((await put(good({ status: 'archived' }))).status, 400);
  assert.equal((await put(good({ video: 'A1; DROP' }))).status, 400);
  assert.equal((await put(good({ answer: 'Click <b>here</b>.' }))).status, 400, 'no HTML');
  assert.equal((await put(good({ question: 'x'.repeat(301) }))).status, 400);
  assert.equal((await put(good({ answer: 'x'.repeat(1201) }))).status, 400);
  assert.equal((await put(good({ question: { $gt: '' } }))).status, 400, 'an object is not text');
  const ok = await put(good({ question: 'Isn’t this “fine”?', answer: 'Yes — it is.', steps: ['  a  ', '', 'b'] }));
  assert.equal(ok.status, 200);
  assert.ok(ok.json.warnings.some(w => /long dash/.test(w)), 'a long dash is a warning, not an error');
  const saved = db.prepare('SELECT question, steps FROM help_answers WHERE id = ?').get('some-answer');
  assert.equal(saved.question, 'Isn\'t this "fine"?', 'curly quotes straightened');
  assert.deepEqual(JSON.parse(saved.steps), ['a', 'b']);
  const sens = await put(good({ question: 'What is the refund policy?' }), 'refund-answer');
  assert.ok(sens.json.warnings.some(w => /refund/i.test(w) && /draft/i.test(w)), 'sensitive wording is flagged');
  assert.equal((await put(good({ question: 'What is the refund policy?', status: 'draft' }), 'refund-draft')).json.warnings.length, 0, 'and not flagged while it is a draft');
});

test('ACCESS: every staff route is behind requireAuth; the public route reads published text only and never selects author, history or dates', async () => {
  reset();
  signedIn = false;
  for (const [m, p] of [['GET', '/api/admin/help-answers'], ['PUT', '/api/admin/help-answers/find-invoice'], ['DELETE', '/api/admin/help-answers/find-invoice'], ['GET', '/api/admin/help-answers/find-invoice/versions']]) {
    assert.equal((await call(m, p, m === 'GET' ? null : good())).status, 401, `${m} ${p}`);
  }
  assert.equal((await call('GET', '/api/help-center')).status, 200, 'visitors can read the public list');
  const staff = read('server/routes/admin-help-answers.js');
  const handlers = staff.match(/router\.(get|put|post|delete)\(/g) || [];
  const guarded = staff.match(/router\.(get|put|post|delete)\('[^']*', requireAuth,/g) || [];
  assert.equal(handlers.length, guarded.length, 'every route declares requireAuth');
  const pub = read('server/routes/help-center.js');
  assert.ok(!/updated_by|snapshot|updated_at|created_at, /.test(pub.replace(/ORDER BY[^`]*/, '')), 'the public query selects no author, history or dates');
  assert.ok(/status === 'published'/.test(pub), 'only published rows carry text');
  assert.ok(!/router\.(post|put|delete)/.test(pub), 'the public route is read-only');
  signedIn = true;
});

// ---- the page side: help-center.js laid over by the saved rows --------------------------------------------------------------------
function loadHelpCenter() {
  const ctx = { document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] }, JSON, Promise };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('help-center.js'), ctx);
  return ctx.FNHelpCenter;
}

test('PAGE: with nothing saved (or no way to reach the server) the file\'s answers are what shows', async () => {
  const HC = loadHelpCenter();
  await HC.ready;
  assert.ok(HC.entries.length >= 100);
  assert.deepEqual(JSON.parse(JSON.stringify(HC.entries)), JSON.parse(JSON.stringify(HC.base)), 'no change without rows');
});

test('PAGE: saved answers replace the file\'s answer with the same id, new ones are added, hidden ones leave the visitor list, deleted ones go', () => {
  const HC = loadHelpCenter();
  const first = HC.entries[0], second = HC.entries[1], third = HC.entries[2];
  const count = HC.entries.length;
  HC.apply({
    entries: [{ ...first, a: 'Edited wording.' }, { id: 'brand-new', for: ['teacher'], topic: 'New', help: 'other', q: 'A new question?', a: 'A new answer.', reviewed: true }],
    hidden: [second.id], removed: [third.id],
  });
  assert.equal(HC.byId(first.id).a, 'Edited wording.');
  assert.equal(HC.byId('brand-new').a, 'A new answer.');
  assert.equal(HC.entries.length, count + 1 - 1);
  assert.ok(!HC.visible(false).some(e => e.id === second.id), 'un-published: hidden from visitors');
  assert.ok(HC.visible(true).some(e => e.id === second.id), 'but still in the staff preview');
  assert.equal(HC.byId(third.id), null, 'deleted');
  assert.equal(HC.base.find(b => b.id === first.id).a, first.a, 'the file\'s own copy is kept for "revert"');
  HC.apply({ entries: [{ id: 5 }, null, { id: 'x' }] }); // junk rows are ignored
  assert.equal(HC.entries.length, count);
  HC.applyAdmin({ answers: [{ ...first, status: 'draft', reviewed: false }, { ...third, status: 'deleted' }] });
  assert.equal(HC.byId(first.id).reviewed, false, 'the staff list can turn an answer into a draft');
});

test('WIRING: the Help center and Get help pages wait for the saved answers; the editor page, schema and alter script exist; one script version everywhere', () => {
  assert.match(read('help.html'), /HC\.ready\.then/);
  assert.match(read('help.html'), /\/api\/admin\/help-answers/, 'the preview asks for drafts through the staff route');
  assert.match(read('support.html'), /FNHelpCenter\.ready\.then\(showAnswers\)/);
  const versions = ['help.html', 'support.html', 'admin-support-help.html'].map(f => read(f).match(/help-center\.js\?v=(\d+)/)[1]);
  assert.equal(new Set(versions).size, 1, 'same help-center.js version on every page');
  const editor = read('admin-support-help.html');
  assert.ok(!/innerHTML/.test(editor), 'the editor writes text with textContent only');
  assert.match(editor, /\/api\/admin\/help-answers/);
  const schema = read('server/db/schema.sql');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS help_answers/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS help_answer_versions/);
  assert.ok(fs.existsSync(path.join(SERVER, 'scripts/alter-create-help-answers.js')));
  const app = read('server/app.js');
  assert.match(app, /app\.use\('\/api\/help-center', helpCenterRoutes\)/);
  assert.match(app, /app\.use\('\/api\/admin\/help-answers', adminHelpAnswerRoutes\)/);
});

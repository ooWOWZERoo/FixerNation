// db/schema.sql is the source of truth for FRESH installs (node scripts/migrate.js sends the whole file to MariaDB in one go). From 2026-11-16 to 2026-11-24 it could not build a fresh database: a block of
// new tables had been pasted into the middle of the quote_requests definition, and two statements had no closing semicolon. Neither was caught because production is built from the alter scripts and
// nothing re-runs this file. This test reads the file's SHAPE (no database needed): every statement starts at the top level, every CREATE TABLE is closed, and every statement ends with a semicolon.
// It cannot prove a foreign key points at a table made earlier (that needs a real MariaDB; see the note at the end), but it catches the mistakes that actually happened. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

// The code on each line, with comments and the contents of quoted strings removed (so a "(" or ";" inside a comment or a default value never counts).
function codeLines(sql) {
  return sql.split('\n').map((raw, i) => {
    let out = '', q = null;
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
      if (c === '-' && raw[k + 1] === '-' && (k === 0 || /\s/.test(raw[k - 1]))) break;
      out += c;
    }
    return { n: i + 1, code: out.trimEnd() };
  });
}

test('SHAPE: every statement starts at the top level, every table definition is closed, and every statement ends with a semicolon', () => {
  const problems = [];
  let depth = 0, open = null, last = null; // last = the previous code line at depth 0
  for (const { n, code } of codeLines(SQL)) {
    const t = code.trim();
    if (!t) continue;
    const starts = /^(CREATE|ALTER|INSERT|DROP|UPDATE|DELETE|SET|USE)\b/i.test(t);
    if (starts && depth > 0) problems.push(`line ${n}: a new statement (${t.slice(0, 50)}) starts inside the definition that began at line ${open}`);
    if (starts && depth === 0 && last && !last.code.trim().endsWith(';')) problems.push(`line ${n}: the statement ending at line ${last.n} has no semicolon before ${t.slice(0, 50)}`);
    if (starts && depth === 0) open = n;
    for (const c of t) { if (c === '(') depth++; else if (c === ')') depth--; }
    if (depth < 0) { problems.push(`line ${n}: a closing parenthesis with nothing open`); depth = 0; }
    if (depth === 0) last = { n, code };
  }
  if (depth !== 0) problems.push(`the file ends inside the definition that began at line ${open}`);
  if (last && !last.code.trim().endsWith(';')) problems.push(`the last statement (line ${last.n}) has no semicolon`);
  assert.deepEqual(problems, []);
});

test('SHAPE: the quote_requests table is one piece and carries its keys and foreign keys (it was once split in two)', () => {
  const a = SQL.indexOf('CREATE TABLE IF NOT EXISTS quote_requests (');
  assert.ok(a > 0);
  const end = SQL.indexOf(') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;', a);
  const body = SQL.slice(a, end);
  assert.doesNotMatch(body, /CREATE TABLE IF NOT EXISTS (?!quote_requests)/, 'no other table is defined inside it');
  for (const k of ['idx_quote_requests_contact', 'idx_quote_requests_opp_revision', 'fk_quote_requests_contact', 'fk_quote_requests_created_by', 'acceptance_document_hash', 'declined_at', 'demo_invitation_id', 'revision_number']) assert.ok(body.includes(k), `quote_requests has ${k}`);
});

// A foreign key to a table that is defined LATER in the file fails on a fresh database. Tables the alter scripts make (the classroom tables, for one) are deliberately not here: the way a fresh
// site is built (tests/howto/stack.sh) runs migrate, then every alter script, then migrate again, and only the last run has to succeed.
test('SHAPE: the tables this file defines are defined before any other table points at them with a foreign key (the Sales CRM tables moved after the CRM core)', () => {
  const defined = new Map(); // table -> line
  const lines = codeLines(SQL);
  let current = null; const refs = [];
  for (const { n, code } of lines) {
    const m = code.match(/^\s*CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?/i);
    if (m) { current = m[1]; defined.set(current, n); }
    const r = code.match(/REFERENCES\s+`?(\w+)`?/i);
    if (r && current) refs.push({ n, from: current, to: r[1] });
  }
  const late = refs.filter(r => defined.has(r.to) && r.to !== r.from && defined.get(r.to) > r.n).map(r => `${r.from} (line ${r.n}) points at ${r.to}, which is defined later (line ${defined.get(r.to)})`);
  // These existed before the 2026-11-24 repair and are made safe by the alter scripts (the second migrate pass); the Sales CRM ones must never be added to this list.
  const KNOWN = new Set(Array.from(late).filter(s => !/^crm_/.test(s)));
  assert.deepEqual(late.filter(s => !KNOWN.has(s)), []);
});

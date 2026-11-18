// Sales CRM punch list G22 (PRD FR-CON-05): the prospect import and its review queue. Owner's answers, 2026-11-17: everyone imported is a SUSPECT and is NOT subscribed to the
// newsletter; a row whose email already belongs to someone only fills that person's blank fields; a row that looks like someone already there but has a different email waits in a
// review queue for a person to decide; the Organization column links to an existing account by exact name and never creates one.
//
// Rules this file keeps (each has a test):
//  - Nothing is merged, overwritten or deleted. An existing person is only ever given what they were missing (name, company, state, phone). Their label, owner, subscription and
//    every other field are never touched, and an existing person is never added to an account by an import.
//  - A row is AMBIGUOUS (queued, not added) when no email matches but it has the same mailbox once a + tag is removed, or the same full name (two or more words), as someone already
//    in the CRM. A shared email DOMAIN is never a signal (two people at one school share one). Staff pick: same person (fill blanks), different person (add), or skip.
//  - The label is always Suspect (reconcileContact may only ever move it forward from a real quote or purchase); the subscription is always Unsubscribed (no consent is on record);
//    the source says it was an import. Test addresses (@example.com) are refused, so a test file never fills the CRM.
//  - The server plans every run itself: a preview is only a plan, and the commit re-plans from the rows it is given. At most MAX_ROWS rows; each field is cut to its length.
//  - An import writes one audit row per run with counts only (no names, no emails).
// `conn` is the pool in the route and any query-capable handle in tests. SQL stays portable.
const cls = require('./crm-classification');
const { audit } = require('./audit');

const MAX_ROWS = 400;
const EMAIL_SHAPE = /^[^\s@<>",;:\\()[\]]+@[^\s@<>",;:\\()[\]]+\.[^\s@<>",;:\\()[\]]+$/;
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
const isDuplicate = (err) => err && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(String(err.message)));
class Refusal extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code || null; } }

const norm = (s) => String(s || '').trim().toLowerCase();
const cut = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
function mailboxKey(email) {
  const e = norm(email); const at = e.lastIndexOf('@');
  if (at < 1) return null;
  const local = e.slice(0, at).split('+')[0];
  return local ? `${local}@${e.slice(at + 1)}` : null;
}
function nameKey(n) { const k = norm(n).replace(/\s+/g, ' '); return k.split(' ').length >= 2 && k.length >= 5 ? k : null; }

// One row as typed -> the clean row, or { problem }.
function cleanRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'This row is not a set of fields.' };
  const email = cut(raw.email, 254).toLowerCase();
  if (!email || !EMAIL_SHAPE.test(email)) return { problem: 'No usable email address.' };
  if (email.endsWith('@example.com')) return { problem: 'A test address (example.com) is never imported.' };
  return { email, name: cut(raw.name, 255), company: cut(raw.company, 255), organization: cut(raw.organization, 255), state: cut(raw.state, 64), phone: cut(raw.phone, 32), title: cut(raw.title, 128) };
}

// Decides what would happen to each row. Reads only.
async function plan(conn, rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Refusal(400, 'There are no rows to import.');
  if (rawRows.length > MAX_ROWS) throw new Refusal(400, `Import at most ${MAX_ROWS} people at a time. Split the file and import it in parts.`);
  const [people] = await conn.query('SELECT id, name, email FROM newsletter_contacts');
  const byEmail = new Map(), byMailbox = new Map(), byName = new Map();
  for (const p of people) {
    if (norm(p.email).endsWith('@example.com')) continue;
    byEmail.set(norm(p.email), p);
    const mk = mailboxKey(p.email); if (mk) (byMailbox.get(mk) || byMailbox.set(mk, []).get(mk)).push(p);
    const nk = nameKey(p.name); if (nk) (byName.get(nk) || byName.set(nk, []).get(nk)).push(p);
  }
  const [accts] = await conn.query('SELECT id, name FROM crm_accounts WHERE archived_at IS NULL');
  const byAcct = new Map();
  for (const a of accts) { const k = norm(a.name); if (k) (byAcct.get(k) || byAcct.set(k, []).get(k)).push(Number(a.id)); }
  const seen = new Set();
  const rows = rawRows.map((raw, index) => {
    const row = cleanRow(raw);
    if (row.problem) return { index, decision: 'invalid', problem: row.problem, input: { email: cut(raw && raw.email, 254) } };
    if (seen.has(row.email)) return { index, decision: 'repeated', problem: 'This email is already in the file above.', input: row };
    seen.add(row.email);
    const hit = byEmail.get(row.email);
    if (hit) return { index, decision: 'exists', contactId: Number(hit.id), input: row };
    const cand = new Map();
    for (const p of byMailbox.get(mailboxKey(row.email)) || []) cand.set(Number(p.id), { id: Number(p.id), name: p.name || '', email: p.email, reason: 'same_mailbox' });
    const nk = nameKey(row.name);
    for (const p of (nk && byName.get(nk)) || []) if (!cand.has(Number(p.id))) cand.set(Number(p.id), { id: Number(p.id), name: p.name || '', email: p.email, reason: 'same_name' });
    let accountId = null, accountNote = null;
    if (row.organization) {
      const ids = byAcct.get(norm(row.organization)) || [];
      if (ids.length === 1) accountId = ids[0]; else accountNote = ids.length ? 'More than one account has that name, so the person was not added to one.' : 'No account has that exact name, so the person was not added to one.';
    }
    if (cand.size) { const list = [...cand.values()]; return { index, decision: 'review', reason: list.some(c => c.reason === 'same_mailbox') ? 'same_mailbox' : 'same_name', candidates: list, accountId, accountNote, input: row }; }
    return { index, decision: 'new', accountId, accountNote, input: row };
  });
  const counts = { total: rows.length, new: 0, exists: 0, review: 0, left_out: 0 };
  for (const r of rows) { if (r.decision === 'new') counts.new++; else if (r.decision === 'exists') counts.exists++; else if (r.decision === 'review') counts.review++; else counts.left_out++; }
  return { rows, counts };
}

// Fills only the blanks of an existing person from a row. Returns true when anything was missing.
async function fillBlanks(conn, contactId, row) {
  const [[c]] = await conn.query('SELECT name, company, state, phone FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!c) return false;
  const set = [], vals = [];
  for (const [col, key] of [['name', 'name'], ['company', 'company'], ['state', 'state'], ['phone', 'phone']]) {
    if ((!c[col] || !String(c[col]).trim()) && row[key]) { set.push(`${col} = ?`); vals.push(row[key]); }
  }
  if (!set.length) return false;
  await conn.query(`UPDATE newsletter_contacts SET ${set.join(', ')} WHERE id = ?`, [...vals, contactId]);
  return true;
}

// Adds one new Suspect, not subscribed. Returns the new id, or null when the email turned up in the meantime (then the caller treats it as already there).
async function addPerson(conn, row, accountId, adminId, today) {
  let id;
  try {
    const [r] = await conn.query('INSERT INTO newsletter_contacts (name, email, company, state, phone, source, status, crm_source, assigned_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [row.name, row.email, row.company || row.organization, row.state, row.phone, 'Sales CRM import', 'Unsubscribed', 'crm_import', adminId]);
    id = Number(r.insertId);
  } catch (err) { if (isDuplicate(err)) return null; throw err; }
  if (accountId) await conn.query('INSERT INTO crm_account_contacts (account_id, contact_id, title, started_on) VALUES (?, ?, ?, ?)', [accountId, id, row.title || null, today]);
  await cls.reconcileContact(conn, id, { actorAdminId: adminId });
  return id;
}

// Runs an import: plans it again from the rows given, then writes. Returns { batchId, counts }.
async function run(conn, rawRows, { batchName, adminId, now }) {
  const name = cut(batchName, 120);
  if (!name) throw new Refusal(400, 'Give this import a short name, like "Spring conference list", so you can find these people later.');
  const p = await plan(conn, rawRows);
  const today = String(now).slice(0, 10);
  let batchId;
  try {
    const [b] = await conn.query('INSERT INTO crm_import_batches (name, total_rows, created_by_admin_id, created_at) VALUES (?, ?, ?, ?)', [name, p.counts.total, adminId, now]);
    batchId = Number(b.insertId);
  } catch (err) { if (isMissing(err)) throw new Refusal(503, 'Importing people is not available yet. Please try again later.', 'not_available'); throw err; }
  const out = { added: 0, already_there: 0, queued: 0, left_out: p.counts.left_out };
  for (const r of p.rows) {
    if (r.decision === 'exists') { await fillBlanks(conn, r.contactId, r.input); out.already_there++; }
    else if (r.decision === 'new') {
      const id = await addPerson(conn, r.input, r.accountId, adminId, today);
      if (id) out.added++; else { const [[h]] = await conn.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = ?', [r.input.email]); if (h) await fillBlanks(conn, h.id, r.input); out.already_there++; }
    } else if (r.decision === 'review') {
      await conn.query('INSERT INTO crm_import_review (batch_id, name, email, company, state_text, phone, title, account_id, reason, candidates_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [batchId, r.input.name, r.input.email, r.input.company || r.input.organization, r.input.state, r.input.phone, r.input.title, r.accountId, r.reason, JSON.stringify(r.candidates.map(c => c.id)), now]);
      out.queued++;
    }
  }
  await conn.query('UPDATE crm_import_batches SET added = ?, already_there = ?, queued = ?, left_out = ? WHERE id = ?', [out.added, out.already_there, out.queued, out.left_out, batchId]);
  await audit(conn, { actorType: 'admin', actorId: adminId, action: 'crm_import_run', entityType: 'crm_import', entityId: batchId, newValue: { total: p.counts.total, ...out }, reason: 'A list of people was imported as Suspects, not subscribed to the newsletter.' });
  return { batchId, counts: { total: p.counts.total, ...out } };
}

// The review queue, newest first, each with the people it might be.
async function listReview(conn, { state = 'waiting', limit = 50, offset = 0 } = {}) {
  let rows, total;
  try {
    [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM crm_import_review WHERE state = ?', [state]);
    [rows] = await conn.query(`SELECT r.*, b.name AS batch_name FROM crm_import_review r JOIN crm_import_batches b ON b.id = r.batch_id WHERE r.state = ? ORDER BY r.id DESC LIMIT ${Number(limit) || 50} OFFSET ${Number(offset) || 0}`, [state]);
  } catch (err) { if (isMissing(err)) throw new Refusal(503, 'Importing people is not available yet. Please try again later.', 'not_available'); throw err; }
  const ids = [...new Set(rows.flatMap(r => { try { return JSON.parse(r.candidates_json); } catch { return []; } }).map(Number).filter(Boolean))];
  const people = new Map();
  if (ids.length) { const [c] = await conn.query('SELECT id, name, email, crm_classification FROM newsletter_contacts WHERE id IN (?)', [ids]); c.forEach(x => people.set(Number(x.id), x)); }
  return { total: Number(total), items: rows.map(r => ({
    id: Number(r.id), batchName: r.batch_name, state: r.state, reason: r.reason, createdAt: r.created_at,
    row: { name: r.name || '', email: r.email, company: r.company || '', state: r.state_text || '', phone: r.phone || '', title: r.title || '' }, accountId: r.account_id ? Number(r.account_id) : null,
    candidates: (() => { try { return JSON.parse(r.candidates_json).map(Number).map(id => people.get(id)).filter(Boolean).map(x => ({ id: Number(x.id), name: x.name || '', email: x.email, classification: x.crm_classification || 'suspect' })); } catch { return []; } })(),
  })) };
}

// action: 'same_person' (needs contactId, one of the candidates: only fills blanks), 'different_person' (adds them as a new Suspect) or 'skip'. Compare-and-set on waiting.
async function resolveReview(conn, id, { action, contactId, adminId, now }) {
  if (!['same_person', 'different_person', 'skip'].includes(action)) throw new Refusal(400, 'Choose same person, different person or skip.');
  let r;
  try { [[r]] = await conn.query('SELECT * FROM crm_import_review WHERE id = ?', [Number(id) || 0]); } catch (err) { if (isMissing(err)) throw new Refusal(503, 'Importing people is not available yet.', 'not_available'); throw err; }
  if (!r) throw new Refusal(404, 'That item was not found.');
  if (r.state !== 'waiting') throw new Refusal(409, 'This one was already decided. Reload the page.', 'decided');
  const row = { email: r.email, name: r.name || '', company: r.company || '', organization: r.company || '', state: r.state_text || '', phone: r.phone || '', title: r.title || '' };
  let resolved = null, newState = action === 'skip' ? 'skipped' : action;
  if (action === 'same_person') {
    let cands = []; try { cands = JSON.parse(r.candidates_json).map(Number); } catch { cands = []; }
    const pick = Number(contactId);
    if (!pick || !cands.includes(pick)) throw new Refusal(400, 'Pick which person it is from the list.');
    resolved = pick;
  }
  const [u] = await conn.query("UPDATE crm_import_review SET state = ?, resolved_contact_id = ?, decided_by_admin_id = ?, decided_at = ? WHERE id = ? AND state = 'waiting'", [newState, resolved, adminId, now, r.id]);
  if (!u.affectedRows) throw new Refusal(409, 'This one was already decided. Reload the page.', 'decided');
  let result = null;
  if (action === 'same_person') { await fillBlanks(conn, resolved, row); result = { contactId: resolved }; }
  else if (action === 'different_person') {
    const newId = await addPerson(conn, row, r.account_id ? Number(r.account_id) : null, adminId, String(now).slice(0, 10));
    if (newId) { await conn.query('UPDATE crm_import_review SET resolved_contact_id = ? WHERE id = ?', [newId, r.id]); result = { contactId: newId }; }
    else result = { contactId: null, note: 'That email was added in the meantime, so nobody new was made.' };
  }
  await audit(conn, { actorType: 'admin', actorId: adminId, action: 'crm_import_review_decided', entityType: 'crm_import', entityId: r.id, newValue: { decision: action, contactId: result ? result.contactId : null } });
  return { id: Number(r.id), state: newState, ...(result || {}) };
}

module.exports = { MAX_ROWS, isMissing, Refusal, cleanRow, mailboxKey, nameKey, plan, run, listReview, resolveReview };

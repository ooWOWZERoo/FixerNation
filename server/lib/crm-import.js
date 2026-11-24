// Sales CRM punch list G22 (PRD FR-CON-05): the prospect import and its review queue. Owner's answers, 2026-11-17: everyone imported is a SUSPECT and is NOT subscribed to the
// newsletter; a row whose email already belongs to someone only fills that person's blank fields; a row that looks like someone already there but has a different email waits in a
// review queue for a person to decide; the Organization column links to an existing account by exact name and never creates one.
//
// Rules this file keeps (each has a test):
//  - Nothing is merged, overwritten or deleted. An existing person is only ever given what they were missing (name, company, state, phone). Their label, owner, subscription and
//    every other field are never touched, and an existing person is never added to an account by an import.
//  - A row is AMBIGUOUS (queued, not added) when no email matches but it has the same mailbox once a + tag is removed, or the same full name (two or more words), as someone already
//    in the CRM. A shared email DOMAIN is never a signal (two people at one school share one). Staff pick: same person (fill blanks), different person (add), or skip.
//  - Similar names only SUGGEST: an organization with no exact account match is shown with up to three look-alike accounts, and is linked to one only when a person picked it (the pick
//    must be one of the suggestions the server itself works out, so an id typed into a request links nothing). A person whose full name is one letter off someone already in the CRM
//    (same last word) is queued for review like an exact name, never added or merged. An import never creates an account.
//  - The label is always Suspect (reconcileContact may only ever move it forward from a real quote or purchase); the subscription is always Unsubscribed (no consent is on record);
//    the source says it was an import. Test addresses (@example.com) are refused, so a test file never fills the CRM.
//  - The server plans every run itself: a preview is only a plan, and the commit re-plans from the rows it is given. At most MAX_ROWS rows; each field is cut to its length.
//  - An import writes one audit row per run with counts only (no names, no emails). Each person it CREATES is also listed in crm_import_people (lib/crm-import-undo.js), so a CRM Admin can
//    undo the import: only those people, and only while nobody has touched them.
//  - Merge phase 5 (the older CRM page's importer folded in): a row may also carry a street, city, ZIP, signup date, source, notes and email groups. A NEW person gets them all; an EXISTING
//    person only gets blanks filled (street, city, ZIP, notes too) and is added to the groups named (never taken out of one). A group that does not exist is created only when the person
//    running the import says so, otherwise it is skipped and reported. The consent rule above does not change: nobody is subscribed. With `withCrm` false (the Customer Hub is switched off)
//    the Organization column, the label and the owner are left alone, and everything else works the same.
// `conn` is the pool in the route and any query-capable handle in tests. SQL stays portable.
const cls = require('./crm-classification');
const { audit } = require('./audit');
const U = require('./crm-import-undo'); // the list of who an import created, so it can be undone
const NM = require('./crm-name-match'); // names that are alike: SUGGESTIONS for a person only, never a link made by itself

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
  const picked = Number(raw.pickedAccountId);
  return { email, name: cut(raw.name, 255), company: cut(raw.company, 255), organization: cut(raw.organization, 255), state: cut(raw.state, 64), phone: cut(raw.phone, 32), title: cut(raw.title, 128), pickedAccountId: Number.isInteger(picked) && picked > 0 ? picked : null,
    street: cut(raw.street, 255), city: cut(raw.city, 128), zip: cut(raw.zip, 16), notes: cutNotes(raw.notes, 15000), source: cut(raw.source, 100), signup: signupDate(raw.signupDate), groups: groupNames(raw.groups) };
}

// A note keeps its line breaks (only control characters are removed).
const cutNotes = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
// A real calendar date in the file ('2026-09-05', '9/5/2026', or a full date-time) -> 'YYYY-MM-DD HH:MM:SS' (UTC), or null when it is blank or not a date; a bad date never blocks the row.
function signupDate(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 40) return null;
  const d = new Date(v.trim());
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getTime() > Date.now() + 86400000) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
const MAX_GROUPS_PER_ROW = 20;
// Group names as a list: a list of names, or one text with the names separated by | (the older importer's format). Each is cut to the column's size; repeats (any capitalisation) are dropped.
function groupNames(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split('|') : [];
  const seen = new Set(), out = [];
  for (const x of list) {
    const name = cut(x, 128);
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
    if (out.length >= MAX_GROUPS_PER_ROW) break;
  }
  return out;
}

// Decides what would happen to each row. Reads only.
async function plan(conn, rawRows, { withCrm = true } = {}) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Refusal(400, 'There are no rows to import.');
  if (rawRows.length > MAX_ROWS) throw new Refusal(400, `Import at most ${MAX_ROWS} people at a time. Split the file and import it in parts.`);
  const [people] = await conn.query('SELECT id, name, email FROM newsletter_contacts');
  const byEmail = new Map(), byMailbox = new Map(), byName = new Map(), byLast = new Map();
  for (const p of people) {
    if (norm(p.email).endsWith('@example.com')) continue;
    byEmail.set(norm(p.email), p);
    const mk = mailboxKey(p.email); if (mk) (byMailbox.get(mk) || byMailbox.set(mk, []).get(mk)).push(p);
    const nk = nameKey(p.name); if (nk) (byName.get(nk) || byName.set(nk, []).get(nk)).push(p);
    const lw = NM.lastWord(p.name); if (lw) (byLast.get(lw) || byLast.set(lw, []).get(lw)).push(p);
  }
  // The email groups that exist, by name, so each row's group names can be turned into ids (and the ones that do not exist reported).
  const [grp] = await conn.query('SELECT id, name FROM contact_groups');
  const groupIdByName = new Map(grp.map(g => [norm(g.name), Number(g.id)]));
  const missingGroups = new Map();
  // With the Customer Hub off the Organization column is not matched to an account (accounts are Hub data); it is kept as the person's company text instead.
  const [accts] = withCrm ? await conn.query('SELECT id, name, account_type, state FROM crm_accounts WHERE archived_at IS NULL') : [[]];
  const byAcct = new Map();
  for (const a of accts) { const k = norm(a.name); if (k) (byAcct.get(k) || byAcct.set(k, []).get(k)).push(Number(a.id)); }
  const prepared = accts.map(a => NM.prepare({ id: Number(a.id), name: a.name, accountType: a.account_type, state: a.state }));
  const seen = new Set();
  const rows = rawRows.map((raw, index) => {
    const row = cleanRow(raw);
    if (row.problem) return { index, decision: 'invalid', problem: row.problem, input: { email: cut(raw && raw.email, 254) } };
    if (seen.has(row.email)) return { index, decision: 'repeated', problem: 'This email is already in the file above.', input: row };
    seen.add(row.email);
    for (const g of row.groups) if (!groupIdByName.has(norm(g)) && !missingGroups.has(norm(g))) missingGroups.set(norm(g), g);
    const hit = byEmail.get(row.email);
    if (hit) return { index, decision: 'exists', contactId: Number(hit.id), input: row };
    const cand = new Map();
    for (const p of byMailbox.get(mailboxKey(row.email)) || []) cand.set(Number(p.id), { id: Number(p.id), name: p.name || '', email: p.email, reason: 'same_mailbox' });
    const nk = nameKey(row.name);
    for (const p of (nk && byName.get(nk)) || []) if (!cand.has(Number(p.id))) cand.set(Number(p.id), { id: Number(p.id), name: p.name || '', email: p.email, reason: 'same_name' });
    const lw = NM.lastWord(row.name);
    for (const p of (lw && byLast.get(lw)) || []) if (!cand.has(Number(p.id)) && NM.similarPersonName(row.name, p.name)) cand.set(Number(p.id), { id: Number(p.id), name: p.name || '', email: p.email, reason: 'similar_name' });
    let accountId = null, accountNote = null, suggestedAccounts = [];
    if (row.organization && withCrm) {
      const ids = byAcct.get(norm(row.organization)) || [];
      if (ids.length === 1) accountId = ids[0];
      else if (ids.length) accountNote = 'More than one account has that name, so the person was not added to one.';
      else {
        // No exact match: look-alikes are offered to a person; the person's pick counts only if it is one of these.
        suggestedAccounts = NM.suggestFor({ name: row.organization, state: row.state }, prepared, { limit: 3 });
        const pick = suggestedAccounts.find(a => a.id === row.pickedAccountId);
        if (pick) accountId = pick.id;
        else accountNote = suggestedAccounts.length ? 'No account has that exact name. Pick one of the similar accounts to put the person on it.' : 'No account has that exact name, so the person was not added to one.';
      }
    }
    if (cand.size) { const list = [...cand.values()]; return { index, decision: 'review', reason: ['same_mailbox', 'same_name', 'similar_name'].find(k => list.some(c => c.reason === k)), candidates: list, accountId, accountNote, suggestedAccounts, input: row }; }
    return { index, decision: 'new', accountId, accountNote, suggestedAccounts, input: row };
  });
  const counts = { total: rows.length, new: 0, exists: 0, review: 0, left_out: 0 };
  for (const r of rows) { if (r.decision === 'new') counts.new++; else if (r.decision === 'exists') counts.exists++; else if (r.decision === 'review') counts.review++; else counts.left_out++; }
  return { rows, counts, groupIdByName, missingGroups: [...missingGroups.values()] };
}

// Turns a row's group names into ids (the ones that exist). Names that do not exist are simply left out here; run() creates them first when asked to.
const groupIdsFor = (row, groupIdByName) => row.groups.map(g => groupIdByName.get(norm(g))).filter(Boolean);

// Adds a person to the groups given. Never takes anyone out of one, and a membership already there is left alone.
async function addToGroups(conn, contactId, groupIds) {
  if (!groupIds.length) return;
  const [have] = await conn.query('SELECT group_id FROM contact_group_members WHERE contact_id = ?', [contactId]);
  const there = new Set(have.map(r => Number(r.group_id)));
  for (const gid of groupIds) if (!there.has(gid)) { await conn.query('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)', [contactId, gid]); there.add(gid); }
}

// Fills only the blanks of an existing person from a row. Returns true when anything was missing.
async function fillBlanks(conn, contactId, row) {
  const [[c]] = await conn.query('SELECT name, company, state, phone, street, city, zip, notes FROM newsletter_contacts WHERE id = ?', [contactId]);
  if (!c) return false;
  const set = [], vals = [];
  for (const [col, key] of [['name', 'name'], ['company', 'company'], ['state', 'state'], ['phone', 'phone'], ['street', 'street'], ['city', 'city'], ['zip', 'zip'], ['notes', 'notes']]) {
    if ((!c[col] || !String(c[col]).trim()) && row[key]) { set.push(`${col} = ?`); vals.push(row[key]); }
  }
  if (!set.length) return false;
  await conn.query(`UPDATE newsletter_contacts SET ${set.join(', ')} WHERE id = ?`, [...vals, contactId]);
  return true;
}

// Adds one new person, not subscribed (and, with the Hub on, a Suspect owned by whoever ran the import). Returns the new id, or null when the email turned up in the meantime (then the caller
// treats it as already there). `withCrm` false (Hub off): no owner, no import source tag, no account, no label work.
async function addPerson(conn, row, accountId, adminId, today, { withCrm = true, groupIds = [] } = {}) {
  let id;
  const source = row.source || (withCrm ? 'Sales CRM import' : 'Bulk Import');
  try {
    const cols = ['name', 'email', 'company', 'state', 'phone', 'street', 'city', 'zip', 'notes', 'source', 'status'];
    const vals = [row.name, row.email, row.company || row.organization, row.state, row.phone, row.street || '', row.city || '', row.zip || '', row.notes || '', source, 'Unsubscribed'];
    if (row.signup) { cols.push('signup_date'); vals.push(row.signup); }
    if (withCrm) { cols.push('crm_source', 'assigned_admin_id'); vals.push('crm_import', adminId); }
    const [r] = await conn.query(`INSERT INTO newsletter_contacts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, vals);
    id = Number(r.insertId);
  } catch (err) { if (isDuplicate(err)) return null; throw err; }
  await addToGroups(conn, id, groupIds);
  if (withCrm) {
    if (accountId) await conn.query('INSERT INTO crm_account_contacts (account_id, contact_id, title, started_on) VALUES (?, ?, ?, ?)', [accountId, id, row.title || null, today]);
    await cls.reconcileContact(conn, id, { actorAdminId: adminId });
  }
  return id;
}

// Runs an import: plans it again from the rows given, then writes. Returns { batchId, counts, groupsCreated, groupsSkipped }.
// createMissingGroups: make the email groups the file names that do not exist yet (otherwise those tags are skipped and reported).
async function run(conn, rawRows, { batchName, adminId, now, createMissingGroups = false, withCrm = true }) {
  const name = cut(batchName, 120);
  if (!name) throw new Refusal(400, 'Give this import a short name, like "Spring conference list", so you can find these people later.');
  const p = await plan(conn, rawRows, { withCrm });
  const today = String(now).slice(0, 10);
  let batchId;
  try {
    const [b] = await conn.query('INSERT INTO crm_import_batches (name, total_rows, created_by_admin_id, created_at) VALUES (?, ?, ?, ?)', [name, p.counts.total, adminId, now]);
    batchId = Number(b.insertId);
  } catch (err) { if (isMissing(err)) throw new Refusal(503, 'Importing people is not available yet. Please try again later.', 'not_available'); throw err; }
  const groupsCreated = [], groupsSkipped = [];
  for (const g of p.missingGroups) {
    if (!createMissingGroups) { groupsSkipped.push(g); continue; }
    try { const [r] = await conn.query('INSERT INTO contact_groups (name) VALUES (?)', [g]); p.groupIdByName.set(norm(g), Number(r.insertId)); groupsCreated.push(g); }
    catch (err) { if (!isDuplicate(err)) throw err; const [[x]] = await conn.query('SELECT id FROM contact_groups WHERE name = ?', [g]); if (x) p.groupIdByName.set(norm(g), Number(x.id)); }
  }
  const out = { added: 0, already_there: 0, queued: 0, left_out: p.counts.left_out };
  for (const r of p.rows) {
    if (r.decision === 'exists') { await fillBlanks(conn, r.contactId, r.input); await addToGroups(conn, r.contactId, groupIdsFor(r.input, p.groupIdByName)); out.already_there++; }
    else if (r.decision === 'new') {
      const id = await addPerson(conn, r.input, r.accountId, adminId, today, { withCrm, groupIds: groupIdsFor(r.input, p.groupIdByName) });
      if (id) { out.added++; await U.recordCreated(conn, { batchId, contactId: id, accountId: r.accountId, row: r.input, title: r.input.title || null, today }); } else { const [[h]] = await conn.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = ?', [r.input.email]); if (h) { await fillBlanks(conn, h.id, r.input); await addToGroups(conn, h.id, groupIdsFor(r.input, p.groupIdByName)); } out.already_there++; }
    } else if (r.decision === 'review') {
      // What the Customer Hub's review table has columns for, plus the rest of the row (address, notes, source, signup date, group names) in extra_json so nothing is lost while it waits.
      const extra = JSON.stringify({ street: r.input.street, city: r.input.city, zip: r.input.zip, notes: r.input.notes, source: r.input.source, signup: r.input.signup, groups: r.input.groups });
      const base = [batchId, r.input.name, r.input.email, r.input.company || r.input.organization, r.input.state, r.input.phone, r.input.title, r.accountId, r.reason, JSON.stringify(r.candidates.map(c => c.id)), now];
      try {
        await conn.query('INSERT INTO crm_import_review (batch_id, name, email, company, state_text, phone, title, account_id, reason, candidates_json, created_at, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [...base, extra]);
      } catch (err) {
        if (!isMissing(err)) throw err; // the extra_json update has not been run yet: the row still waits, without its extras
        await conn.query('INSERT INTO crm_import_review (batch_id, name, email, company, state_text, phone, title, account_id, reason, candidates_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', base);
      }
      out.queued++;
    }
  }
  await conn.query('UPDATE crm_import_batches SET added = ?, already_there = ?, queued = ?, left_out = ? WHERE id = ?', [out.added, out.already_there, out.queued, out.left_out, batchId]);
  await audit(conn, { actorType: 'admin', actorId: adminId, action: 'crm_import_run', entityType: 'crm_import', entityId: batchId, newValue: { total: p.counts.total, ...out, groupsCreated: groupsCreated.length, groupsSkipped: groupsSkipped.length, withCrm }, reason: 'A list of people was imported, not subscribed to the newsletter.' });
  return { batchId, counts: { total: p.counts.total, ...out }, groupsCreated, groupsSkipped };
}

// The rest of a queued row (address, notes, source, signup date, group names), or nothing for a row queued before extra_json existed.
function extraOf(r) {
  let x = {}; try { x = JSON.parse(r.extra_json || '{}') || {}; } catch { x = {}; }
  return { street: cut(x.street, 255), city: cut(x.city, 128), zip: cut(x.zip, 16), notes: cutNotes(x.notes, 15000), source: cut(x.source, 100), signup: typeof x.signup === 'string' ? x.signup : null, groups: groupNames(x.groups) };
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
    row: { name: r.name || '', email: r.email, company: r.company || '', state: r.state_text || '', phone: r.phone || '', title: r.title || '', ...extraOf(r) }, accountId: r.account_id ? Number(r.account_id) : null,
    candidates: (() => { try { return JSON.parse(r.candidates_json).map(Number).map(id => people.get(id)).filter(Boolean).map(x => ({ id: Number(x.id), name: x.name || '', email: x.email, classification: x.crm_classification || 'suspect' })); } catch { return []; } })(),
  })) };
}

// action: 'same_person' (needs contactId, one of the candidates: only fills blanks), 'different_person' (adds them as a new Suspect) or 'skip'. Compare-and-set on waiting.
async function resolveReview(conn, id, { action, contactId, adminId, now, withCrm = true }) {
  if (!['same_person', 'different_person', 'skip'].includes(action)) throw new Refusal(400, 'Choose same person, different person or skip.');
  let r;
  try { [[r]] = await conn.query('SELECT * FROM crm_import_review WHERE id = ?', [Number(id) || 0]); } catch (err) { if (isMissing(err)) throw new Refusal(503, 'Importing people is not available yet.', 'not_available'); throw err; }
  if (!r) throw new Refusal(404, 'That item was not found.');
  if (r.state !== 'waiting') throw new Refusal(409, 'This one was already decided. Reload the page.', 'decided');
  const row = { email: r.email, name: r.name || '', company: r.company || '', organization: r.company || '', state: r.state_text || '', phone: r.phone || '', title: r.title || '', ...extraOf(r) };
  // The groups the row named, as far as they exist now (deciding a queued row never creates a group).
  const [grp] = await conn.query('SELECT id, name FROM contact_groups');
  const gids = groupIdsFor(row, new Map(grp.map(g => [norm(g.name), Number(g.id)])));
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
  if (action === 'same_person') { await fillBlanks(conn, resolved, row); await addToGroups(conn, resolved, gids); result = { contactId: resolved }; }
  else if (action === 'different_person') {
    const newId = await addPerson(conn, row, r.account_id ? Number(r.account_id) : null, adminId, String(now).slice(0, 10), { withCrm, groupIds: gids });
    if (newId) {
      await conn.query('UPDATE crm_import_review SET resolved_contact_id = ? WHERE id = ?', [newId, r.id]); result = { contactId: newId };
      await U.recordCreated(conn, { batchId: Number(r.batch_id), contactId: newId, accountId: r.account_id ? Number(r.account_id) : null, viaReviewId: Number(r.id), row, title: row.title || null, today: String(now).slice(0, 10) });
    }
    else result = { contactId: null, note: 'That email was added in the meantime, so nobody new was made.' };
  }
  await audit(conn, { actorType: 'admin', actorId: adminId, action: 'crm_import_review_decided', entityType: 'crm_import', entityId: r.id, newValue: { decision: action, contactId: result ? result.contactId : null } });
  return { id: Number(r.id), state: newState, ...(result || {}) };
}

module.exports = { MAX_ROWS, isMissing, Refusal, cleanRow, mailboxKey, nameKey, plan, run, listReview, resolveReview };

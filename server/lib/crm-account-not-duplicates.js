// Customer Hub follow-up to G17: the "not a duplicate" memory for the account duplicate review.
//
// A person looks at two accounts that share a website address (or, later, a similar name), decides they are separate organizations, and says so. The pair is remembered here and stops being
// listed; undoing it brings the pair back. This changes NOTHING about either account (no merge, no archive, no edit): it only decides what the review list shows.
//
// Rules kept (each has a test):
//  - A pair is two different accounts, stored lower id first, once. Marking it again changes nothing and is not an error.
//  - A group of three or more is filtered by PAIR: with A-B marked, A-C and B-C are still suspected, so one group of three stays; mark every pair and the group is gone.
//  - A database without the table yet (the alter script has not run) behaves as "nothing remembered": the list still works, and marking says it is not available yet.
//  - The list code (duplicateAccounts / duplicatesOf, lib/crm-account-rollups.js) stays read only and knows nothing of this memory; the filter is applied after it.
const isMissing = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such table|no such column/i.test(String(err.message)));
const isDuplicateKey = (err) => err && (err.code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(String(err.message)));
const MAX_IDS = 20; // one group at a time: at most 190 pairs

const pairOf = (a, b) => { const x = Number(a), y = Number(b); return x < y ? [x, y] : [y, x]; };
const keyOf = (a, b) => pairOf(a, b).join('-');

// { set: Set of 'low-high', available: false when the table is not there yet }
async function dismissedPairs(conn) {
  try {
    const [rows] = await conn.query('SELECT account_a_id, account_b_id FROM crm_account_not_duplicates');
    return { set: new Set(rows.map(r => keyOf(r.account_a_id, r.account_b_id))), available: true };
  } catch (err) {
    if (!isMissing(err)) throw err;
    return { set: new Set(), available: false };
  }
}

// groups: [{ domain, accounts: [{ id, ... }] }] -> the same shape with every remembered pair taken out. An account left with no suspected partner is dropped from its group; a group
// left with fewer than two accounts is dropped. Accounts keep their order. `pairsHidden` says how many remembered pairs sat inside a group that is still shown.
function applyMemory(groups, dismissed) {
  if (!dismissed || !dismissed.size) return groups;
  const out = [];
  for (const g of groups) {
    const ids = g.accounts.map(a => a.id);
    const parent = new Map(ids.map(i => [i, i]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    let hidden = 0;
    const linked = new Set();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (g.edges && !g.edges.has(keyOf(ids[i], ids[j]))) continue; // a similar-name group: only the pairs whose names really are alike are suspected
      if (dismissed.has(keyOf(ids[i], ids[j]))) { hidden++; continue; }
      parent.set(find(ids[i]), find(ids[j])); linked.add(ids[i]); linked.add(ids[j]);
    }
    const comps = new Map();
    for (const a of g.accounts) { if (!linked.has(a.id)) continue; const r = find(a.id); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(a); }
    for (const accounts of comps.values()) if (accounts.length >= 2) out.push({ ...g, accounts, pairsHidden: hidden });
  }
  return out;
}

// For the account page: the other accounts a person has not said are separate from this one.
const keepSuspected = (accountId, others, dismissed) => (dismissed && dismissed.size ? others.filter(o => !dismissed.has(keyOf(accountId, o.id))) : others);

// ids -> { marked, already, pairs } or { error, status }. Every pair among the ids is remembered (two ids: one pair; a whole group: "none of these are duplicates").
async function mark(conn, ids, adminId) {
  const clean = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (clean.length < 2) return { status: 400, error: 'Pick two or more different accounts.' };
  if (clean.length > MAX_IDS) return { status: 400, error: `Pick at most ${MAX_IDS} accounts at a time.` };
  const [found] = await conn.query(`SELECT id FROM crm_accounts WHERE id IN (${clean.map(() => '?').join(',')})`, clean);
  if (found.length !== clean.length) return { status: 404, error: 'One of those accounts was not found.' };
  const sorted = clean.slice().sort((a, b) => a - b);
  let marked = 0, already = 0; const pairs = [];
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    try {
      await conn.query('INSERT INTO crm_account_not_duplicates (account_a_id, account_b_id, decided_by_admin_id) VALUES (?, ?, ?)', [sorted[i], sorted[j], adminId]);
      marked++; pairs.push([sorted[i], sorted[j]]);
    } catch (err) {
      if (isDuplicateKey(err)) { already++; continue; }
      if (isMissing(err)) return { status: 503, code: 'not_available', error: 'This is not available yet. Ask the person who runs the site to run the not-a-duplicate update.' };
      throw err;
    }
  }
  return { marked, already, pairs };
}

// Undo one remembered pair by its row id. { ok, pair } or { error, status }.
async function unmark(conn, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return { status: 404, error: 'That is not a remembered pair.' };
  let row;
  try { [[row]] = await conn.query('SELECT id, account_a_id, account_b_id FROM crm_account_not_duplicates WHERE id = ?', [n]); }
  catch (err) { if (isMissing(err)) return { status: 503, code: 'not_available', error: 'This is not available yet. Ask the person who runs the site to run the not-a-duplicate update.' }; throw err; }
  if (!row) return { status: 404, error: 'That is not a remembered pair.' };
  await conn.query('DELETE FROM crm_account_not_duplicates WHERE id = ?', [n]);
  return { ok: true, pair: [Number(row.account_a_id), Number(row.account_b_id)] };
}

// The remembered pairs, newest first, with both names (an archived account still shows, marked). [{ id, a, b, decidedBy, decidedAt }]
async function listMarked(conn, { limit, offset }) {
  let rows, total;
  try {
    [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM crm_account_not_duplicates');
    [rows] = await conn.query(
      `SELECT n.id, n.decided_at, n.account_a_id, n.account_b_id, a.name AS a_name, a.archived_at AS a_arch, b.name AS b_name, b.archived_at AS b_arch, u.username AS by_name
       FROM crm_account_not_duplicates n JOIN crm_accounts a ON a.id = n.account_a_id JOIN crm_accounts b ON b.id = n.account_b_id LEFT JOIN admin_users u ON u.id = n.decided_by_admin_id
       ORDER BY n.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
  } catch (err) { if (isMissing(err)) return { available: false, pairs: [], total: 0 }; throw err; }
  return {
    available: true, total: Number(total),
    pairs: rows.map(r => ({ id: Number(r.id), a: { id: Number(r.account_a_id), name: r.a_name, archived: !!r.a_arch }, b: { id: Number(r.account_b_id), name: r.b_name, archived: !!r.b_arch }, decidedBy: r.by_name || null, decidedAt: r.decided_at || null })),
  };
}

module.exports = { MAX_IDS, keyOf, pairOf, dismissedPairs, applyMemory, keepSuspected, mark, unmark, listMarked, isMissing };

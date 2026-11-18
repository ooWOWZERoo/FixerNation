// Customer Hub follow-up to G22: undo a prospect import with one click.
//
// What it does: it removes the people THAT IMPORT CREATED, and only the ones nobody has touched since. It never removes anyone who was already in the CRM (an import only filled in their
// blanks, and those blanks are left as they are), and it never removes a person who has anything of their own: a note, task, file or meeting, a deal, a quote, a purchase or invoice, a
// campaign or newsletter send, a group, a sign-in account, a label that moved, a changed owner or subscription, an edited field, a second account, or an earlier import's review item.
// Anyone like that is KEPT and counted by reason, so a person can look at them. Nothing is removed unless EVERY check passes, and each check is made again just before the delete.
//
// How it knows who the import made: `crm_import_people`, written by lib/crm-import.js at the moment each person is created (batch, contact id, the email, the account the import put them
// on, and a snapshot of what the import wrote). An import made before this existed has no such list, so it cannot be undone (the page says so); there is no guessing by date or source.
//
// Rules kept (each has a test): CRM Admin only; a preview first (counts only, nothing changes); once per import (claimed before anything is removed, so a double click is one undo); the
// audit row holds counts only (no name, no email); the batch record stays and says it was undone. `conn` is the pool in the route; SQL stays portable.
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
const norm = (s) => String(s || '').trim().toLowerCase();

const REASONS = {
  edited: 'a detail was edited', email_changed: 'the email was changed', subscribed: 'their newsletter status changed', label_changed: 'their label moved or was set by hand', owner_changed: 'someone else owns them now',
  contacted: 'they have been contacted or visited the site', work: 'there are notes, tasks, files or meetings on them', on_deal: 'they are on a deal', money: 'they have a purchase or an invoice', quote: 'they have a quote',
  emailed: 'they were sent a campaign or newsletter', in_group: 'they are in an email group', has_account: 'they have a sign-in account', in_review: 'another import’s review item points at them', account_changed: 'their place on an account changed',
};
const labelOf = (key) => REASONS[key] || key;

// Records one person the import just created. Never throws: before the alter script has run there is no table, and the import must still work (it just cannot be undone).
async function recordCreated(conn, { batchId, contactId, accountId, viaReviewId = null, row, title = null, today }) {
  try {
    const [[c]] = await conn.query('SELECT name, email, company, state, phone, status, assigned_admin_id, crm_classification, classification_locked FROM newsletter_contacts WHERE id = ?', [contactId]);
    if (!c) return false;
    let events = 0;
    try { const [[e]] = await conn.query('SELECT COUNT(*) AS n FROM crm_classification_events WHERE contact_id = ?', [contactId]); events = Number(e.n); } catch (err) { if (!isMissing(err)) throw err; }
    const snapshot = { name: c.name || '', company: c.company || '', state: c.state || '', phone: c.phone || '', status: c.status, adminId: c.assigned_admin_id === null || c.assigned_admin_id === undefined ? null : Number(c.assigned_admin_id), label: c.crm_classification || 'suspect', locked: Number(c.classification_locked || 0), events, title: title || null, startedOn: accountId ? today : null };
    await conn.query('INSERT INTO crm_import_people (batch_id, contact_id, email_norm, account_id, via_review_id, snapshot_json) VALUES (?, ?, ?, ?, ?, ?)', [batchId, contactId, norm(c.email), accountId || null, viaReviewId, JSON.stringify(snapshot)]);
    return true;
  } catch (err) { if (isMissing(err)) return false; throw err; }
}

const count = async (conn, sql, params) => { try { const [[r]] = await conn.query(sql, params); return Number(r.n); } catch (err) { if (isMissing(err)) return 0; throw err; } };

// Why this person must be kept, or null when nothing has happened to them since the import. `led` is their crm_import_people row.
async function keepReason(conn, led) {
  const id = Number(led.contact_id);
  const [[c]] = await conn.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]);
  if (!c) return 'gone';
  let snap = {}; try { snap = JSON.parse(led.snapshot_json || '{}'); } catch { return 'edited'; }
  if (norm(c.email) !== norm(led.email_norm)) return 'email_changed';
  if (c.status !== snap.status) return 'subscribed';
  if ((c.crm_classification || 'suspect') !== (snap.label || 'suspect') || Number(c.classification_locked || 0) !== Number(snap.locked || 0)) return 'label_changed';
  if ((c.assigned_admin_id === null || c.assigned_admin_id === undefined ? null : Number(c.assigned_admin_id)) !== (snap.adminId === undefined ? null : snap.adminId)) return 'owner_changed';
  for (const k of ['name', 'company', 'state', 'phone']) if ((c[k] || '') !== (snap[k] || '')) return 'edited';
  if (c.last_contacted_at || c.first_touch_at || c.latest_touch_at || c.first_touch_source || c.latest_touch_source) return 'contacted';
  for (const t of ['crm_tasks', 'crm_notes', 'crm_attachments', 'crm_appointments']) if (await count(conn, `SELECT COUNT(*) AS n FROM ${t} WHERE contact_id = ?`, [id])) return 'work';
  // A meeting that merely INVITES them keeps them too (the invitation list is a small JSON on the meeting).
  try {
    const [m] = await conn.query('SELECT attendees_json FROM crm_appointments WHERE attendees_json LIKE ?', [`%${id}%`]);
    for (const r of m) { try { if (((JSON.parse(r.attendees_json || '{}').contactIds) || []).map(Number).includes(id)) return 'work'; } catch { /* not JSON: not an invitation */ } }
  } catch (err) { if (!isMissing(err)) throw err; }
  if (await count(conn, 'SELECT COUNT(*) AS n FROM crm_opportunity_contacts WHERE contact_id = ?', [id]) || await count(conn, 'SELECT COUNT(*) AS n FROM crm_opportunities WHERE primary_contact_id = ?', [id])) return 'on_deal';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM purchases WHERE contact_id = ?', [id]) || await count(conn, 'SELECT COUNT(*) AS n FROM invoices WHERE contact_id = ?', [id])) return 'money';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM quote_requests WHERE contact_id = ? OR LOWER(TRIM(email)) = ?', [id, norm(led.email_norm)])) return 'quote';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM campaign_sends WHERE contact_id = ?', [id]) || await count(conn, 'SELECT COUNT(*) AS n FROM morning_boost_send_recipients WHERE contact_id = ?', [id])) return 'emailed';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM contact_group_members WHERE contact_id = ?', [id])) return 'in_group';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM site_users WHERE LOWER(TRIM(email)) = ?', [norm(led.email_norm)])) return 'has_account';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM crm_import_review WHERE resolved_contact_id = ? AND id <> ?', [id, led.via_review_id || 0])) return 'in_review';
  if (await count(conn, 'SELECT COUNT(*) AS n FROM crm_classification_events WHERE contact_id = ?', [id]) > Number(snap.events || 0)) return 'label_changed';
  // The one place on an account the import gave them, exactly as it left it.
  let places = [];
  try { [places] = await conn.query('SELECT account_id, title, started_on, ended_on, is_primary, is_champion, is_decision_maker, is_procurement, is_finance FROM crm_account_contacts WHERE contact_id = ?', [id]); } catch (err) { if (!isMissing(err)) throw err; }
  if (led.account_id) {
    const p = places[0];
    const same = places.length === 1 && Number(p.account_id) === Number(led.account_id) && !p.ended_on && !Number(p.is_primary) && !Number(p.is_champion) && !Number(p.is_decision_maker) && !Number(p.is_procurement) && !Number(p.is_finance)
      && (p.title || null) === (snap.title || null) && String(p.started_on || '').slice(0, 10) === String(snap.startedOn || '');
    if (!same) return 'account_changed';
  } else if (places.length) return 'account_changed';
  return null;
}

async function batchState(conn, batchId) {
  const n = Number(batchId);
  if (!Number.isInteger(n) || n < 1) return { error: 'That import was not found.', status: 404 };
  let b;
  try { [[b]] = await conn.query('SELECT * FROM crm_import_batches WHERE id = ?', [n]); } catch (err) { if (isMissing(err)) return { error: 'Importing people is not available yet.', status: 503, code: 'not_available' }; throw err; }
  if (!b) return { error: 'That import was not found.', status: 404 };
  let led = null;
  try { [led] = await conn.query('SELECT * FROM crm_import_people WHERE batch_id = ? ORDER BY id', [n]); } catch (err) { if (!isMissing(err)) throw err; }
  if (led === null) return { error: 'Undo is not available yet. Ask the person who runs the site to run the import-undo update.', status: 503, code: 'not_available' };
  if (b.undone_at) return { error: 'This import was already undone.', status: 409, code: 'undone' };
  if (!led.length) return { error: 'This import was made before undo existed, or it added nobody, so there is nothing to undo.', status: 409, code: 'nothing_to_undo' };
  return { batch: b, ledger: led };
}

// What undoing WOULD do. Writes nothing. { people, removable, kept, gone, keptByReason: [{ reason, label, count }], stillWaiting }
async function preview(conn, batchId) {
  const s = await batchState(conn, batchId);
  if (s.error) return s;
  const by = new Map(); let removable = 0, gone = 0;
  for (const led of s.ledger) {
    const why = await keepReason(conn, led);
    if (why === null) removable++; else if (why === 'gone') gone++; else by.set(why, (by.get(why) || 0) + 1);
  }
  let stillWaiting = 0; try { const [[w]] = await conn.query("SELECT COUNT(*) AS n FROM crm_import_review WHERE batch_id = ? AND state = 'waiting'", [Number(batchId)]); stillWaiting = Number(w.n); } catch (err) { if (!isMissing(err)) throw err; }
  const kept = [...by.values()].reduce((a, b) => a + b, 0);
  return { people: s.ledger.length, removable, kept, gone, keptByReason: [...by.entries()].map(([reason, n]) => ({ reason, label: labelOf(reason), count: n })).sort((a, b) => b.count - a.count), stillWaiting };
}

// Does it. Claims the import first (so it can only be undone once), then removes each untouched person inside a transaction, re-checking just before. Releases the claim if something fails
// part way, so the person can try again (people already removed are simply "gone" the second time).
async function undo(conn, batchId, { adminId, now }) {
  const s = await batchState(conn, batchId);
  if (s.error) return s;
  const [claim] = await conn.query('UPDATE crm_import_batches SET undone_at = ?, undone_by_admin_id = ? WHERE id = ? AND undone_at IS NULL', [now, adminId, Number(batchId)]);
  if (!claim.affectedRows) return { error: 'This import was already undone.', status: 409, code: 'undone' };
  let removed = 0, gone = 0; const by = new Map();
  try {
    for (const led of s.ledger) {
      const connection = await conn.getConnection();
      try {
        await connection.beginTransaction();
        const why = await keepReason(connection, led);   // checked again, inside the transaction
        if (why === 'gone') gone++;
        else if (why) by.set(why, (by.get(why) || 0) + 1);
        else {
          const id = Number(led.contact_id);
          // Named on purpose (the foreign keys would remove them too; this does not depend on them being in force).
          for (const t of ['crm_account_contacts', 'crm_classification_events']) { try { await connection.query(`DELETE FROM ${t} WHERE contact_id = ?`, [id]); } catch (err) { if (!isMissing(err)) throw err; } }
          await connection.query('DELETE FROM newsletter_contacts WHERE id = ?', [id]);
          removed++;
        }
        await connection.commit();
      } catch (err) { await connection.rollback(); throw err; } finally { connection.release(); }
    }
    const kept = [...by.values()].reduce((a, b) => a + b, 0);
    await conn.query('UPDATE crm_import_batches SET undo_removed = ?, undo_kept = ? WHERE id = ?', [removed, kept, Number(batchId)]);
    return { removed, kept, gone, keptByReason: [...by.entries()].map(([reason, n]) => ({ reason, label: labelOf(reason), count: n })) };
  } catch (err) {
    try { await conn.query('UPDATE crm_import_batches SET undone_at = NULL, undone_by_admin_id = NULL WHERE id = ?', [Number(batchId)]); } catch { /* the original error matters more */ }
    throw err;
  }
}

// For the batch list: how many people each import made that are on record (so the page knows whether Undo can be offered). { batchId: n }. Empty when the table is not there yet.
async function trackedCounts(conn) {
  try { const [rows] = await conn.query('SELECT batch_id, COUNT(*) AS n FROM crm_import_people GROUP BY batch_id'); return new Map(rows.map(r => [Number(r.batch_id), Number(r.n)])); } catch (err) { if (isMissing(err)) return null; throw err; }
}

module.exports = { REASONS, recordCreated, keepReason, preview, undo, trackedCounts, isMissing };

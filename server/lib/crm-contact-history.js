// Sales CRM punch list G16 (FR-CON-01, FR-CON-02): the dates that were stored but never written. "Last contacted" on a person, and when a person started and left an organization.
//
// Rules this file keeps (each has a test):
//  - "Last contacted" is set ONLY by staff contact (owner's choice, 2026-11-17): a call, email or meeting NOTE logged on the person, on their deal (the deal's main contact) or on
//    their account (its current primary contact); a quote emailed to them; a meeting they were invited to that has started and was not cancelled. Newsletters, campaigns and
//    automatic emails never count, and neither does a plain note.
//  - It only moves FORWARD: a later or equal date is never replaced by an earlier one, so recording something late cannot make a person look less recently contacted.
//  - It never throws and never blocks the request that caused it: a failure here is logged and the note, quote or meeting is saved as normal.
//  - Meetings are applied by the daily check (touchFromMeetings), idempotently: running it twice changes nothing the second time.
const NOTE_KINDS = ['call', 'email', 'meeting'];
const sqlAt = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 19).replace('T', ' ');

async function safely(fn) {
  try { return await fn(); } catch (err) {
    if (!(err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message))))) console.error('contact history failed:', err.message);
    return 0;
  }
}

// Moves last_contacted_at forward to `at` for these people. Returns how many changed.
async function touchContacts(conn, ids, at) {
  const list = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!list.length) return 0;
  return safely(async () => {
    const when = sqlAt(at);
    const [r] = await conn.query('UPDATE newsletter_contacts SET last_contacted_at = ? WHERE id IN (?) AND (last_contacted_at IS NULL OR last_contacted_at < ?)', [when, list, when]);
    return Number(r.affectedRows || 0);
  });
}

// The people a note was about: the person themselves, the deal's main contact, or the account's current primary contact(s).
async function contactsForSubject(conn, subject) {
  if (!subject) return [];
  if (subject.kind === 'contact') return [subject.id];
  if (subject.kind === 'opportunity') {
    const [[o]] = await conn.query('SELECT primary_contact_id FROM crm_opportunities WHERE id = ?', [subject.id]);
    return o && o.primary_contact_id ? [o.primary_contact_id] : [];
  }
  if (subject.kind === 'account') {
    const [rows] = await conn.query('SELECT contact_id FROM crm_account_contacts WHERE account_id = ? AND is_primary = 1 AND ended_on IS NULL', [subject.id]);
    return rows.map(r => r.contact_id);
  }
  return [];
}

// A call, email or meeting note was written. A plain note changes nothing.
async function touchForNote(conn, subject, kind, at) {
  if (!NOTE_KINDS.includes(kind)) return 0;
  return safely(async () => touchContacts(conn, await contactsForSubject(conn, subject), at));
}

// A quote was emailed to this address (not a phone quote, not a draft).
async function touchByEmail(conn, email, at) {
  if (typeof email !== 'string' || !email.trim()) return 0;
  return safely(async () => {
    const [rows] = await conn.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [email]);
    return touchContacts(conn, rows.map(r => r.id), at);
  });
}

// The daily check: every scheduled (not cancelled) meeting that has started in the last 30 days marks its invited contacts as contacted at the meeting's start time.
// apply=false only counts. Returns { meetings, wouldTouch|touched }.
async function touchFromMeetings(conn, { now, apply = false }) {
  const out = { meetings: 0, contacts: 0, touched: 0 };
  const since = sqlAt(new Date(new Date(`${sqlAt(now).replace(' ', 'T')}Z`).getTime() - 30 * 86400000));
  let rows;
  try { [rows] = await conn.query("SELECT starts_at, attendees_json FROM crm_appointments WHERE status = 'scheduled' AND starts_at <= ? AND starts_at >= ? ORDER BY starts_at", [sqlAt(now), since]); }
  catch (err) { if (err && (err.code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(String(err.message)))) return out; throw err; }
  const latest = new Map();
  for (const m of rows) {
    let ids = [];
    try { ids = (JSON.parse(m.attendees_json || '{}').contactIds || []).map(Number).filter(Boolean); } catch { ids = []; }
    if (!ids.length) continue;
    out.meetings++;
    for (const id of ids) if (!latest.has(id) || latest.get(id) < String(m.starts_at)) latest.set(id, String(m.starts_at));
  }
  out.contacts = latest.size;
  for (const [id, at] of latest) {
    if (apply) out.touched += await touchContacts(conn, [id], at);
    else {
      const [[c]] = await conn.query('SELECT last_contacted_at FROM newsletter_contacts WHERE id = ?', [id]);
      if (c && (!c.last_contacted_at || String(c.last_contacted_at) < at)) out.touched++;
    }
  }
  return out;
}

module.exports = { touchContacts, touchForNote, touchByEmail, touchFromMeetings, contactsForSubject, NOTE_KINDS };

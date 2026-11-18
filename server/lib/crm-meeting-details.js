// Sales CRM punch list G12 (ACT-03): what a meeting carries beyond its title and time: the time zone it was set up in, a join link, and who attended.
//
// Rules this file keeps (each has a test):
//  - The zone is a LABEL: times stay stored in UTC and each viewer still sees their own time. It is checked against the real IANA list (Intl), so "America/New_York" passes and
//    anything else (a typo, a path, markup) is refused. A blank clears it.
//  - A join link is https only, at most 500 characters, with no spaces or control characters, no user name or password in it, and a real host. It is stored as the address
//    the browser would use (normalized by URL), so "javascript:", "http:", "data:" and "mailto:" can never get on the page or into an invitation.
//  - Attendance is marked by staff after the meeting starts, only for people who were invited, and only attended / did not attend / not marked. It stores ids and a yes or no,
//    never a name or address, and the audit row holds counts only.
const MAX_URL = 500;

function cleanZone(v) {
  if (v === undefined || v === null || v === '') return { value: null }; // not sent, or blank: no zone
  if (typeof v !== 'string') return { error: 'The time zone must be text.' };
  const t = v.trim();
  if (!t) return { value: null };
  if (t.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(t)) return { error: 'That time zone is not one we know. Pick one from the list.' };
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); } catch { return { error: 'That time zone is not one we know. Pick one from the list.' }; }
  return { value: t };
}

function cleanUrl(v) {
  if (v === undefined || v === null || v === '') return { value: null }; // not sent, or blank: no link
  if (typeof v !== 'string') return { error: 'The join link must be text.' };
  const t = v.trim();
  if (!t) return { value: null };
  if (t.length > MAX_URL) return { error: `The join link must be ${MAX_URL} characters or fewer.` };
  if (/[\s\u0000-\u001f\u007f<>"'`\\]/.test(t)) return { error: 'The join link cannot have spaces or special characters. Paste the address as it is.' };
  let u;
  try { u = new URL(t); } catch { return { error: 'That does not look like a web address. It should start with https://' }; }
  if (u.protocol !== 'https:') return { error: 'The join link must start with https://' };
  if (u.username || u.password) return { error: 'The join link cannot have a user name or password in it.' };
  if (!u.hostname || !u.hostname.includes('.')) return { error: 'That does not look like a web address. It should start with https://' };
  const href = u.href;
  if (href.length > MAX_URL) return { error: `The join link must be ${MAX_URL} characters or fewer.` };
  return { value: href };
}

function parseAttendance(row) {
  try {
    const j = JSON.parse(row.attendance_json || '[]');
    return Array.isArray(j) ? j.filter(x => x && (x.type === 'staff' || x.type === 'contact') && Number.isInteger(Number(x.id)) && typeof x.attended === 'boolean').map(x => ({ type: x.type, id: Number(x.id), attended: x.attended })) : [];
  } catch { return []; }
}

// marks: [{ type: 'staff'|'contact', id, attended: true|false|null }]. `invited` is [{ type, id }]. Returns { value: <json string>, counts } or { error }.
function applyMarks(current, marks, invited) {
  if (!Array.isArray(marks) || !marks.length || marks.length > 20) return { error: 'Choose who attended.' };
  const ok = new Set(invited.map(p => `${p.type}:${p.id}`));
  const map = new Map(current.map(x => [`${x.type}:${x.id}`, x]));
  for (const m of marks) {
    if (!m || typeof m !== 'object') return { error: 'Choose who attended.' };
    const type = m.type === 'staff' || m.type === 'contact' ? m.type : null;
    const id = Number.isInteger(m.id) ? m.id : (typeof m.id === 'string' && /^\d{1,10}$/.test(m.id) ? Number(m.id) : null);
    if (!type || !id || !ok.has(`${type}:${id}`)) return { error: 'You can only mark people who were invited to this meeting.' };
    if (m.attended === null) map.delete(`${type}:${id}`);
    else if (typeof m.attended === 'boolean') map.set(`${type}:${id}`, { type, id, attended: m.attended });
    else return { error: 'Mark each person as attended, did not attend, or not marked.' };
  }
  const list = [...map.values()].filter(x => ok.has(`${x.type}:${x.id}`));
  return { value: list.length ? JSON.stringify(list) : null, counts: { attended: list.filter(x => x.attended).length, didNotAttend: list.filter(x => !x.attended).length } };
}

module.exports = { cleanZone, cleanUrl, parseAttendance, applyMarks, MAX_URL };

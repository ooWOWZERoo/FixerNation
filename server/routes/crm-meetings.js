// Sales CRM meetings: appointments on a deal, an account or a contact, with a calendar invitation (.ics) sent through lib/mailer.js (mounted at /api/crm/meetings).
// Invitees are never typed addresses: CRM staff with an email on file, and contacts who are on that deal (its buying committee or main contact), on that account,
// or the contact the meeting is about. Times are stored in UTC; the page sends and shows the viewer's own time.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { crmAudit } = require('../lib/crm-audit');
const { sqlNow } = require('../lib/crm-classification');
const { text, posInt, paging } = require('../lib/crm-common');
const ics = require('../lib/crm-ics');
const S = require('../lib/crm-subjects');
const mailer = require('../lib/mailer');

const router = express.Router();
const MAX_ATTENDEES = 10;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// A moment from the browser: an ISO string that says its time zone, stored as UTC 'YYYY-MM-DD HH:MM:SS'. Anything vaguer is refused (a bare local time would be read
// in the server's zone, which is not the viewer's).
function momentOf(v) {
  if (typeof v !== 'string' || !ISO_WITH_ZONE.test(v.trim())) return null;
  const d = new Date(v.trim());
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  return y >= 2020 && y <= 2100 ? d.toISOString().slice(0, 19).replace('T', ' ') : null;
}
const asDate = (sql) => new Date(`${String(sql).replace(' ', 'T')}Z`);

function idList(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const x of v) { const n = posInt(x); if (!n) return null; if (!out.includes(n)) out.push(n); }
  return out;
}
const marks = (ids) => ids.map(() => '?').join(',');

// The contacts who may be invited to a meeting about this subject.
async function inviteableContactIds(kind, id) {
  if (kind === 'contact') return [id];
  if (kind === 'account') {
    const [rows] = await pool.query('SELECT contact_id FROM crm_account_contacts WHERE account_id = ?', [id]);
    return rows.map(r => r.contact_id);
  }
  const [rows] = await pool.query('SELECT contact_id FROM crm_opportunity_contacts WHERE opportunity_id = ?', [id]);
  const [[o]] = await pool.query('SELECT primary_contact_id FROM crm_opportunities WHERE id = ?', [id]);
  const set = new Set(rows.map(r => Number(r.contact_id)));
  if (o && o.primary_contact_id) set.add(Number(o.primary_contact_id));
  return [...set];
}

// Turns the request's staffIds and contactIds into checked people, or an error sentence.
async function checkAttendees(kind, subjectId, staffIds, contactIds) {
  if (staffIds === null || contactIds === null) return { error: 'The invitee list is not valid.' };
  if (staffIds.length + contactIds.length > MAX_ATTENDEES) return { error: `A meeting can have at most ${MAX_ATTENDEES} invitees.` };
  const staff = [];
  const contacts = [];
  if (staffIds.length) {
    const [rows] = await pool.query(`SELECT id, username, email FROM admin_users WHERE id IN (${marks(staffIds)})`, staffIds);
    for (const id of staffIds) {
      const r = rows.find(x => Number(x.id) === id);
      if (!r) return { error: 'One of the staff members does not exist.' };
      if (!ics.validEmail(r.email)) return { error: `${r.username} has no email address on their admin account, so they cannot be invited.` };
      staff.push({ id, name: r.username, email: r.email.trim() });
    }
  }
  if (contactIds.length) {
    const allowed = new Set((await inviteableContactIds(kind, subjectId)).map(Number));
    const [rows] = await pool.query(`SELECT id, name, email FROM newsletter_contacts WHERE id IN (${marks(contactIds)})`, contactIds);
    for (const id of contactIds) {
      const r = rows.find(x => Number(x.id) === id);
      if (!r || !allowed.has(id)) return { error: 'You can only invite people who are on this deal, account or contact.' };
      if (!ics.validEmail(r.email)) return { error: `${r.name || 'One contact'} has no usable email address.` };
      contacts.push({ id, name: r.name || r.email, email: r.email.trim() });
    }
  }
  return { staff, contacts };
}

function parseAttendees(row) {
  try { const j = JSON.parse(row.attendees_json || '{}'); return { staffIds: idList(j.staffIds) || [], contactIds: idList(j.contactIds) || [] }; } catch { return { staffIds: [], contactIds: [] }; }
}

const MEETING_SELECT = `SELECT m.*, ${S.SUBJECT_COLS}, ou.username AS organizer_name
  FROM crm_appointments m ${S.SUBJECT_JOIN('m')} LEFT JOIN admin_users ou ON ou.id = m.organizer_admin_id`;

async function viewAll(rows, req) {
  const staffIds = new Set();
  const contactIds = new Set();
  const parsed = rows.map(r => { const a = parseAttendees(r); a.staffIds.forEach(i => staffIds.add(i)); a.contactIds.forEach(i => contactIds.add(i)); return a; });
  const staffRows = staffIds.size ? (await pool.query(`SELECT id, username, email FROM admin_users WHERE id IN (${marks([...staffIds])})`, [...staffIds]))[0] : [];
  const contactRows = contactIds.size ? (await pool.query(`SELECT id, name, email FROM newsletter_contacts WHERE id IN (${marks([...contactIds])})`, [...contactIds]))[0] : [];
  return rows.map((m, i) => ({
    id: m.id, title: m.title, startsAt: m.starts_at, endsAt: m.ends_at, location: m.location || null, details: m.details || null, status: m.status,
    organizerName: m.organizer_name || null, organizerAdminId: m.organizer_admin_id || null,
    attendees: [
      ...parsed[i].staffIds.map(id => { const r = staffRows.find(x => Number(x.id) === id); return r ? { type: 'staff', id, name: r.username, email: r.email || null } : null; }),
      ...parsed[i].contactIds.map(id => { const r = contactRows.find(x => Number(x.id) === id); return r ? { type: 'contact', id, name: r.name || r.email, email: r.email } : null; }),
    ].filter(Boolean),
    inviteSentAt: m.invite_sent_at || null,
    // Changed since the last invitation went out: a re-send would update everyone's calendar.
    inviteOutOfDate: !!m.invite_sent_at && m.status === 'scheduled' && Number(m.invite_sequence) !== Number(m.sequence_no),
    subject: S.subjectView(m), canEdit: S.canWriteRow(req, m),
  }));
}

// ---- List -------------------------------------------------------------------------------------------------------------------------

// A subject's meetings (one of opportunityId / accountId / contactId), or ?upcoming=true for the next scheduled ones across the Hub (?mine=true: only mine).
router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 25, maxSize: 100 });
  const where = [];
  const params = [];
  const upcoming = req.query.upcoming === 'true';
  if (req.query.opportunityId !== undefined || req.query.accountId !== undefined || req.query.contactId !== undefined) {
    const f = S.listFilter(req.query, 'm');
    if (f.error) return res.status(400).json({ error: f.error });
    where.push(f.where); params.push(...f.params);
  } else if (!upcoming) return res.status(400).json({ error: 'Say whose meetings these are, or ask for the upcoming ones.' });
  if (upcoming) { where.push("m.status = 'scheduled' AND m.ends_at >= ?"); params.push(sqlNow()); }
  if (req.query.mine === 'true') { where.push('m.organizer_admin_id = ?'); params.push(req.crm.adminId); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM crm_appointments m ${w}`, params);
  const [rows] = await pool.query(`${MEETING_SELECT} ${w} ORDER BY ${upcoming ? 'm.starts_at ASC' : 'm.starts_at DESC'}, m.id LIMIT ? OFFSET ?`, [...params, size, offset]);
  res.json({ meetings: await viewAll(rows, req), total: Number(total), page, pageSize: size });
});

// ---- Create and change ------------------------------------------------------------------------------------------------------------

function cleanTimes(b, existing) {
  const startsAt = b.startsAt === undefined ? existing.starts_at : momentOf(b.startsAt);
  const endsAt = b.endsAt === undefined ? existing.ends_at : momentOf(b.endsAt);
  if (!startsAt || !endsAt) return { error: 'Pick a start and an end time.' };
  const ms = asDate(endsAt) - asDate(startsAt);
  if (ms <= 0) return { error: 'The meeting has to end after it starts.' };
  if (ms > 24 * 3600 * 1000) return { error: 'A meeting cannot be longer than 24 hours.' };
  return { startsAt, endsAt };
}

router.post('/', requireAuth, requireCrm('write'), async (req, res) => {
  const b = req.body || {};
  const r = await S.resolveSubject(b);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!S.canWriteResolved(req, r.subject)) return res.status(403).json({ code: 'not_your_deal', error: 'This deal belongs to someone else. Ask the owner or a CRM Admin.' });
  const title = text(b.title, 255);
  if (!title) return res.status(400).json({ error: 'Give the meeting a title.' });
  const t = cleanTimes(b, {});
  if (t.error) return res.status(400).json({ error: t.error });
  const staffIds = idList(b.staffIds);
  const contactIds = idList(b.contactIds);
  const people = await checkAttendees(r.subject.kind, r.subject.id, staffIds, contactIds);
  if (people.error) return res.status(400).json({ error: people.error });
  const c = r.subject.cols;
  const uid = require('crypto').randomBytes(16).toString('hex');
  const [ins] = await pool.query(
    `INSERT INTO crm_appointments (opportunity_id, account_id, contact_id, title, starts_at, ends_at, location, details, status, uid, sequence_no, attendees_json, organizer_admin_id, created_by_admin_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, 0, ?, ?, ?, ?)`,
    [c.opportunity_id, c.account_id, c.contact_id, title, t.startsAt, t.endsAt, text(b.location, 255), text(b.details, 2000), uid, JSON.stringify({ staffIds, contactIds }), req.crm.adminId, req.crm.adminId, sqlNow()]);
  await crmAudit(req, { action: 'crm_meeting_created', entityType: 'crm_meeting', entityId: ins.insertId, next: { subject: r.subject.kind, subjectId: r.subject.id, startsAt: t.startsAt, invitees: staffIds.length + contactIds.length } });
  res.status(201).json({ ok: true, id: ins.insertId });
});

async function loadWritable(req, res) {
  const m = await S.loadItem('crm_appointments', req.params.id);
  if (!m) { res.status(404).json({ error: 'Meeting not found' }); return null; }
  if (!S.canWriteRow(req, m)) { res.status(403).json({ code: 'not_your_deal', error: 'This meeting is on a deal that belongs to someone else.' }); return null; }
  return m;
}

router.put('/:id', requireAuth, requireCrm('write'), async (req, res) => {
  const m = await loadWritable(req, res);
  if (!m) return;
  if (m.status === 'cancelled') return res.status(409).json({ code: 'cancelled', error: 'This meeting was cancelled. Make a new one.' });
  const b = req.body || {};
  const f = {};
  let changed = false; // does the invitation's content change? Then everyone's calendar needs an update.
  if (b.title !== undefined) { f.title = text(b.title, 255); if (!f.title) return res.status(400).json({ error: 'Give the meeting a title.' }); changed = changed || f.title !== m.title; }
  if (b.startsAt !== undefined || b.endsAt !== undefined) {
    const t = cleanTimes(b, m);
    if (t.error) return res.status(400).json({ error: t.error });
    f.starts_at = t.startsAt; f.ends_at = t.endsAt;
    changed = changed || t.startsAt !== String(m.starts_at) || t.endsAt !== String(m.ends_at);
  }
  if (b.location !== undefined) { f.location = text(b.location, 255); changed = changed || (f.location || null) !== (m.location || null); }
  if (b.details !== undefined) { f.details = text(b.details, 2000); changed = changed || (f.details || null) !== (m.details || null); }
  if (b.staffIds !== undefined || b.contactIds !== undefined) {
    const cur = parseAttendees(m);
    const staffIds = b.staffIds === undefined ? cur.staffIds : idList(b.staffIds);
    const contactIds = b.contactIds === undefined ? cur.contactIds : idList(b.contactIds);
    const people = await checkAttendees(S.kindOfRow(m), S.kindOfRow(m) === 'opportunity' ? m.opportunity_id : S.kindOfRow(m) === 'contact' ? m.contact_id : m.account_id, staffIds, contactIds);
    if (people.error) return res.status(400).json({ error: people.error });
    f.attendees_json = JSON.stringify({ staffIds, contactIds });
    changed = changed || f.attendees_json !== JSON.stringify({ staffIds: cur.staffIds, contactIds: cur.contactIds });
  }
  const cols = Object.keys(f);
  if (!cols.length) return res.status(400).json({ error: 'Nothing to change.' });
  if (changed) { cols.push('sequence_no'); f.sequence_no = Number(m.sequence_no) + 1; }
  await pool.query(`UPDATE crm_appointments SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...cols.map(k => f[k]), m.id]);
  await crmAudit(req, { action: 'crm_meeting_updated', entityType: 'crm_meeting', entityId: m.id, next: { fields: cols.filter(k => k !== 'attendees_json') } });
  res.json({ ok: true, inviteOutOfDate: changed && !!m.invite_sent_at });
});

// ---- The invitation ---------------------------------------------------------------------------------------------------------------

// Builds and sends the invitation (method REQUEST) or the cancellation (CANCEL) for a meeting. Returns { ok } or { error, status }.
async function deliver(req, m, method) {
  const [[org]] = await pool.query('SELECT id, username, email FROM admin_users WHERE id = ?', [m.organizer_admin_id || req.crm.adminId]);
  if (!org || !ics.validEmail(org.email)) return { status: 409, error: 'The organizer has no email address on their admin account. Add one first, then send the invitation.' };
  const kind = S.kindOfRow(m);
  const subjectId = kind === 'opportunity' ? m.opportunity_id : kind === 'contact' ? m.contact_id : m.account_id;
  const cur = parseAttendees(m);
  const people = await checkAttendees(kind, subjectId, cur.staffIds, cur.contactIds);
  if (people.error) return { status: 409, error: `${people.error} Edit the meeting's invitees, then send it again.` };
  const everyone = [...people.staff, ...people.contacts];
  // The organizer always gets a copy, so the meeting lands in their own calendar too.
  if (!everyone.some(p => p.email.toLowerCase() === org.email.trim().toLowerCase())) everyone.push({ name: org.username, email: org.email.trim() });
  if (everyone.length < 2) return { status: 409, error: 'Add at least one person to invite besides yourself.' };
  const seq = Number(m.sequence_no);
  const body = ics.buildInvite({
    method, uid: m.uid, sequence: seq, title: m.title, details: m.details, location: m.location, startsAt: m.starts_at, endsAt: m.ends_at,
    organizer: { name: org.username, email: org.email }, attendees: everyone,
  });
  const mail = ics.inviteEmail({ method, title: m.title, details: m.details, location: m.location, startsAt: m.starts_at, endsAt: m.ends_at, organizerName: org.username, updated: method === 'REQUEST' && !!m.invite_sent_at });
  try {
    await mailer.sendMeetingInviteEmail({ to: everyone.map(p => p.email), replyTo: org.email.trim(), subject: mail.subject, text: mail.text, html: mail.html, ics: body, method });
  } catch (err) {
    console.error('crm meeting invitation not sent:', err && err.message);
    return { status: 502, error: 'The invitation could not be sent. Check the site\'s email settings, then try again. Nothing was marked as sent.' };
  }
  return { ok: true, recipients: everyone.length };
}

router.post('/:id/send', requireAuth, requireCrm('write'), async (req, res) => {
  const m = await loadWritable(req, res);
  if (!m) return;
  if (m.status !== 'scheduled') return res.status(409).json({ code: 'cancelled', error: 'This meeting was cancelled.' });
  if (asDate(m.ends_at).getTime() < Date.now()) return res.status(409).json({ code: 'in_the_past', error: 'This meeting is already over. Change its time first.' });
  const r = await deliver(req, m, 'REQUEST');
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  await pool.query('UPDATE crm_appointments SET invite_sent_at = ?, invite_sequence = ? WHERE id = ?', [sqlNow(), m.sequence_no, m.id]);
  await crmAudit(req, { action: m.invite_sent_at ? 'crm_meeting_invite_updated' : 'crm_meeting_invite_sent', entityType: 'crm_meeting', entityId: m.id, next: { recipients: r.recipients, sequence: Number(m.sequence_no) } });
  res.json({ ok: true, recipients: r.recipients });
});

router.post('/:id/cancel', requireAuth, requireCrm('write'), async (req, res) => {
  const m = await loadWritable(req, res);
  if (!m) return;
  if (m.status === 'cancelled') return res.json({ ok: true, unchanged: true });
  const next = { ...m, sequence_no: Number(m.sequence_no) + 1 };
  const [u] = await pool.query("UPDATE crm_appointments SET status = 'cancelled', sequence_no = ? WHERE id = ? AND status = 'scheduled'", [next.sequence_no, m.id]);
  if (!u.affectedRows) return res.json({ ok: true, unchanged: true });
  let noticeSent = null;
  let warning = null;
  // Someone who was invited needs to be told. If that email cannot go out, the meeting is still cancelled here and the page says so plainly.
  if (m.invite_sent_at) {
    const r = await deliver(req, next, 'CANCEL');
    noticeSent = !!r.ok;
    if (!r.ok) warning = `The meeting is cancelled here, but the cancellation email was not sent: ${r.error}`;
  }
  await crmAudit(req, { action: 'crm_meeting_cancelled', entityType: 'crm_meeting', entityId: m.id, next: { noticeSent } });
  res.json({ ok: true, noticeSent, warning });
});

module.exports = router;

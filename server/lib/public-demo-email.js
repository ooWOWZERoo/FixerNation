// Emailing a prospect demo invitation to the people at a group (docs/reference/demo-invitation-email-requirements.md). Staff pick one to five people, check the
// message, and send; each person gets their own email from the system address, with the Reply-To staff typed. Every attempt is recorded in
// public_demo_invitation_recipients (never the message, the code or any secret).
//
// Rules this file keeps (numbers are the requirements doc's):
//  - R2: only the demo link and the access code are in the email (never the password or PIN, never the group's name; the template has no merge field for it).
//  - R3: an invitation that is not open, or demos being paused, means nothing is sent.
//  - R4: a person who unsubscribed, whose last campaign email bounced, whose last demo email was refused for good, or who has a test address, is skipped with a reason.
//  - R5: 5 people per send, 10 people per invitation, and a daily cap (setting demo_email_daily_cap, default 50).
//  - R7: a sent email moves the contact's last_contacted_at. It never changes the Suspect / Prospect / Customer label.
//  - R9: a typed address with no CRM contact is sent and recorded with no contact id; no contact is created.
//  - R10: the wording comes from the email_automations row 'demo_invitation' (editable on the Automations page). It is NOT sent through fireAutomation, which hides
//    every error; here staff need to see which address failed.
// `conn` is the pool in the routes. SQL stays portable (the tests run it on node:sqlite).

const A = require('./public-demo-admin');
const F = require('./public-demo-fixtures');
const inv = require('./public-demo-invitations');
const { formatEastern } = require('./public-demo-window');
const { renderTemplate } = require('./automations');
const { touchByEmail } = require('./crm-contact-history');

const EVENT_KEY = 'demo_invitation';
const MAX_PER_SEND = 5;
const MAX_PER_INVITATION = 10;
const DEFAULT_DAILY_CAP = 50;
const CAP_SETTING = 'demo_email_daily_cap';
const DAY_MS = 24 * 60 * 60 * 1000;

const bad = (message, code) => Object.assign(new Error(message), { status: 400, code });
const conflict = (message, code) => Object.assign(new Error(message), { status: 409, code });
const toDb = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const isMissing = (err) => !!err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)/i.test(String(err.message)));

// ---- Addresses -----------------------------------------------------------------------------------------------------------------------------------

// One plain address: no spaces, quotes, commas, semicolons or angle brackets (so it cannot carry a second address or a display name), no line break.
const EMAIL_RE = /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/;
function cleanEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim();
  if (!e || e.length > 254 || /[\r\n]/.test(v)) return null;
  return EMAIL_RE.test(e) ? e : null;
}

// Reply-To: empty means "no Reply-To header". Anything else must be one clean address.
function parseReplyTo(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw bad('Reply to must be one email address.', 'bad_reply_to');
  if (!v.trim()) return '';
  const e = cleanEmail(v);
  if (!e) throw bad('Reply to must be one email address, with no spaces, commas or line breaks.', 'bad_reply_to');
  return e;
}

const isTestAddress = (email) => /@example\.com$/i.test(email);

// ---- The template --------------------------------------------------------------------------------------------------------------------------------

async function getTemplate(conn) {
  try {
    const [rows] = await conn.query('SELECT subject, body, enabled FROM email_automations WHERE event_key = ?', [EVENT_KEY]);
    return rows[0] ? { subject: rows[0].subject, body: rows[0].body, enabled: Number(rows[0].enabled) === 1 } : null;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

// What every email of this invitation says. {{firstName}} is filled in per person when sending.
function fieldsFor(invitation, siteUrl) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  return {
    demoLink: `${base}${F.PUBLIC_DEMO_PAGE_PATH}`,
    accessCode: invitation.accessCodeFormatted,
    endDate: formatEastern(invitation.endsAt),
  };
}

// The subject and message as staff first see them: the template with the invitation's own details in, and {{firstName}} left for each person.
function previewFor(template, invitation, siteUrl) {
  const f = { ...fieldsFor(invitation, siteUrl), firstName: '{{firstName}}' };
  return { subject: renderTemplate(template.subject, f), body: renderTemplate(template.body, f) };
}

// ---- Who may be emailed (R4) ---------------------------------------------------------------------------------------------------------------------

async function latestOrNull(conn, sql, params) {
  try { const [rows] = await conn.query(sql, params); return rows[0] || null; } catch (err) { if (isMissing(err)) return null; throw err; }
}

// Looks one address up. Returns { email, contactId, firstName, ok, reason }.
async function checkRecipient(conn, rawEmail) {
  const email = cleanEmail(rawEmail);
  if (!email) return { email: String(rawEmail || '').slice(0, 254), ok: false, reason: "That doesn't look like an email address." };
  if (isTestAddress(email)) return { email, ok: false, reason: "That's a test address. To try this out, type your own address." };
  const lower = email.toLowerCase();
  const [rows] = await conn.query('SELECT id, name, status FROM newsletter_contacts WHERE LOWER(TRIM(email)) = ? ORDER BY id LIMIT 1', [lower]);
  const c = rows[0] || null;
  const out = { email, contactId: c ? Number(c.id) : null, firstName: 'there', ok: true };
  if (c && c.name && String(c.name).trim()) out.firstName = String(c.name).trim().split(/\s+/)[0];
  if (c && String(c.status || '').toLowerCase() === 'unsubscribed') return { ...out, ok: false, reason: 'They unsubscribed from our emails.' };
  const bounced = await latestOrNull(conn, 'SELECT status FROM campaign_sends WHERE LOWER(email) = ? ORDER BY id DESC LIMIT 1', [lower]);
  if (bounced && bounced.status === 'bounced') return { ...out, ok: false, reason: 'Our last email to them bounced.' };
  const refused = await latestOrNull(conn, 'SELECT result, error_code FROM public_demo_invitation_recipients WHERE LOWER(email) = ? ORDER BY id DESC LIMIT 1', [lower]);
  if (refused && refused.result === 'failed' && /^5/.test(String(refused.error_code || ''))) return { ...out, ok: false, reason: 'An earlier demo email to this address was refused for good.' };
  return out;
}

// ---- Limits (R5) ---------------------------------------------------------------------------------------------------------------------------------

async function dailyCap(conn) {
  const n = Number(await A.getSettingRaw(conn, CAP_SETTING));
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

async function listRecipients(conn, invitationId) {
  try {
    const [rows] = await conn.query(
      'SELECT id, email, contact_id, result, sent_by, sent_at FROM public_demo_invitation_recipients WHERE invitation_id = ? ORDER BY id DESC LIMIT 100', [invitationId]);
    return rows.map(r => ({ id: Number(r.id), email: r.email, contactId: r.contact_id ? Number(r.contact_id) : null, result: r.result, sentBy: r.sent_by, sentAt: String(r.sent_at) }));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

async function checkLimits(conn, invitationId, emails, now) {
  if (emails.length > MAX_PER_SEND) throw bad(`You can email up to ${MAX_PER_SEND} people at a time.`, 'too_many_per_send');
  const [already] = await conn.query("SELECT DISTINCT LOWER(email) AS e FROM public_demo_invitation_recipients WHERE invitation_id = ? AND result = 'sent'", [invitationId]);
  const have = new Set(already.map(r => r.e));
  const total = have.size + emails.filter(e => !have.has(e.toLowerCase())).length;
  if (total > MAX_PER_INVITATION) throw bad(`One invitation can be emailed to up to ${MAX_PER_INVITATION} people. This one has already gone to ${have.size}.`, 'too_many_per_invitation');
  const cap = await dailyCap(conn);
  const [[today]] = await conn.query("SELECT COUNT(*) AS n FROM public_demo_invitation_recipients WHERE result = 'sent' AND sent_at >= ?", [toDb(new Date(now.getTime() - DAY_MS))]);
  if (Number(today.n) + emails.length > cap) throw bad(`That would pass the daily limit of ${cap} demo emails (${Number(today.n)} sent in the last 24 hours).`, 'daily_cap');
}

// ---- Sending -------------------------------------------------------------------------------------------------------------------------------------

// A server's error code only (the message can contain the address), cleaned and short.
const errorCode = (err) => String((err && (err.responseCode || err.code)) || 'error').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 30);

const oneLine = (s, max) => (typeof s === 'string' && s.trim() && !/[\r\n]/.test(s) && s.trim().length <= max ? s.trim() : null);

// The staff pressed Send. `invitation` comes from getInvitation(..., { secrets: true }). `recipients` is [{ email }]. `send` is the mailer function (a test passes a stand-in).
async function sendInvitation(conn, { invitation, recipients, subject, body, replyTo, sentBy, siteUrl, send, now = new Date() }) {
  if (!invitation || !invitation.open) throw conflict('That invitation has ended, so its code no longer works. Nothing was sent.', 'not_open');
  if (await inv.isPaused(conn)) throw conflict('Demos are paused, so this code would not work. Resume demos first. Nothing was sent.', 'paused');
  const template = await getTemplate(conn);
  if (!template) throw conflict('The demo invitation email has not been set up yet. Run scripts/seed-email-automations.js.', 'no_template');
  if (!template.enabled) throw conflict('The demo invitation email is switched off on the Automations page.', 'template_off');

  const subj = oneLine(subject, 200);
  if (!subj) throw bad('Give the email a subject (one line).', 'bad_subject');
  if (typeof body !== 'string' || !body.trim() || body.length > 6000) throw bad('Write the message (up to 6,000 characters).', 'bad_body');
  const reply = parseReplyTo(replyTo);
  if (!Array.isArray(recipients) || !recipients.length) throw bad('Choose who to email.', 'no_recipients');

  const seen = new Set();
  const wanted = [];
  for (const r of recipients) {
    const raw = r && typeof r === 'object' ? r.email : null;
    const key = String(raw || '').trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(raw);
  }
  if (wanted.length > MAX_PER_SEND) throw bad(`You can email up to ${MAX_PER_SEND} people at a time.`, 'too_many_per_send');

  const checked = [];
  for (const raw of wanted) checked.push(await checkRecipient(conn, raw));
  const okList = checked.filter(c => c.ok);
  if (okList.length) await checkLimits(conn, invitation.id, okList.map(c => c.email), now);

  const fields = fieldsFor(invitation, siteUrl);
  const sendFn = send || require('./mailer').sendDemoInvitationEmail;
  const results = [];
  for (const c of checked) {
    if (!c.ok) { results.push({ email: c.email, result: 'skipped', reason: c.reason }); continue; }
    const f = { ...fields, firstName: c.firstName };
    let result = 'sent', code = null;
    try {
      await sendFn({ to: c.email, subject: renderTemplate(subj, f), body: renderTemplate(body, f), replyTo: reply });
    } catch (err) {
      result = 'failed'; code = errorCode(err);
    }
    await conn.query(
      'INSERT INTO public_demo_invitation_recipients (invitation_id, contact_id, email, result, error_code, sent_by, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [invitation.id, c.contactId, c.email, result, code, String(sentBy || '').slice(0, 80), toDb(now)]);
    if (result === 'sent') await touchByEmail(conn, c.email, now);
    results.push(result === 'sent' ? { email: c.email, result } : { email: c.email, result, reason: 'The mail server refused it. You can try again.' });
  }
  return { results, sent: results.filter(r => r.result === 'sent').length, failed: results.filter(r => r.result === 'failed').length, skipped: results.filter(r => r.result === 'skipped').length, replyTo: reply };
}

module.exports = {
  EVENT_KEY, MAX_PER_SEND, MAX_PER_INVITATION, DEFAULT_DAILY_CAP, CAP_SETTING,
  cleanEmail, parseReplyTo, isTestAddress, getTemplate, fieldsFor, previewFor, checkRecipient, listRecipients, checkLimits, sendInvitation, dailyCap,
};

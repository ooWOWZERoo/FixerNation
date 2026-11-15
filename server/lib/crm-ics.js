// Sales CRM meetings (phase 3): the calendar invitation (.ics, RFC 5545) and the plain email that carries it. Pure functions: no database, no mail transport
// (sending goes through lib/mailer.js, which owns the only transport). Every piece of text that came from a person is escaped the way RFC 5545 asks
// (backslash, semicolon, comma, new line), lines are folded at 75 bytes, and an address or a name can never carry a line break into a header.

const DOMAIN = 'fixernationeducation.com';
const EMAIL_RE = /^[^\s@<>",;:\\()[\]]+@[^\s@<>",;:\\()[\]]+\.[^\s@<>",;:\\()[\]]+$/;

// Text values: escape \ ; , and line breaks. Also drops other control characters.
function icsText(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// A parameter value (the CN= of an attendee) sits inside double quotes: no quotes, no control characters.
function icsParam(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 120); }

function validEmail(v) {
  return typeof v === 'string' && v.length <= 254 && !/[\r\n]/.test(v) && EMAIL_RE.test(v.trim());
}

// Fold to 75 octets per line (counting bytes, never splitting a character); continuation lines begin with one space.
function fold(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

// 'YYYY-MM-DD HH:MM:SS' (UTC, as stored) or a Date -> '20261203T150000Z'
function stamp(v) {
  const d = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// method: 'REQUEST' (invite or update: raise `sequence` when something changed) or 'CANCEL'. attendees: [{ name, email }] (already validated by the caller).
function buildInvite({ method, uid, sequence, title, details, location, startsAt, endsAt, organizer, attendees, now }) {
  if (!['REQUEST', 'CANCEL'].includes(method)) throw new Error('method must be REQUEST or CANCEL');
  if (!validEmail(organizer && organizer.email)) throw new Error('The organizer needs a valid email address.');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Fixer Nation Education//Customer Hub//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}@${DOMAIN}`,
    `DTSTAMP:${stamp(now || new Date())}`,
    `DTSTART:${stamp(startsAt)}`,
    `DTEND:${stamp(endsAt)}`,
    `SEQUENCE:${Number(sequence) || 0}`,
    `SUMMARY:${icsText(title)}`,
  ];
  if (details) lines.push(`DESCRIPTION:${icsText(details)}`);
  if (location) lines.push(`LOCATION:${icsText(location)}`);
  lines.push(`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push(`ORGANIZER;CN="${icsParam(organizer.name || organizer.email)}":mailto:${organizer.email.trim()}`);
  for (const a of attendees || []) {
    if (!validEmail(a.email)) continue;
    lines.push(`ATTENDEE;CN="${icsParam(a.name || a.email)}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=${method === 'REQUEST' ? 'TRUE' : 'FALSE'}:mailto:${a.email.trim()}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const htmlEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WHEN = new Intl.DateTimeFormat('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });

// The email that carries the invitation: plain text plus a small HTML copy, with the time spelled out in UTC (the calendar file shows it in the reader's own zone).
function inviteEmail({ method, title, details, location, startsAt, endsAt, organizerName, updated }) {
  const when = `${WHEN.format(new Date(`${String(startsAt).replace(' ', 'T')}Z`))} to ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }).format(new Date(`${String(endsAt).replace(' ', 'T')}Z`))}`;
  const cancelled = method === 'CANCEL';
  const subject = `${cancelled ? 'Cancelled: ' : updated ? 'Updated: ' : 'Invitation: '}${String(title).slice(0, 150)}`;
  const intro = cancelled ? `${organizerName || 'We'} cancelled this meeting.` : updated ? `${organizerName || 'We'} changed this meeting. The calendar file updates your copy.` : `${organizerName || 'We'} invited you to a meeting. Open the attached calendar file to add it to your calendar.`;
  const textLines = [intro, '', title, when];
  if (location) textLines.push(`Where: ${location}`);
  if (details) textLines.push('', details);
  const html = `<p>${htmlEsc(intro)}</p><p><strong>${htmlEsc(title)}</strong><br>${htmlEsc(when)}${location ? `<br>Where: ${htmlEsc(location)}` : ''}</p>${details ? `<p>${htmlEsc(details).replace(/\r?\n/g, '<br>')}</p>` : ''}`;
  return { subject, text: textLines.join('\n'), html };
}

module.exports = { icsText, icsParam, validEmail, fold, stamp, buildInvite, inviteEmail };

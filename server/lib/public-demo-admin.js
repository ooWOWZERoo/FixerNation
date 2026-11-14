// Helpers shared by the admin Demo page (routes/admin-public-demo.js), the command-line tools and the public demo routes: settings, access codes, the
// events and counts for each group, and the message staff send a district (docs/reference/shared-demo-workspaces-requirements.md).
// Everything takes a database connection (or the pool) so the scripts can use their own connection and open no second pool.

const crypto = require('crypto');
const { PUBLIC_DEMO_PAGE_PATH } = require('./public-demo-fixtures');
const { formatEastern } = require('./public-demo-window');

async function getSettingRaw(conn, key) {
  const [rows] = await conn.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  return rows[0] ? rows[0].setting_value : '';
}
async function putSettingRaw(conn, key, value) {
  const [rows] = await conn.query('SELECT setting_key FROM settings WHERE setting_key = ?', [key]);
  if (rows[0]) await conn.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
  else await conn.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value]);
}

// Eight characters from an alphabet with no look-alikes (no I, O, 0 or 1): easy to read out over the phone. crypto, never Math.random().
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateAccessCode() {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}
// Shown as ABCD-EFGH. The page that checks it ignores case, spaces and the hyphen.
function formatAccessCode(code) {
  const c = String(code || '');
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}
function normalizeAccessCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The note staff paste into an email to the district. Plain text, written to sound like a person.
// `privateCopy` tells the group its copy is theirs alone (every invitation is a private copy since the original shared demo was retired).
function buildInviteMessage({ siteUrl, code, endsAt, privateCopy = false }) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  return [
    'Hi,',
    '',
    'Thanks for your interest in Fixer Nation Education. We set up a demo you can explore whenever it suits you. It has sample classrooms, students and lessons, and none of it is real student information.' + (privateCopy ? ' This copy of the demo is just for your group. Nothing you do in it is visible to anyone else.' : ''),
    '',
    `Open the demo: ${base}${PUBLIC_DEMO_PAGE_PATH}`,
    `Access code: ${formatAccessCode(code)}`,
    `The demo is open until ${formatEastern(endsAt)}.`,
    '',
    "Once you're in, you'll find a sign-in for each role: district administrator, school administrator, teacher, parent and student. Try as many as you like.",
    '',
    'If a question comes up, ask away. You can send us a question, submit a ticket or request a quote from the demo page at any time.',
    '',
    'Thanks again,',
  ].join('\n');
}

// ---- Events and counts -------------------------------------------------------------------------------------------------------------------------
// Access-code entries and sign-ins are recorded for the group (invitation) they belong to. No IP address, name or email is ever stored for an event.

function demoRoleKeyForEmail(email) {
  const wl = require('./public-demo-workspaces').workspaceLoginOf(String(email || '').trim().toLowerCase()); // a workspace login counts under its role
  return wl ? wl.role : null;
}

// Counted, never blocking: a failure here must not stop a visitor from getting in. An event belongs to one group's invitation (window 0: windows belonged to the
// retired original demo); an event with no invitation is not recorded.
async function recordDemoEvent(kind, detail = null, invitationId = 0) {
  if (!Number(invitationId)) return;
  try {
    const pool = require('../db/pool');
    await pool.query('INSERT INTO public_demo_events (window_id, kind, detail, invitation_id) VALUES (0, ?, ?, ?)', [kind, detail, Number(invitationId)]);
  } catch (err) {
    console.error('public demo event not recorded:', err.message);
  }
}

// Counts for each group's invitation, in one pass: access-code entries, sign-ins by role, tickets and quote requests. No address, name or email is ever stored for
// an event. Returns { [invitationId]: { gateEntries, signIns: {district, school, teacher, parent, student}, signInTotal, tickets, quotes } }; an invitation with
// no activity is absent (callers treat it as zeros). A column that is not there yet (code deployed before its alter script) is simply zero.
const ROLE_KEYS = ['district', 'school', 'teacher', 'parent', 'student'];
async function invitationCounts(conn) {
  const out = {};
  const slot = (id) => (out[id] = out[id] || { gateEntries: 0, signIns: Object.fromEntries(ROLE_KEYS.map(k => [k, 0])), signInTotal: 0, tickets: 0, quotes: 0 });
  const safe = async (sql) => {
    try { const [rows] = await conn.query(sql); return rows; } catch (err) {
      if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)/i.test(String(err.message))) return [];
      throw err;
    }
  };
  for (const r of await safe('SELECT invitation_id AS id, kind, detail, COUNT(*) AS n FROM public_demo_events WHERE invitation_id > 0 GROUP BY invitation_id, kind, detail')) {
    const c = slot(r.id);
    if (r.kind === 'gate_entry') c.gateEntries += Number(r.n);
    else if (r.kind === 'sign_in') { if (c.signIns[r.detail] !== undefined) c.signIns[r.detail] += Number(r.n); c.signInTotal += Number(r.n); }
  }
  for (const r of await safe('SELECT demo_invitation_id AS id, COUNT(*) AS n FROM support_requests WHERE demo_invitation_id > 0 GROUP BY demo_invitation_id')) slot(r.id).tickets = Number(r.n);
  for (const r of await safe('SELECT demo_invitation_id AS id, COUNT(*) AS n FROM quote_requests WHERE demo_invitation_id > 0 GROUP BY demo_invitation_id')) slot(r.id).quotes = Number(r.n);
  return out;
}

// The staff-only label for each of these invitation ids, for tagging a ticket or quote "Demo: Springfield USD". A missing table means no labels.
async function invitationLabels(conn, ids) {
  const unique = [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (!unique.length) return {};
  try {
    const [rows] = await conn.query(`SELECT id, label FROM public_demo_invitations WHERE id IN (${unique.map(() => '?').join(', ')})`, unique);
    return Object.fromEntries(rows.map(r => [Number(r.id), r.label]));
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(String(err.message))) return {};
    throw err;
  }
}

module.exports = {
  demoRoleKeyForEmail, recordDemoEvent, invitationCounts, invitationLabels,
  getSettingRaw, putSettingRaw, generateAccessCode, formatAccessCode, normalizeAccessCode, buildInviteMessage,
};

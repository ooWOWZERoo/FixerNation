// Helpers shared by the admin Demo page (routes/admin-public-demo.js) and the command-line switch (scripts/set-public-demo.js): the demo's
// settings, its access code, and the message staff send a district (docs/reference/shared-demo-environment-requirements.md, R3 and section 5).
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

// A code exists whenever the demo is on. The version goes up each time the code changes, so a visitor's gate cookie (phase 4) from the old code
// stops working at once.
async function ensureAccessCode(conn) {
  let code = await getSettingRaw(conn, 'public_demo_access_code');
  if (code) return code;
  return regenerateAccessCode(conn);
}
async function regenerateAccessCode(conn) {
  const code = generateAccessCode();
  const version = (Number(await getSettingRaw(conn, 'public_demo_code_version')) || 1) + 1;
  await putSettingRaw(conn, 'public_demo_access_code', code);
  await putSettingRaw(conn, 'public_demo_code_version', String(version));
  return code;
}

// The note staff paste into an email to the district. Plain text, written to sound like a person.
// `privateCopy` is for a group's own invitation: it tells the group its copy is theirs alone (the original single demo is shared, so it does not say this).
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

// ---- Windows, events and counts (docs/reference/shared-demo-environment-requirements.md, R9) ---------------------------------------------------
// A "window" is one stretch the demo was open for one round of visitors: a fresh turn-on starts a new one, and changing the end date does not.
// Sign-ins, tickets and quote requests carry the window number they happened in, so "this window" needs no date arithmetic (and no database
// time-zone worries). No IP address, name or email is ever stored for an event.
async function currentWindowId(conn) {
  const n = Number(await getSettingRaw(conn, 'public_demo_window_id'));
  return Number.isInteger(n) && n > 0 ? n : 1;
}
async function startNewWindow(conn) {
  const next = (Number(await getSettingRaw(conn, 'public_demo_window_id')) || 0) + 1;
  await putSettingRaw(conn, 'public_demo_window_id', String(next));
  return next;
}

const ROLE_BY_EMAIL = Object.fromEntries(Object.entries(require('./public-demo-fixtures').ACCOUNTS).map(([key, a]) => [a.email, key]));
function demoRoleKeyForEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  const wl = require('./public-demo-workspaces').workspaceLoginOf(key); // a workspace login counts under its role too
  return ROLE_BY_EMAIL[key] || (wl ? wl.role : null) || null;
}

// Counted, never blocking: a failure here must not stop a visitor from getting in. An event for a group's own invitation carries that invitation's id (and
// window 0, so it never shows in the original demo's counts); an event for the original demo carries the current window and invitation 0.
async function recordDemoEvent(kind, detail = null, invitationId = 0) {
  try {
    const pool = require('../db/pool');
    if (invitationId) await pool.query('INSERT INTO public_demo_events (window_id, kind, detail, invitation_id) VALUES (0, ?, ?, ?)', [kind, detail, Number(invitationId)]);
    else await pool.query('INSERT INTO public_demo_events (window_id, kind, detail) VALUES (?, ?, ?)', [await currentWindowId(pool), kind, detail]);
  } catch (err) {
    console.error('public demo event not recorded:', err.message);
  }
}

// A table or column that does not exist yet (code deployed before scripts/alter-add-public-demo-phase4.js ran) is simply zero.
async function countOr0(conn, sql, params) {
  try { const [[row]] = await conn.query(sql, params); return Number(row.n) || 0; } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)/i.test(String(err.message))) return 0;
    throw err;
  }
}
async function demoCounts(conn) {
  const windowId = await currentWindowId(conn);
  const signIns = {};
  for (const key of ['district', 'school', 'teacher', 'parent', 'student']) {
    signIns[key] = await countOr0(conn, "SELECT COUNT(*) AS n FROM public_demo_events WHERE window_id = ? AND kind = 'sign_in' AND detail = ?", [windowId, key]);
  }
  return {
    windowId,
    gateEntries: await countOr0(conn, "SELECT COUNT(*) AS n FROM public_demo_events WHERE window_id = ? AND kind = 'gate_entry'", [windowId]),
    signIns,
    tickets: await countOr0(conn, 'SELECT COUNT(*) AS n FROM support_requests WHERE demo_window = ?', [windowId]),
    quotes: await countOr0(conn, 'SELECT COUNT(*) AS n FROM quote_requests WHERE demo_window = ?', [windowId]),
  };
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
  currentWindowId, startNewWindow, demoRoleKeyForEmail, recordDemoEvent, demoCounts, invitationCounts, invitationLabels,
  getSettingRaw, putSettingRaw, generateAccessCode, formatAccessCode, normalizeAccessCode, ensureAccessCode, regenerateAccessCode, buildInviteMessage,
};

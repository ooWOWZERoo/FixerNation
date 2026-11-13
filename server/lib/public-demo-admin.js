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
function buildInviteMessage({ siteUrl, code, endsAt }) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  return [
    'Hi,',
    '',
    'Thanks for your interest in Fixer Nation Education. We set up a demo you can explore whenever it suits you. It has sample classrooms, students and lessons, and none of it is real student information.',
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

// Counted, never blocking: a failure here must not stop a visitor from getting in.
async function recordDemoEvent(kind, detail = null) {
  try {
    const pool = require('../db/pool');
    await pool.query('INSERT INTO public_demo_events (window_id, kind, detail) VALUES (?, ?, ?)', [await currentWindowId(pool), kind, detail]);
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

module.exports = {
  currentWindowId, startNewWindow, demoRoleKeyForEmail, recordDemoEvent, demoCounts,
  getSettingRaw, putSettingRaw, generateAccessCode, formatAccessCode, normalizeAccessCode, ensureAccessCode, regenerateAccessCode, buildInviteMessage,
};

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

module.exports = {
  getSettingRaw, putSettingRaw, generateAccessCode, formatAccessCode, normalizeAccessCode, ensureAccessCode, regenerateAccessCode, buildInviteMessage,
};

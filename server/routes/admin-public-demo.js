// Admin API for the shared demo environment (docs/reference/shared-demo-environment-requirements.md, section 5): the on/off switch, end date,
// access code, shared password and PIN, reset and unlock. Every route here is the FNE admin's (requireAuth, never a site-user session).
// The scripts (scripts/seed-public-demo.js, reset-public-demo.js, set-public-demo.js) hold the logic; this file only calls them inside a
// transaction and records who did what. Secrets (the password, PIN and code) are shown to the admin and never written to the audit log.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const F = require('../lib/public-demo-fixtures');
const A = require('../lib/public-demo-admin');
const { evaluateDemoWindow, formatEastern } = require('../lib/public-demo-window');
const seedLib = require('../scripts/seed-public-demo');
const { resetDemo } = require('../scripts/reset-public-demo');
const sw = require('../scripts/set-public-demo');
const { siteLoginBlockedFor, unlockSiteLogin } = require('./site-auth');
const { lockStatus, clearLock } = require('../lib/pin-lockout');

const router = express.Router();
router.use(requireAuth); // one gate for the whole file: a test fails if this line goes

const LOGIN_LABELS = { district: 'District administrator', school: 'School administrator', teacher: 'Teacher', parent: 'Parent' };

async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function logAction(req, action, prev, next) {
  await audit(pool, {
    actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
    action: `public_demo.${action}`, entityType: 'public_demo', prevValue: prev, newValue: next, ipAddress: req.ip,
  });
}

async function readSwitch(conn) {
  const enabled = await A.getSettingRaw(conn, 'public_demo_enabled');
  const endsAt = await A.getSettingRaw(conn, 'public_demo_ends_at');
  return { enabled, endsAt, window: evaluateDemoWindow({ enabled, endsAt }) };
}

async function getState() {
  const { enabled, endsAt, window } = await readSwitch(pool);
  const [users] = await pool.query(
    `SELECT id, email FROM site_users WHERE is_shared_demo = 1 AND email IN (${Object.values(F.ACCOUNTS).map(() => '?').join(', ')})`,
    Object.values(F.ACCOUNTS).map(a => a.email));
  const seeded = users.length === Object.keys(F.ACCOUNTS).length;
  const state = {
    open: window.open,
    reason: window.reason,
    switchOn: String(enabled).trim().toLowerCase() === 'true',
    endsAt: window.endsAt ? window.endsAt.toISOString() : (endsAt || null),
    endsAtEastern: window.endsAt ? formatEastern(window.endsAt) : null,
    maxDays: await sw.maxDays(pool),
    seeded,
    pageUrl: `${(process.env.SITE_URL || '').replace(/\/$/, '')}${F.PUBLIC_DEMO_PAGE_PATH}`,
    pageReady: F.PUBLIC_DEMO_PAGE_READY,
  };
  if (!seeded) return state;

  const code = await A.getSettingRaw(pool, 'public_demo_access_code');
  const password = await A.getSettingRaw(pool, 'public_demo_password');
  const pin = await A.getSettingRaw(pool, 'public_demo_pin');
  state.accessCode = code ? A.formatAccessCode(code) : '';
  state.password = password;
  state.pin = pin;
  const teacher = users.find(u => u.email === F.ACCOUNTS.teacher.email);
  const [[room]] = await pool.query('SELECT join_code FROM classrooms WHERE teacher_site_user_id = ? AND name = ?', [teacher.id, F.DEMO_CLASSROOM_NAME]);
  state.joinCode = room ? room.join_code : '';
  state.logins = Object.keys(F.ACCOUNTS).map(key => ({
    role: LOGIN_LABELS[key], userId: F.ACCOUNTS[key].email, signIn: F.LOGIN_PAGES[key], lockedSeconds: siteLoginBlockedFor(F.ACCOUNTS[key].email),
  }));
  state.logins.push({ role: 'Student', userId: F.STUDENTS[0].username, signIn: F.LOGIN_PAGES.student, lockedSeconds: lockStatus(F.STUDENTS[0].username).seconds });
  state.lockedCount = state.logins.filter(l => l.lockedSeconds > 0).length;
  if (window.open && code && F.PUBLIC_DEMO_PAGE_READY) {
    state.message = A.buildInviteMessage({ siteUrl: process.env.SITE_URL, code, endsAt: window.endsAt });
  }
  return state;
}

const fail = (res, status, error) => res.status(status).json({ error });

router.get('/', async (req, res) => {
  res.json(await getState());
});

// Create (or top up) the demo accounts and data. Safe to repeat. Generates the shared password and PIN the first time; never turns the demo on.
router.post('/setup', async (req, res) => {
  await inTransaction(async (conn) => {
    const password = (await A.getSettingRaw(conn, 'public_demo_password')) || seedLib.generatePassword();
    const pin = (await A.getSettingRaw(conn, 'public_demo_pin')) || seedLib.generatePin();
    await seedLib.seed(conn, { password, pin }, seedLib.makeReport());
    await A.putSettingRaw(conn, 'public_demo_password', password);
    await A.putSettingRaw(conn, 'public_demo_pin', pin);
  });
  await logAction(req, 'setup', null, null);
  res.json(await getState());
});

// Turn the demo on, or move its end date. An end time is always required. Turning it on from closed resets the demo data first (each window
// starts clean); changing the end date of an open demo does not (the people using it keep their place).
router.post('/on', async (req, res) => {
  const body = req.body || {};
  if (body.days !== undefined && typeof body.days !== 'number') return fail(res, 400, 'The number of days must be a number.');
  if (body.until !== undefined && typeof body.until !== 'string') return fail(res, 400, 'The end time must be text.');
  if (body.days === undefined && body.until === undefined) return fail(res, 400, 'Choose how long the demo should stay open.');
  const before = await readSwitch(pool);
  let after;
  try {
    after = await inTransaction((conn) => sw.turnOn(conn, { days: body.days, until: body.until, reset: !before.window.open }));
  } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    throw err;
  }
  await logAction(req, before.window.open ? 'extended' : 'on',
    { open: before.window.open, endsAt: before.window.endsAt ? before.window.endsAt.toISOString() : null }, { endsAt: after.endsAt.toISOString() });
  res.json(await getState());
});

router.post('/off', async (req, res) => {
  const before = await readSwitch(pool);
  await sw.turnOff(pool);
  await logAction(req, 'off', { open: before.window.open, endsAt: before.window.endsAt ? before.window.endsAt.toISOString() : null }, { open: false });
  res.json(await getState());
});

// A new access code: everyone who entered the old one is shut out at once (the code version goes up).
router.post('/regenerate-code', async (req, res) => {
  await A.regenerateAccessCode(pool);
  await logAction(req, 'code_regenerated', null, null);
  res.json(await getState());
});

// New shared password and/or PIN. Re-hashes the logins and signs every demo browser out.
router.post('/regenerate-password', async (req, res) => {
  const what = (req.body || {}).what;
  if (!['password', 'pin', 'both'].includes(what)) return fail(res, 400, 'Choose password, pin or both.');
  const state = await getState();
  if (!state.seeded) return fail(res, 409, 'Set up the demo first.');
  await inTransaction(async (conn) => {
    const password = what === 'pin' ? state.password : seedLib.generatePassword();
    const pin = what === 'password' ? state.pin : seedLib.generatePin();
    await seedLib.seed(conn, { password, pin }, seedLib.makeReport());
    await A.putSettingRaw(conn, 'public_demo_password', password);
    await A.putSettingRaw(conn, 'public_demo_pin', pin);
  });
  await logAction(req, 'password_regenerated', null, { changed: what });
  res.json(await getState());
});

// Put the demo data back to how the seed made it. Works whether or not the demo is open.
router.post('/reset', async (req, res) => {
  const state = await getState();
  if (!state.seeded) return fail(res, 409, 'Set up the demo first.');
  await inTransaction((conn) => resetDemo(conn, {}, seedLib.makeReport()));
  await logAction(req, 'reset', null, null);
  res.json(await getState());
});

// Clear the sign-in lockouts on the five demo logins (a stranger's wrong guesses can lock a shared login). The per-IP limits stay as they are.
router.post('/unlock', async (req, res) => {
  for (const a of Object.values(F.ACCOUNTS)) unlockSiteLogin(a.email);
  clearLock(F.STUDENTS[0].username);
  await logAction(req, 'unlocked', null, null);
  res.json(await getState());
});

module.exports = router;

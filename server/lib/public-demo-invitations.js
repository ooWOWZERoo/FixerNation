// Prospect demo INVITATIONS (docs/reference/shared-demo-workspaces-requirements.md, R1, R3, R6, R7). One invitation is one group's visit: a label (the group's
// name, typed by staff), a private access code, an end time, and one private workspace. Creating one takes a free workspace, wipes it, and gives it a new
// password and PIN; ending one (by staff, or when its end time passes) wipes the workspace again, kills its password and PIN, and returns it to the pool.
//
// Two kinds of function live here:
//   - the staff operations (create, extend, end, new code, new password or PIN, sweep, list), which take a database connection first so the command-line tool
//     (its own connection) and the admin routes can both use them; and
//   - the lookups the server asks on every demo request (is this workspace's invitation open? is there an invitation with this code?), which use the shared
//     pool, keep what they find for a few seconds, and FAIL CLOSED: if anything cannot be read, the answer is "closed".
//
// An invitation is OPEN only while its status is 'active', its end time is ahead, and demos are not paused (the master "pause all demos" setting
// public_demo_paused). Times are stored in UTC.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const A = require('./public-demo-admin');
const { workspaceFixtures, workspaceLogins, workspaceLoginOf, MAX_DEMO_WORKSPACES } = require('./public-demo-workspaces');
const { formatEastern } = require('./public-demo-window');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;
const DEFAULT_MAX_DAYS = 30;
const ENDING_SOON_MS = DAY_MS;

// Mistakes the person asking can fix carry status 400 (or 409 for "that is not possible right now"), so the admin page can show them as they are.
const bad = (message, code) => Object.assign(new Error(message), { status: 400, code });
const conflict = (message, code) => Object.assign(new Error(message), { status: 409, code });
const notFound = (message = 'That invitation was not found.') => Object.assign(new Error(message), { status: 404, code: 'not_found' });

const isMissing = (err) => !!err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)/i.test(String(err.message)));

// ---- Times (UTC in the database) -------------------------------------------------------------------------------------------------------------

const toDb = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
// The site's own connection returns a DATETIME as plain text ("2026-11-20 05:48:02", dateStrings), and we wrote it in UTC, so it is read as UTC. A connection
// that does not use dateStrings (a command-line script's) hands back a Date built from that same text read as LOCAL time; its local fields are the text, so
// they are put back together as UTC. (Only ever called on a value read from the database, never on a real moment in time.)
function fromDb(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()));
  }
  const d = new Date(String(v).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Pause (the master switch) ---------------------------------------------------------------------------------------------------------------

async function isPaused(conn) {
  return String(await A.getSettingRaw(conn, 'public_demo_paused')).trim().toLowerCase() === 'true';
}
async function setPaused(conn, paused) {
  await A.putSettingRaw(conn, 'public_demo_paused', paused ? 'true' : 'false');
  invalidateCache();
}

async function maxDays(conn) {
  const n = Number(await A.getSettingRaw(conn, 'public_demo_max_days'));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_DAYS;
}

// ---- Shaping a row -----------------------------------------------------------------------------------------------------------------------------

// What staff see. Never includes the access code's secrets unless asked: the list has no password or PIN.
function present(row, { secrets = false, now = new Date() } = {}) {
  if (!row) return null;
  const endsAt = fromDb(row.ends_at);
  const open = row.status === 'active' && !!endsAt && endsAt.getTime() > now.getTime();
  let state = 'ended';
  if (row.status === 'active') state = !open ? 'expired' : (endsAt.getTime() - now.getTime() < ENDING_SOON_MS ? 'ending_soon' : 'active');
  const out = {
    id: Number(row.id), label: row.label, workspaceId: Number(row.workspace_id), codeVersion: Number(row.code_version), status: row.status, state, open,
    startsAt: fromDb(row.starts_at), endsAt, endsAtEastern: endsAt ? formatEastern(endsAt) : '', endedAt: fromDb(row.ended_at), endReason: row.end_reason || null,
    createdBy: row.created_by || null,
  };
  if (secrets) { out.accessCode = row.access_code; out.accessCodeFormatted = A.formatAccessCode(row.access_code); out.password = row.password; out.pin = row.pin; }
  return out;
}

// The five logins of a group's workspace, as the demo page and the staff message show them.
function loginsFor(workspaceId) { return workspaceLogins(workspaceId); }

// ---- Transactions ------------------------------------------------------------------------------------------------------------------------------

// A real connection can wrap a change in a transaction; the pool (and a test stand-in) cannot, so there it just runs.
async function inTransaction(conn, fn) {
  if (typeof conn.beginTransaction !== 'function') return fn();
  await conn.beginTransaction();
  try { const result = await fn(); await conn.commit(); return result; } catch (err) { await conn.rollback(); throw err; }
}

// ---- The work on a workspace -------------------------------------------------------------------------------------------------------------------

// Puts a workspace back to its seeded state with fresh join and parent codes (so nobody from the last group can join the next group's classroom).
async function resetWorkspace(conn, workspaceId, { rounds = 10 } = {}) {
  const { resetDemo } = require('../scripts/reset-public-demo'); // loaded when needed: the scripts are not part of the server's startup
  await resetDemo(conn, { rounds, fx: workspaceFixtures(workspaceId), newCodes: true });
}

// Sets the shared password and/or the student PIN of a workspace, and signs out everyone who had a session in it (the same thing a real password
// change does). Pass only what is changing.
async function applySecrets(conn, workspaceId, { password = null, pin = null, rounds = 10 }) {
  const fx = workspaceFixtures(workspaceId);
  if (password !== null) {
    const hash = await bcrypt.hash(password, rounds);
    let changed = 0;
    for (const key of Object.keys(fx.accounts)) {
      const [r] = await conn.query('UPDATE site_users SET password_hash = ?, session_invalidated_at = NOW() WHERE email = ? AND demo_workspace_id = ?', [hash, fx.accounts[key].email, workspaceId]);
      changed += r.affectedRows || 0;
    }
    if (changed !== Object.keys(fx.accounts).length) throw conflict(`Demo workspace ${workspaceId} is not set up completely. Run scripts/seed-demo-workspaces.js --apply.`, 'not_seeded');
  }
  if (pin !== null) {
    const shared = fx.students.find(s => s.shared);
    const [r] = await conn.query('UPDATE classroom_students SET password_hash = ?, is_active = 1 WHERE username = ?', [await bcrypt.hash(pin, rounds), shared.username]);
    if (!(r.affectedRows > 0)) throw conflict(`Demo workspace ${workspaceId} has no demo student. Run scripts/seed-demo-workspaces.js --apply.`, 'not_seeded');
  }
}

const generatePassword = () => require('../scripts/seed-public-demo').generatePassword();
const generatePin = () => require('../scripts/seed-public-demo').generatePin();
const unusableSecret = () => crypto.randomBytes(32).toString('hex'); // for a workspace nobody holds: nothing anyone could type

// A workspace nobody holds: wiped, with passwords and PIN nobody knows.
async function wipeAndClose(conn, workspaceId, opts = {}) {
  await resetWorkspace(conn, workspaceId, opts);
  await applySecrets(conn, workspaceId, { password: unusableSecret(), pin: unusableSecret(), rounds: opts.rounds || 10 });
}

async function claimFreeWorkspace(conn) {
  const [free] = await conn.query("SELECT id FROM public_demo_workspaces WHERE status = 'free' ORDER BY id");
  const [[total]] = await conn.query('SELECT COUNT(*) AS n FROM public_demo_workspaces');
  if (!Number(total.n)) throw conflict('There are no demo workspaces yet. Run scripts/seed-demo-workspaces.js --apply first.', 'no_workspaces');
  for (const w of free) {
    // Only one caller can change a workspace from free to in_use, so two invitations made at the same moment never get the same one.
    const [r] = await conn.query("UPDATE public_demo_workspaces SET status = 'in_use' WHERE id = ? AND status = 'free'", [w.id]);
    if (r.affectedRows === 1) return Number(w.id);
  }
  throw conflict(`All ${total.n} demo workspaces are in use. End one, or add more (scripts/seed-demo-workspaces.js --count N --apply).`, 'pool_full');
}

async function uniqueCode(conn) {
  for (let i = 0; i < 20; i++) {
    const code = A.generateAccessCode();
    const [rows] = await conn.query('SELECT id FROM public_demo_invitations WHERE access_code = ?', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not make a unique access code.');
}

function cleanLabel(label) {
  const v = String(label === undefined || label === null ? '' : label).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) throw bad("Give the group a name (for example the district's name), so you can tell the invitations apart.", 'label');
  if (v.length > 120) throw bad('The group name can be at most 120 characters.', 'label');
  return v;
}

// An end time from "N days from now" or an exact moment (which needs a time zone), never open-ended and never past the longest window.
function resolveEnd({ days, until }, now, limitDays) {
  let end;
  if (days !== undefined && days !== null && days !== '') {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0) throw bad('The number of days must be above 0.', 'days');
    end = new Date(now.getTime() + n * DAY_MS);
  } else if (until !== undefined && until !== null && until !== '') {
    if (!/(Z|[+-]\d\d:?\d\d)$/i.test(String(until))) throw bad('The end time needs a time zone, for example 2026-11-21T17:00:00-05:00 or ending in Z.', 'until');
    end = new Date(until);
    if (Number.isNaN(end.getTime())) throw bad('The end time is not a valid date and time.', 'until');
  } else {
    end = new Date(now.getTime() + DEFAULT_DAYS * DAY_MS);
  }
  if (end.getTime() <= now.getTime()) throw bad('The end time is already in the past.', 'until');
  if (end.getTime() - now.getTime() > limitDays * DAY_MS + 1000) throw bad(`The longest demo is ${limitDays} days (setting public_demo_max_days).`, 'days');
  return end;
}

// ---- Staff operations ------------------------------------------------------------------------------------------------------------------------------

async function getRow(conn, id) {
  const [rows] = await conn.query('SELECT * FROM public_demo_invitations WHERE id = ?', [id]);
  return rows[0] || null;
}

async function getInvitation(conn, id, { secrets = false, now = new Date() } = {}) {
  return present(await getRow(conn, id), { secrets, now });
}

// Newest first. Ended invitations are included unless `includeEnded` is false; with `endedWithinDays`, an invitation that ended longer ago than that is left
// out of the list (the row stays, so its access code is never reused).
async function listInvitations(conn, { includeEnded = true, endedWithinDays = null, now = new Date() } = {}) {
  const [rows] = await conn.query(`SELECT * FROM public_demo_invitations ${includeEnded ? '' : "WHERE status = 'active'"} ORDER BY id DESC`);
  const cutoff = endedWithinDays ? now.getTime() - endedWithinDays * DAY_MS : null;
  return rows
    .filter(r => cutoff === null || r.status === 'active' || ((fromDb(r.ended_at) || new Date(0)).getTime() >= cutoff))
    .map(r => present(r, { now }));
}

// How many private workspaces there are, how many a group is using, and how many more can be added.
async function poolStatus(conn) {
  const [rows] = await conn.query('SELECT id, status FROM public_demo_workspaces ORDER BY id');
  const inUse = rows.filter(r => r.status === 'in_use').length;
  const highest = rows.reduce((m, r) => Math.max(m, Number(r.id)), 0);
  return { total: rows.length, inUse, free: rows.length - inUse, highest, max: MAX_DEMO_WORKSPACES, canAdd: Math.max(0, MAX_DEMO_WORKSPACES - highest) };
}

// Adds `count` more workspaces after the highest one (nobody already in a workspace is touched). The seed creates only what is missing.
async function addWorkspaces(conn, count, { rounds = 12 } = {}) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) throw bad('Say how many workspaces to add (a whole number, at least 1).', 'count');
  const status = await poolStatus(conn);
  if (status.highest + n > MAX_DEMO_WORKSPACES) throw bad(`The pool can have at most ${MAX_DEMO_WORKSPACES} workspaces; there are ${status.highest}, so ${status.canAdd} more can be added.`, 'count');
  const { seedWorkspaces } = require('../scripts/seed-demo-workspaces');
  await inTransaction(conn, () => seedWorkspaces(conn, status.highest + n, { rounds }));
  invalidateCache();
  return poolStatus(conn);
}

// A label can be corrected at any time, even after the invitation has ended (it is only for staff).
async function renameInvitation(conn, id, label, { now = new Date() } = {}) {
  const name = cleanLabel(label);
  const row = await getRow(conn, id);
  if (!row) throw notFound();
  await conn.query('UPDATE public_demo_invitations SET label = ? WHERE id = ?', [name, id]);
  invalidateCache();
  return { previous: row.label, invitation: await getInvitation(conn, id, { now }) };
}

// Which group is behind a demo login? `identifier` is a sign-in address or student username. Returns null for anything that is not a demo workspace login;
// otherwise the workspace, the role, and the group now using it (or the last one that did), without any secret.
async function groupForLogin(conn, identifier, { now = new Date() } = {}) {
  const login = workspaceLoginOf(identifier);
  if (!login) return null;
  let rows;
  try { [rows] = await conn.query('SELECT * FROM public_demo_invitations WHERE workspace_id = ? ORDER BY (status = ?) DESC, id DESC LIMIT 1', [login.number, 'active']); }
  catch (err) { if (isMissing(err)) return { workspaceId: login.number, role: login.role, invitation: null }; throw err; }
  return { workspaceId: login.number, role: login.role, invitation: present(rows[0], { now }) };
}

// Takes a free workspace, wipes it, gives it a new password and PIN, and records the invitation. Returns it WITH its secrets (the one time they are
// shown to the person who made it; the Demo page shows them again on request).
async function createInvitation(conn, { label, days, until, createdBy = null, now = new Date(), rounds = 10 }) {
  const name = cleanLabel(label);
  if (await isPaused(conn)) throw conflict('Demos are paused, so no new invitation can start. Resume them first (node scripts/set-public-demo.js --resume).', 'paused');
  const end = resolveEnd({ days, until }, now, await maxDays(conn));
  await sweep(conn, { now, rounds }); // an invitation that ran out yesterday frees its workspace before we look for one

  const password = generatePassword(), pin = generatePin();
  const id = await inTransaction(conn, async () => {
    const workspaceId = await claimFreeWorkspace(conn);
    try {
      await resetWorkspace(conn, workspaceId, { rounds });
      await applySecrets(conn, workspaceId, { password, pin, rounds });
      const code = await uniqueCode(conn);
      const [r] = await conn.query(
        `INSERT INTO public_demo_invitations (label, workspace_id, access_code, code_version, password, pin, status, starts_at, ends_at, created_by)
         VALUES (?, ?, ?, 1, ?, ?, 'active', ?, ?, ?)`,
        [name, workspaceId, code, password, pin, toDb(now), toDb(end), createdBy ? String(createdBy).slice(0, 80) : null]);
      return r.insertId;
    } catch (err) {
      await conn.query("UPDATE public_demo_workspaces SET status = 'free' WHERE id = ?", [workspaceId]); // (a real transaction has already put it back)
      throw err;
    }
  });
  invalidateCache();
  return getInvitation(conn, id, { secrets: true, now });
}

async function requireActive(conn, id, now) {
  const row = await getRow(conn, id);
  if (!row) throw notFound();
  const inv = present(row, { now });
  if (!inv.open) throw conflict('That invitation has already ended.', 'ended');
  return row;
}

// Moves the end time (later or earlier, but still in the future and within the longest window counted from now). The group's session is untouched.
async function extendInvitation(conn, id, { days, until, now = new Date() }) {
  await requireActive(conn, id, now);
  if ((days === undefined || days === null || days === '') && (until === undefined || until === null || until === '')) throw bad('Say how many days to give it, or a date and time.', 'days');
  const end = resolveEnd({ days, until }, now, await maxDays(conn));
  await conn.query("UPDATE public_demo_invitations SET ends_at = ? WHERE id = ? AND status = 'active'", [toDb(end), id]);
  invalidateCache();
  return getInvitation(conn, id, { now });
}

// Ends it now (or, from the sweep, because its time ran out): the logins stop at once, then the workspace is wiped and goes back in the pool.
async function endInvitation(conn, id, { reason = 'ended', now = new Date(), rounds = 10 } = {}) {
  const row = await getRow(conn, id);
  if (!row) throw notFound();
  if (row.status === 'ended') return present(row, { now });
  const [r] = await conn.query("UPDATE public_demo_invitations SET status = 'ended', ended_at = ?, end_reason = ?, password = '', pin = '' WHERE id = ? AND status = 'active'", [toDb(now), reason, id]);
  invalidateCache(); // from here on the gate refuses every session of this workspace
  let pauseCleared = false;
  if (r.affectedRows === 1) {
    await wipeAndClose(conn, Number(row.workspace_id), { rounds });
    await conn.query("UPDATE public_demo_workspaces SET status = 'free' WHERE id = ?", [row.workspace_id]);
    pauseCleared = await resumeIfNothingOpen(conn, { now });
  }
  const out = await getInvitation(conn, id, { now });
  if (pauseCleared) out.pauseCleared = true; // the caller can say that demos are running again
  return out;
}

// "Pause all demos" holds the live demos closed. Once the last open invitation has ended there is nothing left for it to hold, so the pause is lifted (and
// the Resume button goes away) instead of lingering with nothing to resume. Returns true when it lifted one. Pausing while nothing is open stays paused until
// someone resumes, because that was asked for on purpose; this only runs when an invitation actually ends.
async function resumeIfNothingOpen(conn, { now = new Date() } = {}) {
  if (!(await isPaused(conn))) return false;
  const open = await listInvitations(conn, { includeEnded: false, now });
  if (open.some(i => i.open)) return false;
  await setPaused(conn, false);
  return true;
}

// A new access code for one group: everyone who entered the old one is shut out, nobody else is affected.
async function regenerateCode(conn, id, { now = new Date() } = {}) {
  await requireActive(conn, id, now);
  const code = await uniqueCode(conn);
  await conn.query("UPDATE public_demo_invitations SET access_code = ?, code_version = code_version + 1 WHERE id = ? AND status = 'active'", [code, id]);
  invalidateCache();
  return getInvitation(conn, id, { secrets: true, now });
}

// A new shared password or student PIN for one group: that group's sessions end, nobody else is affected.
async function regenerateSecret(conn, id, what, { now = new Date(), rounds = 10 } = {}) {
  if (what !== 'password' && what !== 'pin') throw bad('Choose password or pin.', 'what');
  const row = await requireActive(conn, id, now);
  const value = what === 'password' ? generatePassword() : generatePin();
  await applySecrets(conn, Number(row.workspace_id), what === 'password' ? { password: value, rounds } : { pin: value, rounds });
  await conn.query(`UPDATE public_demo_invitations SET ${what} = ? WHERE id = ?`, [value, id]);
  if (what === 'password') await conn.query('UPDATE site_users SET session_invalidated_at = NOW() WHERE demo_workspace_id = ?', [row.workspace_id]);
  invalidateCache();
  return getInvitation(conn, id, { secrets: true, now });
}

// Ends every invitation whose time has run out, and puts right any workspace that is marked in use but has no active invitation (a wipe that was
// interrupted). Safe to run at any time and as often as you like; run by cron every few minutes.
async function sweep(conn, { now = new Date(), rounds = 10 } = {}) {
  const ended = [], repaired = [];
  let pauseCleared = false;
  let rows;
  try { [rows] = await conn.query("SELECT id, ends_at FROM public_demo_invitations WHERE status = 'active'"); } catch (err) { if (isMissing(err)) return { ended, repaired }; throw err; }
  for (const r of rows) {
    const end = fromDb(r.ends_at);
    if (!end || end.getTime() <= now.getTime()) {
      const done = await endInvitation(conn, r.id, { reason: 'expired', now, rounds });
      ended.push(Number(r.id));
      if (done.pauseCleared) pauseCleared = true;
    }
  }
  const [stuck] = await conn.query("SELECT id FROM public_demo_workspaces WHERE status = 'in_use' AND id NOT IN (SELECT workspace_id FROM public_demo_invitations WHERE status = 'active')");
  for (const w of stuck) {
    await wipeAndClose(conn, Number(w.id), { rounds });
    await conn.query("UPDATE public_demo_workspaces SET status = 'free' WHERE id = ?", [w.id]);
    repaired.push(Number(w.id));
  }
  if (ended.length || repaired.length) invalidateCache();
  return pauseCleared ? { ended, repaired, pauseCleared } : { ended, repaired }; // pauseCleared: demos were paused and the last open one ran out
}

// ---- What the server asks on every demo request ----------------------------------------------------------------------------------------------

// Kept for a few seconds so a busy demo does not ask the database on every click. A change made in this process clears it at once; a change made by the
// command-line tool is seen within TTL (a few seconds), which is the promise in R1.
const cache = new Map();
let ttlMs = 5000;
function invalidateCache() { cache.clear(); }
function setCacheTtl(ms) { ttlMs = ms; invalidateCache(); }

async function remembered(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  let value;
  try { value = await load(require('../db/pool')); } catch (err) { if (!isMissing(err)) console.error('public demo invitation lookup failed (treated as closed):', err.message); value = undefined; }
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function pausedNow() {
  const v = await remembered('paused', (pool) => A.getSettingRaw(pool, 'public_demo_paused'));
  // a setting that cannot be read means "closed" (the lookup above returns undefined only on failure)
  return v === undefined ? true : String(v).trim().toLowerCase() === 'true';
}

function openRow(row, now) {
  if (!row || row.status !== 'active') return null;
  const end = fromDb(row.ends_at);
  return end && end.getTime() > now.getTime() ? row : null;
}

// The open invitation that holds a workspace, or null.
async function getOpenInvitationForWorkspace(workspaceId, now = new Date()) {
  const n = Number(workspaceId);
  if (!Number.isInteger(n)) return null;
  if (await pausedNow()) return null;
  const row = await remembered(`ws:${n}`, async (pool) => (await pool.query("SELECT * FROM public_demo_invitations WHERE workspace_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [n]))[0][0] || null);
  return openRow(row, now);
}

async function getOpenInvitationById(id, now = new Date()) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  if (await pausedNow()) return null;
  const row = await remembered(`id:${n}`, async (pool) => (await pool.query('SELECT * FROM public_demo_invitations WHERE id = ?', [n]))[0][0] || null);
  return openRow(row, now);
}

// The open invitation with this access code (any spelling: case, spaces and hyphens are ignored), or null. Not cached: a wrong guess should cost one
// indexed lookup, and a new code must work at once.
async function findOpenInvitationByCode(code, now = new Date()) {
  const normalized = A.normalizeAccessCode(code);
  if (normalized.length < 4 || normalized.length > 20) return null;
  if (await pausedNow()) return null;
  try {
    const [rows] = await require('../db/pool').query("SELECT * FROM public_demo_invitations WHERE access_code = ? AND status = 'active'", [normalized]);
    return openRow(rows[0], now);
  } catch (err) {
    if (!isMissing(err)) console.error('public demo invitation lookup failed (treated as closed):', err.message);
    return null;
  }
}

// Is any invitation open? (The demo page uses it to choose between the code box and the "page not found" look.)
async function anyOpenInvitation(now = new Date()) {
  if (await pausedNow()) return false;
  const rows = await remembered('open-rows', async (pool) => (await pool.query("SELECT ends_at FROM public_demo_invitations WHERE status = 'active'"))[0]);
  return Array.isArray(rows) && rows.some(r => { const e = fromDb(r.ends_at); return e && e.getTime() > now.getTime(); });
}

module.exports = {
  DEFAULT_DAYS, DEFAULT_MAX_DAYS, toDb, fromDb, present, loginsFor,
  isPaused, setPaused, resumeIfNothingOpen, maxDays, resolveEnd, cleanLabel,
  getInvitation, listInvitations, poolStatus, addWorkspaces, renameInvitation, groupForLogin, createInvitation, extendInvitation, endInvitation, regenerateCode, regenerateSecret, sweep,
  applySecrets, resetWorkspace, wipeAndClose,
  getOpenInvitationForWorkspace, getOpenInvitationById, findOpenInvitationByCode, anyOpenInvitation, invalidateCache, setCacheTtl,
};

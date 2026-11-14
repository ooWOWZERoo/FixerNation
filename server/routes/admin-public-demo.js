// Admin API for the prospect demo (docs/reference/shared-demo-workspaces-requirements.md, section 5): INVITATIONS under /invitations (one per group, each
// with its own private workspace, access code, password, PIN and end time), the master pause, and the pool of workspaces. Every route here is the FNE admin's
// (requireAuth, never a site-user session). The original single shared demo (on/off switch, one code, one password) was retired in phase 5.
//
// The routes call lib/public-demo-invitations.js, which the command-line tool (scripts/demo-invitations.js) uses too, so both do exactly the same thing.
// This file only calls it and records who did what. Secrets (the password, PIN and code) are shown to the admin and never written to the audit log.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const F = require('../lib/public-demo-fixtures');
const A = require('../lib/public-demo-admin');
const seedLib = require('../scripts/seed-public-demo');
const { resetDemo } = require('../scripts/reset-public-demo');
const { siteLoginBlockedFor, unlockSiteLogin } = require('./site-auth');
const { lockStatus, clearLock } = require('../lib/pin-lockout');
const inv = require('../lib/public-demo-invitations');
const { workspaceFixtures } = require('../lib/public-demo-workspaces');
const { workspaceTag } = require('../lib/sales-demo');

const router = express.Router();
router.use(requireAuth); // one gate for the whole file: a test fails if this line goes

const LOGIN_LABELS = { district: 'District administrator', school: 'School administrator', teacher: 'Teacher', parent: 'Parent' };
const ROLE_LABELS = { ...LOGIN_LABELS, student: 'Student' };
const ENDED_LIST_DAYS = 90; // an ended invitation stays on the page this long, with its final details

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

const fail = (res, status, error) => res.status(status).json({ error });

// ==========================================================================================================================================
// Invitations: one per group, each with its own private workspace (docs/reference/shared-demo-workspaces-requirements.md, sections 3 and 5)
// ==========================================================================================================================================

// A real connection for work that takes several statements (a pooled connection is released afterwards).
async function withConn(fn) {
  const conn = await pool.getConnection();
  try { return await fn(conn); } finally { conn.release(); }
}

// Mistakes the person asking can fix (a missing name, a bad date, no free workspace) carry a status and are shown as they are.
const handle = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err.status) return fail(res, err.status, err.message);
    throw err;
  }
};

const invId = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : 0; };

const NO_COUNTS = { gateEntries: 0, signIns: { district: 0, school: 0, teacher: 0, parent: 0, student: 0 }, signInTotal: 0, tickets: 0, quotes: 0 };

// One invitation as the list shows it (no password, PIN or code), with its own counts: access-code entries, sign-ins, questions and tickets, quote requests.
const rowFor = (i, counts) => ({
  counts: counts || NO_COUNTS,
  id: i.id, label: i.label, workspaceId: i.workspaceId, workspace: workspaceTag(i.workspaceId), state: i.state, open: i.open,
  startsAt: i.startsAt ? i.startsAt.toISOString() : null, endsAt: i.endsAt ? i.endsAt.toISOString() : null, endsAtEastern: i.endsAtEastern,
  endedAt: i.endedAt ? i.endedAt.toISOString() : null, endReason: i.endReason, createdBy: i.createdBy,
});

async function invitationsState() {
  const [paused, poolInfo, maxDays, list, counts] = await Promise.all([
    inv.isPaused(pool), inv.poolStatus(pool), inv.maxDays(pool), inv.listInvitations(pool, { endedWithinDays: ENDED_LIST_DAYS }), A.invitationCounts(pool),
  ]);
  return {
    paused, pool: poolInfo, maxDays, defaultDays: inv.DEFAULT_DAYS,
    pageUrl: `${(process.env.SITE_URL || '').replace(/\/$/, '')}${F.PUBLIC_DEMO_PAGE_PATH}`,
    invitations: list.map(i => rowFor(i, counts[i.id])),
  };
}

// One invitation WITH what staff need to send and support it: its code, password and PIN (while it is open), the five sign-ins and whether each is
// locked, the join code of its classroom, and the message to send. Never written to the audit log.
async function invitationDetails(id) {
  const i = await inv.getInvitation(pool, id, { secrets: true });
  if (!i) return null;
  const logins = inv.loginsFor(i.workspaceId).map(l => ({
    role: ROLE_LABELS[l.role], userId: l.userId, signIn: l.page,
    lockedSeconds: l.role === 'student' ? lockStatus(l.userId).seconds : siteLoginBlockedFor(l.userId),
  }));
  const [[room]] = await pool.query(
    'SELECT c.join_code FROM classrooms c JOIN site_users u ON u.id = c.teacher_site_user_id WHERE u.email = ? AND c.name = ? ORDER BY c.id LIMIT 1',
    [workspaceFixtures(i.workspaceId).accounts.teacher.email, F.DEMO_CLASSROOM_NAME]);
  const counts = (await A.invitationCounts(pool))[i.id];
  const out = { ...rowFor(i, counts), logins, lockedCount: logins.filter(l => l.lockedSeconds > 0).length, joinCode: room ? room.join_code : '' };
  if (i.open) {
    out.accessCode = i.accessCodeFormatted;
    out.password = i.password;
    out.pin = i.pin;
    out.message = A.buildInviteMessage({ siteUrl: process.env.SITE_URL, code: i.accessCode, endsAt: i.endsAt, privateCopy: true });
  }
  return out;
}

const invAudit = (i) => ({ id: i.id, label: i.label, workspace: workspaceTag(i.workspaceId), endsAt: i.endsAt ? i.endsAt.toISOString() : null });

const timeBody = (body) => {
  if (body.days !== undefined && typeof body.days !== 'number') throw Object.assign(new Error('The number of days must be a number.'), { status: 400 });
  if (body.until !== undefined && typeof body.until !== 'string') throw Object.assign(new Error('The end time must be text.'), { status: 400 });
  return { days: body.days, until: body.until };
};

router.get('/invitations', handle(async (req, res) => { res.json(await invitationsState()); }));

router.get('/invitations/:id', handle(async (req, res) => {
  const d = invId(req) ? await invitationDetails(invId(req)) : null;
  if (!d) return fail(res, 404, 'That invitation was not found.');
  res.json(d);
}));

// Start an invitation: takes a free workspace, wipes it, and gives it a new code, password and PIN (shown in the answer, never in the audit log).
router.post('/invitations', handle(async (req, res) => {
  const body = req.body || {};
  if (typeof body.label !== 'string') return fail(res, 400, "Give the group a name (for example the district's name), so you can tell the invitations apart.");
  const created = await withConn((conn) => inv.createInvitation(conn, { label: body.label, ...timeBody(body), createdBy: req.user.username }));
  await logAction(req, 'invitation_created', null, invAudit(created));
  res.json(await invitationDetails(created.id));
}));

router.post('/invitations/:id/rename', handle(async (req, res) => {
  const body = req.body || {};
  if (typeof body.label !== 'string') return fail(res, 400, "Give the group a name.");
  const r = await inv.renameInvitation(pool, invId(req), body.label);
  await logAction(req, 'invitation_renamed', { label: r.previous }, { id: r.invitation.id, label: r.invitation.label });
  res.json(await invitationDetails(invId(req)));
}));

router.post('/invitations/:id/extend', handle(async (req, res) => {
  const t = timeBody(req.body || {});
  if (t.days === undefined && t.until === undefined) return fail(res, 400, 'Say how many days to give it, or a date and time.');
  const before = await inv.getInvitation(pool, invId(req));
  const after = await inv.extendInvitation(pool, invId(req), t);
  await logAction(req, 'invitation_extended', { id: after.id, endsAt: before && before.endsAt ? before.endsAt.toISOString() : null }, invAudit(after));
  res.json(await invitationDetails(invId(req)));
}));

// End it now: its logins stop at once, and the workspace is wiped and goes back in the pool.
router.post('/invitations/:id/end', handle(async (req, res) => {
  const ended = await withConn((conn) => inv.endInvitation(conn, invId(req), { reason: 'ended' }));
  await logAction(req, 'invitation_ended', null, { id: ended.id, label: ended.label, workspace: workspaceTag(ended.workspaceId) });
  // If demos were paused and this was the last open invitation, the pause was lifted (nothing left to hold); say so, and record it.
  if (ended.pauseCleared) await logAction(req, 'resumed', { paused: true }, { paused: false, automatic: 'the last open invitation ended' });
  res.json({ ...(await invitationDetails(invId(req))), pauseCleared: !!ended.pauseCleared });
}));

// A new access code for this group only: everyone who entered the old one is shut out.
router.post('/invitations/:id/new-code', handle(async (req, res) => {
  const r = await inv.regenerateCode(pool, invId(req));
  await logAction(req, 'invitation_code_regenerated', null, { id: r.id, label: r.label });
  res.json(await invitationDetails(invId(req)));
}));

// A new shared password or student PIN for this group only (this group is signed out).
router.post('/invitations/:id/new-secret', handle(async (req, res) => {
  const what = (req.body || {}).what;
  if (what !== 'password' && what !== 'pin') return fail(res, 400, 'Choose password or pin.');
  const r = await withConn((conn) => inv.regenerateSecret(conn, invId(req), what));
  await logAction(req, 'invitation_secret_regenerated', null, { id: r.id, label: r.label, changed: what });
  res.json(await invitationDetails(invId(req)));
}));

// Clear the sign-in lockouts on this group's five logins (wrong guesses lock a shared login for 15 minutes).
router.post('/invitations/:id/unlock', handle(async (req, res) => {
  const i = await inv.getInvitation(pool, invId(req));
  if (!i) return fail(res, 404, 'That invitation was not found.');
  for (const l of inv.loginsFor(i.workspaceId)) { if (l.role === 'student') clearLock(l.userId); else unlockSiteLogin(l.userId); }
  await logAction(req, 'invitation_unlocked', null, { id: i.id, label: i.label });
  res.json(await invitationDetails(invId(req)));
}));

// Clear what the group has added to its copy (classrooms, students, work, invitations, branding), keeping its codes, password and PIN.
router.post('/invitations/:id/reset', handle(async (req, res) => {
  const i = await inv.getInvitation(pool, invId(req));
  if (!i) return fail(res, 404, 'That invitation was not found.');
  if (!i.open) return fail(res, 409, 'That invitation has ended, and its copy was already cleared.');
  await inTransaction((conn) => resetDemo(conn, { fx: workspaceFixtures(i.workspaceId) }, seedLib.makeReport()));
  await logAction(req, 'invitation_workspace_reset', null, { id: i.id, label: i.label, workspace: workspaceTag(i.workspaceId) });
  res.json(await invitationDetails(invId(req)));
}));

// Pause or resume every demo at once (the master switch). Paused: no invitation works and no new one can start; nothing is lost.
router.post('/pause', handle(async (req, res) => {
  const paused = (req.body || {}).paused;
  if (typeof paused !== 'boolean') return fail(res, 400, 'Say whether to pause or resume.');
  const before = await inv.isPaused(pool);
  await inv.setPaused(pool, paused);
  await logAction(req, paused ? 'paused' : 'resumed', { paused: before }, { paused });
  res.json(await invitationsState());
}));

// Add private workspaces to the pool (up to the cap). Nobody already in a workspace is touched.
router.post('/workspaces', handle(async (req, res) => {
  const count = (req.body || {}).count;
  if (typeof count !== 'number') return fail(res, 400, 'Say how many workspaces to add.');
  const before = await inv.poolStatus(pool);
  const after = await withConn((conn) => inv.addWorkspaces(conn, count));
  await logAction(req, 'workspaces_added', { total: before.total }, { total: after.total, added: after.total - before.total });
  res.json(await invitationsState());
}));

module.exports = router;

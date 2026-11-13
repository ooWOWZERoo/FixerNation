// The shared demo's public side (docs/reference/shared-demo-environment-requirements.md, R2 and R3): the unlisted page demo-welcome.html asks these
// three routes what to show. Nothing here needs a sign-in, and nothing here gives anything away until the access code has been entered.
//
//   GET  /api/demo/state        { open: false } while the demo is closed, so the page can look like a page that does not exist. While it is open:
//                               when it ends, and whether this browser has already entered the code.
//   POST /api/demo/enter        { code } -> sets the gate cookie. Wrong code and "demo is closed" get the same answer. Throttled per address and overall.
//   GET  /api/demo/credentials  the logins, shared password and PIN: only with a valid gate cookie while the demo is open.
//
// The gate cookie is signed by lib/session-tokens.js with its own audience (kind 'demoGate'), carries the access code's version (a new code ends every
// visit at once), and lasts 8 hours or until the demo ends, whichever comes first. It is not a sign-in.
//
// There are two kinds of visit. A group's own INVITATION (docs/reference/shared-demo-workspaces-requirements.md) has its own access code, end time and private
// workspace: its cookie carries the invitation's id and code version, and /credentials returns that workspace's logins only. The ORIGINAL single demo (one
// global code and switch) works exactly as before until the invitations replace it. A wrong code, an ended invitation and a paused demo all get the same answer.
const express = require('express');
const crypto = require('crypto');
const { getPublicDemoStatus, getDemoGate } = require('../lib/public-demo');
const invitations = require('../lib/public-demo-invitations');
const { workspaceLogins } = require('../lib/public-demo-workspaces');
const { signSession } = require('../lib/session-tokens');
const { DEMO_GATE_COOKIE_NAME, DEMO_GATE_MAX_AGE_MS } = require('../lib/session');
const { FailureTracker, rejectIfBlocked, clientIp } = require('../lib/rate-limit');
const { formatEastern } = require('../lib/public-demo-window');
const F = require('../lib/public-demo-fixtures');
const A = require('../lib/public-demo-admin');
const pool = require('../db/pool');

const router = express.Router();

// Eight characters from a 32-letter alphabet is about a trillion codes, so these limits make guessing pointless: ten wrong tries per address per
// 15 minutes, and 300 wrong tries from anywhere per hour. Only wrong tries count; a right code never uses any up.
const wrongByIp = new FailureTracker({ name: 'demo-gate-ip', windowMs: 15 * 60 * 1000, max: 10 });
const wrongOverall = new FailureTracker({ name: 'demo-gate-all', windowMs: 60 * 60 * 1000, max: 300 });

const BLURBS = {
  district: 'Every school in the district, how they are using Fixer Nation, and the district\'s Portrait of a Graduate.',
  school: 'Teachers, invitations, reports and your school\'s branding.',
  teacher: 'Classrooms, lessons, assignments, student progress and reflections.',
  parent: 'A child\'s progress, and how each lesson connects to SEL standards.',
  student: 'A student\'s own view: assigned lessons, quizzes, reflections and games.',
};
const LABELS = { district: 'District administrator', school: 'School administrator', teacher: 'Teacher', parent: 'Parent', student: 'Student' };

// Constant-time comparison of the codes (both hashed first so their lengths do not matter).
function codesMatch(given, real) {
  const a = crypto.createHash('sha256').update(A.normalizeAccessCode(given)).digest();
  const b = crypto.createHash('sha256').update(A.normalizeAccessCode(real)).digest();
  return crypto.timingSafeEqual(a, b) && A.normalizeAccessCode(real).length > 0;
}

router.get('/state', async (req, res) => {
  const gate = await getDemoGate(req);
  if (gate && gate.invitation) {
    const end = invitations.fromDb(gate.invitation.ends_at);
    return res.json({ open: true, endsAt: end.toISOString(), endsAtEastern: formatEastern(end), unlocked: true });
  }
  const status = await getPublicDemoStatus();
  if (status.open) return res.json({ open: true, endsAt: status.endsAt.toISOString(), endsAtEastern: formatEastern(status.endsAt), unlocked: !!(gate && gate.legacy) });
  // No original demo: the code box shows while any invitation is open (no end time is given before a code is entered), otherwise the page looks like a page that does not exist.
  if (await invitations.anyOpenInvitation()) return res.json({ open: true, unlocked: false });
  res.json({ open: false });
});

router.post('/enter', async (req, res) => {
  const ip = clientIp(req);
  if (rejectIfBlocked(res, [[wrongByIp, ip], [wrongOverall, 'all']])) return;

  const code = req.body && req.body.code;
  const tidy = typeof code === 'string' && code.length <= 40;
  const wrong = () => {
    wrongByIp.fail(ip);
    wrongOverall.fail('all');
    return res.status(401).json({ error: "That code didn't work. Check it and try again." });
  };
  if (!tidy) return wrong();

  // A group's own access code first; otherwise the original demo's code (while that demo is open).
  const invitation = await invitations.findOpenInvitationByCode(code);
  if (invitation) {
    const msToEnd = invitations.fromDb(invitation.ends_at).getTime() - Date.now();
    const maxAge = Math.max(1000, Math.min(DEMO_GATE_MAX_AGE_MS, msToEnd));
    const token = signSession('demoGate', { inv: Number(invitation.id), v: String(invitation.code_version) }, Math.floor(maxAge / 1000));
    res.cookie(DEMO_GATE_COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge });
    return res.json({ ok: true }); // (gate entries are counted per invitation in a later phase)
  }

  const status = await getPublicDemoStatus();
  const real = status.open ? await A.getSettingRaw(pool, 'public_demo_access_code') : '';
  if (!(status.open && codesMatch(code, real))) return wrong();

  const version = await A.getSettingRaw(pool, 'public_demo_code_version');
  const msToEnd = status.endsAt.getTime() - Date.now();
  const maxAge = Math.max(1000, Math.min(DEMO_GATE_MAX_AGE_MS, msToEnd));
  const token = signSession('demoGate', { v: String(version) }, Math.floor(maxAge / 1000));
  res.cookie(DEMO_GATE_COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge });
  await A.recordDemoEvent('gate_entry');
  res.json({ ok: true });
});

router.get('/credentials', async (req, res) => {
  const gate = await getDemoGate(req);
  if (!gate) return res.status(401).json({ error: 'Enter the access code first.' });

  if (gate.invitation) {
    // This group's own workspace, and nothing of any other: the logins, password and PIN come from the invitation the cookie names.
    const inv = gate.invitation;
    const end = invitations.fromDb(inv.ends_at);
    const logins = workspaceLogins(Number(inv.workspace_id)).map(l => ({
      key: l.role, role: LABELS[l.role], what: BLURBS[l.role], userId: l.userId, signIn: l.page, secretKind: l.role === 'student' ? 'pin' : 'password',
    }));
    return res.json({ endsAt: end.toISOString(), endsAtEastern: formatEastern(end), password: inv.password, pin: inv.pin, logins, privateCopy: true }); // privateCopy: the page says this demo is theirs alone
  }

  const status = await getPublicDemoStatus();
  if (!status.open) return res.status(401).json({ error: 'Enter the access code first.' });
  const password = await A.getSettingRaw(pool, 'public_demo_password');
  const pin = await A.getSettingRaw(pool, 'public_demo_pin');
  const logins = Object.keys(F.ACCOUNTS).map(key => ({
    key, role: LABELS[key], what: BLURBS[key], userId: F.ACCOUNTS[key].email, signIn: F.LOGIN_PAGES[key], secretKind: 'password',
  }));
  logins.push({ key: 'student', role: LABELS.student, what: BLURBS.student, userId: F.STUDENTS[0].username, signIn: F.LOGIN_PAGES.student, secretKind: 'pin' });
  res.json({ endsAt: status.endsAt.toISOString(), endsAtEastern: formatEastern(status.endsAt), password, pin, logins });
});

module.exports = router;

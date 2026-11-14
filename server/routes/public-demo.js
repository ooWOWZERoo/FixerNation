// The prospect demo's public side (docs/reference/shared-demo-workspaces-requirements.md): the unlisted page demo-welcome.html asks these three routes what to
// show. Nothing here needs a sign-in, and nothing here gives anything away until an access code has been entered.
//
//   GET  /api/demo/state        { open: false } while no invitation is open, so the page can look like a page that does not exist. While one is open:
//                               the code box; once this browser has entered a code, when that group's demo ends.
//   POST /api/demo/enter        { code } -> sets the gate cookie. A wrong code, an ended invitation and a paused demo all get the same answer. Throttled per
//                               address and overall.
//   GET  /api/demo/credentials  that group's logins, password and PIN: only with a valid gate cookie for an open invitation.
//
// The gate cookie is signed by lib/session-tokens.js with its own audience (kind 'demoGate'), carries the invitation's id and code version (a new code ends
// that group's visits), and lasts 8 hours or until the invitation ends, whichever comes first. It is not a sign-in. The original single shared demo (one
// global code and switch) was retired in phase 5: its codes and cookies no longer work.
const express = require('express');
const { getDemoGate } = require('../lib/public-demo');
const invitations = require('../lib/public-demo-invitations');
const { workspaceLogins } = require('../lib/public-demo-workspaces');
const { signSession } = require('../lib/session-tokens');
const { DEMO_GATE_COOKIE_NAME, DEMO_GATE_MAX_AGE_MS } = require('../lib/session');
const { FailureTracker, rejectIfBlocked, clientIp } = require('../lib/rate-limit');
const { formatEastern } = require('../lib/public-demo-window');
const A = require('../lib/public-demo-admin');

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

router.get('/state', async (req, res) => {
  const gate = await getDemoGate(req);
  if (gate && gate.invitation) {
    const end = invitations.fromDb(gate.invitation.ends_at);
    return res.json({ open: true, endsAt: end.toISOString(), endsAtEastern: formatEastern(end), unlocked: true });
  }
  // The code box shows while any invitation is open (no end time is given before a code is entered), otherwise the page looks like a page that does not exist.
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

  const invitation = await invitations.findOpenInvitationByCode(code);
  if (!invitation) return wrong();
  const msToEnd = invitations.fromDb(invitation.ends_at).getTime() - Date.now();
  const maxAge = Math.max(1000, Math.min(DEMO_GATE_MAX_AGE_MS, msToEnd));
  const token = signSession('demoGate', { inv: Number(invitation.id), v: String(invitation.code_version) }, Math.floor(maxAge / 1000));
  res.cookie(DEMO_GATE_COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge });
  await A.recordDemoEvent('gate_entry', null, invitation.id); // counted for this group only (never blocks)
  res.json({ ok: true });
});

router.get('/credentials', async (req, res) => {
  const gate = await getDemoGate(req);
  if (!gate || !gate.invitation) return res.status(401).json({ error: 'Enter the access code first.' });

  // This group's own workspace, and nothing of any other: the logins, password and PIN come from the invitation the cookie names.
  const inv = gate.invitation;
  const end = invitations.fromDb(inv.ends_at);
  const logins = workspaceLogins(Number(inv.workspace_id)).map(l => ({
    key: l.role, role: LABELS[l.role], what: BLURBS[l.role], userId: l.userId, signIn: l.page, secretKind: l.role === 'student' ? 'pin' : 'password',
  }));
  res.json({ endsAt: end.toISOString(), endsAtEastern: formatEastern(end), password: inv.password, pin: inv.pin, logins, privateCopy: true }); // privateCopy: the page says this demo is theirs alone
});

module.exports = router;

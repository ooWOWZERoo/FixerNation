// Error reports from the browser (Release 122). Write-only and public: anyone's browser may report, nobody can read here.
// Staff read them in routes/admin-client-errors.js. Requirements and access matrix: docs/reference/error-capture-requirements.md.
//
//   POST /api/client-errors   body: { kind, page, api, method, status, message, source, sessionId }
//
// Only the three browser kinds are accepted (a browser can never write a server_error or email_failed). Who the person is comes from
// the session cookies on the request, never from the body, and a student is recorded with no id at all.
const express = require('express');
const { limiter } = require('../lib/rate-limit');
const { getAuthUser } = require('../middleware/auth');
const { getSiteUser } = require('../lib/site-user');
const { verifySession } = require('../lib/session-tokens');
const { STUDENT_COOKIE_NAME } = require('../lib/session');
const { BROWSER_KINDS, recordError } = require('../lib/client-errors');

const router = express.Router();
const MAX_BODY_CHARS = 4096;

// Who is reporting, from cookies only: { userKind, siteUserId }. A student never gets an id.
async function whoIsReporting(req) {
  if (getAuthUser(req)) return { userKind: 'admin', siteUserId: null };
  const user = await getSiteUser(req);
  if (user) return { userKind: 'signed_in', siteUserId: user.id };
  const token = req.cookies && req.cookies[STUDENT_COOKIE_NAME];
  if (token) {
    try { verifySession('student', token); return { userKind: 'student', siteUserId: null }; } catch { /* an invalid student cookie is just a visitor */ }
  }
  return { userKind: 'visitor', siteUserId: null };
}

router.post('/', limiter({ name: 'client-errors', windowMs: 10 * 60 * 1000, max: 60 }), async (req, res) => {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b) || JSON.stringify(b).length > MAX_BODY_CHARS) return res.status(400).json({ error: 'Invalid report' });
  if (typeof b.kind !== 'string' || !BROWSER_KINDS.includes(b.kind)) return res.status(400).json({ error: 'Invalid report' });
  const who = await whoIsReporting(req);
  await recordError({
    kind: b.kind, pagePath: b.page, apiPath: b.api, method: b.method,
    status: typeof b.status === 'number' ? b.status : 0,
    message: b.message, source: b.source, sessionId: b.sessionId,
    userAgent: req.headers['user-agent'],
    userKind: who.userKind, siteUserId: who.siteUserId,
  });
  res.json({ ok: true }); // the same answer whether it was saved or not: the browser does nothing with it
});

module.exports = router;

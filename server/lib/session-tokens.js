const jwt = require('jsonwebtoken');

// All three session types (admin, site-user, PIN student) are signed with the
// same SESSION_SECRET. Without a per-type audience claim, a validly signed
// token from one type is also a validly signed token for the others -- e.g. a
// free site-user's fn_user_session value pasted into an fn_session cookie
// would satisfy requireAuth. Every sign and verify call goes through here so a
// token minted for one session type can never satisfy another's verifier.
const AUD = {
  admin: 'fn:admin',
  site: 'fn:site-user',
  student: 'fn:student',
  // Not a login session: a 1-hour token carried in the "confirm your Microsoft
  // sign-in" email. Its own audience means it can never be used as a session.
  msLink: 'fn:ms-link',
};
const ISSUER = 'fixernation';

function signSession(kind, payload, expiresIn) {
  if (!AUD[kind]) throw new Error(`signSession: unknown session kind "${kind}"`);
  return jwt.sign(payload, process.env.SESSION_SECRET, {
    algorithm: 'HS256',
    audience: AUD[kind],
    issuer: ISSUER,
    expiresIn,
  });
}

// Throws on any invalid, expired, wrong-audience, or wrong-algorithm token --
// callers keep their existing try/catch.
function verifySession(kind, token) {
  if (!AUD[kind]) throw new Error(`verifySession: unknown session kind "${kind}"`);
  return jwt.verify(token, process.env.SESSION_SECRET, {
    algorithms: ['HS256'],
    audience: AUD[kind],
    issuer: ISSUER,
  });
}

module.exports = { signSession, verifySession };

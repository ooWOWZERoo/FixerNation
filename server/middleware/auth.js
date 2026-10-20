const pool = require('../db/pool');
const { COOKIE_NAME } = require('../lib/session');
const { verifySession } = require('../lib/session-tokens');

// Returns the decoded admin session payload, or null if there is no valid
// admin session. Signature/audience check only -- no DB lookup, so it stays
// synchronous and safe for optional/best-effort "is this an admin?" peeks
// (e.g. curriculum file viewing). Anything that actually gates an admin
// action must use requireAuth below, which also confirms the admin still
// exists. Only tokens minted for the admin audience verify here, so a
// site-user or student token pasted into the fn_session cookie is rejected.
function getAuthUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = verifySession('admin', token);
    return payload && payload.userId ? payload : null;
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // A signed token alone isn't enough: a deleted (or never-activated) admin
  // must lose access immediately rather than keeping it until the JWT expires.
  let row;
  try {
    [[row]] = await pool.query(
      'SELECT id, session_invalidated_at FROM admin_users WHERE id = ? AND email_verified = 1',
      [user.userId]
    );
  } catch (err) {
    // Deploy-order safety: if this code is live before
    // scripts/alter-add-admin-session-invalidated.js has run, don't lock every
    // admin out -- fall back to the existence check alone until the column exists.
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    [[row]] = await pool.query(
      'SELECT id FROM admin_users WHERE id = ? AND email_verified = 1',
      [user.userId]
    );
  }
  if (!row) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Password changes/resets stamp session_invalidated_at; any token issued
  // before that moment is dead (same scheme site_users already use).
  if (row.session_invalidated_at && user.iat * 1000 < new Date(row.session_invalidated_at).getTime()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth, getAuthUser };

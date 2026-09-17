const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('./session');

// Resolves the site-user for a request, or null — includes the
// session-revocation check (session_invalidated_at) a plain JWT verify
// alone would miss. Extracted from routes/site-auth.js's requireSiteAuth
// so its logic has exactly one source of truth, shared by that middleware
// AND any dual-identity route (e.g. learning-events.js) that needs to try
// "site-user, else something else" rather than hard-401 on no site-user.
async function getSiteUser(req) {
  const token = req.cookies?.[SITE_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [payload.userId]);
    if (!rows[0]) return null;
    if (rows[0].session_invalidated_at) {
      const invalidatedMs = new Date(rows[0].session_invalidated_at).getTime();
      if (payload.iat * 1000 < invalidatedMs) return null;
    }
    return rows[0];
  } catch { return null; }
}

module.exports = { getSiteUser };

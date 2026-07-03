const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('./session');

// Resolves the requesting site_user from their session cookie, if any —
// never fails the request, callers decide what to do with a null result.
async function getSiteUser(req) {
  const token = req.cookies && req.cookies[SITE_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query('SELECT id, first_name, email FROM site_users WHERE id = ?', [payload.userId]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// True if this site_user has claimed at least one license seat (single or
// group) — the seat's registered_site_user_id is set at signup time, so
// this is a direct lookup with no email-matching involved.
async function hasActiveLicense(siteUserId) {
  if (!siteUserId) return false;
  const [rows] = await pool.query(
    "SELECT 1 FROM license_seats WHERE registered_site_user_id = ? AND status = 'registered' LIMIT 1",
    [siteUserId]
  );
  return rows.length > 0;
}

module.exports = { getSiteUser, hasActiveLicense };

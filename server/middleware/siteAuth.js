const jwt = require('jsonwebtoken');
const { SITE_COOKIE_NAME } = require('../lib/session');

// Returns the decoded site-user session payload, or null. Does not send a
// response — safe for best-effort checks like rendering a first name.
function getSiteAuthUser(req) {
  const token = req.cookies[SITE_COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return null;
  }
}

function requireSiteAuth(req, res, next) {
  const user = getSiteAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.siteUser = user;
  next();
}

module.exports = { requireSiteAuth, getSiteAuthUser };

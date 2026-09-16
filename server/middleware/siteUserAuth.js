const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('../lib/session');

// For NEW Tune Your Brain routes only — every existing route file
// (brain-games.js, site-auth.js, social.js, parent-invite.js,
// school-invite.js) re-implements this same check inline and is
// deliberately left untouched (see
// docs/tune-your-brain/LEADERSHIP_DECISIONS_REQUIRED.md D2: a prior
// `server/middleware/siteAuth.js` "requireSiteAuth" was removed as unused
// dead code, so this is a fresh, narrowly-scoped start, not a resurrection
// of that file).
async function getSiteUser(req) {
  const token = req.cookies?.[SITE_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [[user]] = await pool.query(
      'SELECT id, email, first_name, last_name, role FROM site_users WHERE id = ?', [payload.userId]
    );
    return user || null;
  } catch { return null; }
}

async function requireSiteUser(req, res, next) {
  const user = await getSiteUser(req);
  if (!user) return res.status(401).json({ error: 'Login required' });
  req.siteUser = user;
  next();
}

module.exports = { requireSiteUser, getSiteUser };

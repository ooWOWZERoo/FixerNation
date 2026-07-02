const jwt = require('jsonwebtoken');
const { COOKIE_NAME } = require('../routes/auth');

// Returns the decoded session payload, or null if there is no valid session.
// Does not send a response — safe to use for optional/best-effort auth checks.
function getAuthUser(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth, getAuthUser };

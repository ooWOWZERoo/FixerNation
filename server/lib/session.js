module.exports = {
  // Admin (single account) session cookie.
  COOKIE_NAME: 'fn_session',
  COOKIE_MAX_AGE_MS: 24 * 60 * 60 * 1000,

  // Public site-user (customer account) session cookie — deliberately a
  // different name so the two auth systems can never be confused with
  // each other or accidentally satisfy one another's middleware.
  SITE_COOKIE_NAME: 'fn_user_session',
  SITE_COOKIE_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,
};

module.exports = {
  // Admin (single account) session cookie.
  COOKIE_NAME: 'fn_session',
  COOKIE_MAX_AGE_MS: 24 * 60 * 60 * 1000,

  // Public site-user (customer account) session cookie — deliberately a
  // different name so the two auth systems can never be confused with
  // each other or accidentally satisfy one another's middleware.
  SITE_COOKIE_NAME: 'fn_user_session',
  SITE_COOKIE_MAX_AGE_MS: 30 * 24 * 60 * 60 * 1000,

  // Classroom student session cookie — separate from teacher auth; students
  // have no email and use PIN-based login, not password + email.
  STUDENT_COOKIE_NAME: 'fn_student_session',
  STUDENT_COOKIE_MAX_AGE_MS: 8 * 60 * 60 * 1000, // 8-hour school-day session

  // The shared demo's access-code gate (lib/public-demo.js). Not a login: it only lets the demo page show the demo logins. Its own audience
  // (session-tokens kind 'demoGate') means it can never stand in for a site, student or admin session.
  DEMO_GATE_COOKIE_NAME: 'fn_demo_gate',
  DEMO_GATE_MAX_AGE_MS: 8 * 60 * 60 * 1000,
};

const pool = require('../db/pool');

// Defaults used when a key has never been set — keeps the settings table
// empty until an admin actually changes something, and keeps existing
// behavior (email admin@fixernationeducation.com) unchanged until they do.
const DEFAULTS = {
  contact_email_ask_the_fixer: 'admin@fixernationeducation.com',
  contact_email_quote: 'admin@fixernationeducation.com',
  contact_email_privacy: 'admin@fixernationeducation.com',
  contact_email_general: 'admin@fixernationeducation.com',
  // Real-time "money moved" staff alerts (quote accepted, new paid order,
  // PO submitted and awaiting Mark Received) — see mailer.js's
  // sendSalesAlertEmail(). Distinct from contact_email_quote, which only
  // routes *inbound* quote-request form submissions.
  contact_email_sales_alerts: 'admin@fixernationeducation.com',
  invoice_business_name: 'Fixer Nation Education',
  invoice_tagline: 'fixernationeducation.com',
  invoice_logo_url: '',
  teacher_lesson_plan_limit: '40',
  // Default trial-teacher library limit — used two ways: (1) as the
  // fallback for any trial purchase with no trial_library_limit snapshot of
  // its own (e.g. one created before this field existed), so an existing
  // trial doesn't silently fall through to the full-license default of 40;
  // and (2) to pre-fill a license product's own trial_library_limit field
  // the moment "Trial?" is checked on it in admin-licenses.html (a one-time
  // client-side pre-fill — the product's own field, once saved, is what
  // actually gets snapshotted onto purchases going forward).
  teacher_lesson_plan_limit_trial: '10',
};

async function getSetting(key) {
  const [rows] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  return rows[0] ? rows[0].setting_value : (DEFAULTS[key] || null);
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
    [key, value, value]
  );
}

module.exports = { getSetting, setSetting, DEFAULTS };

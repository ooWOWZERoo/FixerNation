const pool = require('../db/pool');

// Defaults used when a key has never been set — keeps the settings table
// empty until an admin actually changes something, and keeps existing
// behavior (email admin@fixernationeducation.com) unchanged until they do.
const DEFAULTS = {
  contact_email_ask_the_fixer: 'admin@fixernationeducation.com',
  contact_email_quote: 'admin@fixernationeducation.com',
  contact_email_privacy: 'admin@fixernationeducation.com',
  contact_email_general: 'admin@fixernationeducation.com',
  invoice_business_name: 'Fixer Nation Education',
  invoice_tagline: 'fixernationeducation.com',
  invoice_logo_url: '',
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

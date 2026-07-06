const pool = require('../db/pool');
const { sendAutomationEmail } = require('./mailer');

function renderTemplate(str, fields) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => (fields[key] === undefined || fields[key] === null) ? '' : String(fields[key]));
}

// Looks up the admin-configured template for eventKey and sends it to `to`
// with mergeFields substituted in. Deliberately swallows every error (SMTP
// down, template missing, bad `to`) rather than throwing — an automated
// thank-you/reminder email failing must never break the purchase, invoice,
// or seat-invite action that triggered it, matching how Stripe price sync
// failures are already handled defensively elsewhere in this codebase.
async function fireAutomation(eventKey, { to, mergeFields }) {
  if (!to) return;
  try {
    const [rows] = await pool.query('SELECT * FROM email_automations WHERE event_key = ? AND enabled = 1', [eventKey]);
    const automation = rows[0];
    if (!automation) return;
    await sendAutomationEmail({
      to,
      subject: renderTemplate(automation.subject, mergeFields || {}),
      body: renderTemplate(automation.body, mergeFields || {}),
    });
  } catch (err) {
    console.error(`Automation "${eventKey}" failed to send to ${to}:`, err.message);
  }
}

module.exports = { fireAutomation, renderTemplate };

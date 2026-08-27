const pool = require('../db/pool');
const { sendAutomationEmail } = require('./mailer');

function renderTemplate(str, fields) {
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) => (fields[key] === undefined || fields[key] === null) ? '' : String(fields[key]));
}

// Best-effort execution log — never lets a logging failure affect the send
// itself or bubble up to the caller.
async function logExecution(eventKey, to, status, errorMessage, durationMs) {
  try {
    await pool.query(
      'INSERT INTO automation_executions (event_key, recipient_email, status, error_message, duration_ms) VALUES (?, ?, ?, ?, ?)',
      [eventKey, to, status, errorMessage || null, durationMs != null ? Math.round(durationMs) : null]
    );
  } catch (err) {
    console.error(`Failed to log automation execution for "${eventKey}":`, err.message);
  }
}

// Looks up the admin-configured template for eventKey and sends it to `to`
// with mergeFields substituted in. Deliberately swallows every error (SMTP
// down, template missing, bad `to`) rather than throwing — an automated
// thank-you/reminder email failing must never break the purchase, invoice,
// or seat-invite action that triggered it, matching how Stripe price sync
// failures are already handled defensively elsewhere in this codebase.
// Every call is logged to automation_executions (success/failed/skipped) so
// admin-automations.html's Execution History has real data to show.
async function fireAutomation(eventKey, { to, mergeFields }) {
  if (!to) return;
  try {
    const [rows] = await pool.query('SELECT * FROM email_automations WHERE event_key = ?', [eventKey]);
    const automation = rows[0];
    if (!automation || !automation.enabled) {
      await logExecution(eventKey, to, 'skipped', automation ? 'Automation is disabled' : 'No automation configured for this event');
      return;
    }
    const startedAt = Date.now();
    await sendAutomationEmail({
      to,
      subject: renderTemplate(automation.subject, mergeFields || {}),
      body: renderTemplate(automation.body, mergeFields || {}),
    });
    await logExecution(eventKey, to, 'success', null, Date.now() - startedAt);
  } catch (err) {
    console.error(`Automation "${eventKey}" failed to send to ${to}:`, err.message);
    await logExecution(eventKey, to, 'failed', err.message);
  }
}

module.exports = { fireAutomation, renderTemplate };

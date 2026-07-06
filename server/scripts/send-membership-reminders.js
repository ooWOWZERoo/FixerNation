// Run daily via a cPanel Cron Job (see CHANGELOG.md's Unreleased entry for
// the exact command) — this project has no in-process scheduler, so a
// missed run just means reminders/expirations are a day late, not lost.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { fireAutomation } = require('../lib/automations');

function formatDate(value) {
  const d = new Date(value);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function sendReminders() {
  const [[automation]] = await pool.query(
    "SELECT reminder_days_before FROM email_automations WHERE event_key = 'membership_renewal_reminder' AND enabled = 1"
  );
  if (!automation || !automation.reminder_days_before) {
    console.log('membership_renewal_reminder is disabled (or has no reminder_days_before set) — skipping reminders.');
    return;
  }

  const [rows] = await pool.query(
    `SELECT cm.id, cm.ends_at, mp.name AS plan_name, nc.email, nc.name AS contact_name
     FROM contact_memberships cm
     JOIN membership_plans mp ON mp.id = cm.membership_plan_id
     JOIN newsletter_contacts nc ON nc.id = cm.contact_id
     WHERE cm.ends_at IS NOT NULL
       AND cm.reminder_sent_at IS NULL
       AND cm.status IN ('trialing', 'active', 'past_due')
       AND cm.ends_at <= NOW() + INTERVAL ? DAY`,
    [automation.reminder_days_before]
  );

  for (const row of rows) {
    await fireAutomation('membership_renewal_reminder', {
      to: row.email,
      mergeFields: {
        firstName: (row.contact_name || '').split(' ')[0] || 'there',
        planName: row.plan_name,
        expiresOn: formatDate(row.ends_at),
      },
    });
    await pool.query('UPDATE contact_memberships SET reminder_sent_at = NOW() WHERE id = ?', [row.id]);
  }
  console.log(`Sent ${rows.length} renewal reminder(s).`);
}

// One-time plans never auto-renew, so once ends_at passes with no new
// purchase extending it, the membership is genuinely over. For recurring
// plans this is a safety net — Stripe's own webhooks (customer.subscription.
// updated/deleted) normally get there first, but if one is ever missed this
// still catches it rather than leaving a lapsed membership showing "active".
async function expireLapsedMemberships() {
  const [result] = await pool.query(
    "UPDATE contact_memberships SET status = 'expired' WHERE ends_at IS NOT NULL AND ends_at < NOW() AND status IN ('trialing', 'active', 'past_due')"
  );
  console.log(`Expired ${result.affectedRows} membership(s) past their end date.`);
}

async function main() {
  await sendReminders();
  await expireLapsedMemberships();
  await pool.end();
}

main().catch(err => {
  console.error('send-membership-reminders failed:', err.message);
  process.exit(1);
});

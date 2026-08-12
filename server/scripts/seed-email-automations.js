require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// The fixed set of automated emails the system can send. Each event_key is
// fired from a specific place in the codebase (see server/lib/automations.js
// callers) — this seed only sets each one's default copy/on-off state, which
// the admin can then edit from admin-automations.html. Available merge
// fields are documented per event here and must match what the firing code
// actually passes in server/routes/*.js.
const AUTOMATIONS = [
  {
    eventKey: 'book_purchase_thank_you',
    label: 'Book Purchase — Thank You',
    subject: 'Thanks for grabbing {{bookTitle}}!',
    body: "Hi {{firstName}},\n\nThank you for picking up a copy of {{bookTitle}} — we hope it makes a real difference.\n\nIf a membership came with your purchase, check your email for details on activating it.\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'membership_purchase_thank_you',
    label: 'Membership Purchase — Thank You',
    subject: 'Welcome to {{planName}}!',
    body: "Hi {{firstName}},\n\nYour {{planName}} membership is confirmed — thank you for joining Fixer Nation.\n\nAmount charged: {{amount}}\n\nSet up your account password to access your membership:\n{{setPasswordUrl}}\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'membership_renewal_reminder',
    label: 'Membership Renewal Reminder',
    subject: 'Your {{planName}} membership is expiring soon',
    body: "Hi {{firstName}},\n\nJust a heads up — your {{planName}} membership is set to expire on {{expiresOn}}. Renew today to keep your access without interruption.\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: 7,
  },
  {
    eventKey: 'invoice_paid',
    label: 'Invoice Paid — Confirmation',
    subject: 'Invoice {{invoiceNumber}} paid — thank you!',
    body: "Hi {{buyerName}},\n\nWe've received payment for invoice {{invoiceNumber}}, totaling {{total}}. Thank you!\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'payment_failed',
    label: 'Payment Failed / Past Due',
    subject: "We couldn't process your {{planName}} payment",
    body: "Hi {{firstName}},\n\nWe weren't able to process your latest payment for {{planName}}. Please update your payment method to avoid losing access.\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'membership_trial_started',
    label: 'Membership Trial — Started',
    subject: 'Your free trial of {{planName}} has started!',
    body: "Hi {{firstName}},\n\nYou're all set — your {{trialDays}}-day free trial of {{planName}} has started today. No charge until the trial ends.\n\nSet up your account password to get started:\n{{setPasswordUrl}}\n\nHere's what to expect:\n- Full access during your trial period\n- A receipt will be sent when your trial converts and your card is charged\n- You can cancel any time before the trial ends\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'license_seat_invite',
    label: 'License Seat Invite',
    subject: "You've been invited to activate your Fixer Nation license",
    body: "Hi there,\n\nYou've been invited to activate a Fixer Nation Education license under {{licenseProductName}}{{schoolLabel}}. Sign up with this email address to automatically claim your seat.\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'school_license_expiring_soon',
    label: 'School License — Expiring Soon (30-Day Notice)',
    subject: 'Your {{planName}} license expires on {{expirationDate}}',
    body: "Hi {{firstName}},\n\nYour {{planName}} school license for {{schoolDomain}} is set to expire on {{expirationDate}}. Renew soon to keep your teachers' access without interruption.\n\nTo renew, visit fixernationeducation.com or reply to this email and we'll get you sorted.\n\nWarmly,\nThe Fixer Nation Education Team",
    reminderDaysBefore: 30,
  },
  {
    eventKey: 'school_license_expired',
    label: 'School License — Expired',
    subject: 'Your {{planName}} license has expired',
    body: "Hi {{firstName}},\n\nYour {{planName}} school license for {{schoolDomain}} expired on {{expirationDate}}. Teacher access has been suspended.\n\nTo restore access, renew your license at fixernationeducation.com or reply to this email.\n\nWarmly,\nThe Fixer Nation Education Team",
    reminderDaysBefore: null,
  },
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let created = 0, skipped = 0;
  for (const a of AUTOMATIONS) {
    const [existing] = await connection.query('SELECT id FROM email_automations WHERE event_key = ?', [a.eventKey]);
    if (existing.length) {
      console.log(`Skipped (already exists): ${a.eventKey}`);
      skipped++;
      continue;
    }
    await connection.query(
      `INSERT INTO email_automations (event_key, label, enabled, subject, body, reminder_days_before)
       VALUES (?, ?, 1, ?, ?, ?)`,
      [a.eventKey, a.label, a.subject, a.body, a.reminderDaysBefore]
    );
    console.log(`Created: ${a.eventKey}`);
    created++;
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
  await connection.end();
}

main().catch(err => {
  console.error('Seeding email automations failed:', err.message);
  process.exit(1);
});

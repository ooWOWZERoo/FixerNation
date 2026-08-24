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
    body: "Hi {{firstName}},\n\nThank you for picking up a copy of {{bookTitle}} — we hope it makes a real difference.\n\nWarmly,\nThe Fixer Nation Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'invoice_paid',
    label: 'Invoice Paid — Confirmation',
    subject: 'Invoice {{invoiceNumber}} paid — thank you!',
    body: "Hi {{buyerName}},\n\nWe've received payment for invoice {{invoiceNumber}}, totaling {{total}}. Thank you!\n\nWarmly,\nThe Fixer Nation Team",
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
  {
    eventKey: 'trial_purchase_thank_you',
    label: 'Trial — Purchase Thank You',
    subject: "Your 30-day FNE trial is ready",
    body: "Hi {{firstName}},\n\nYou're all set — your 30-day FNE trial starts today. You can explore up to {{lessonLimit}} full lessons before your trial ends.\n\nCreate your account password to get started:\n{{setPasswordUrl}}\n\nIf you decide to convert to an annual license within 30 days, your $74.50 trial payment applies as a credit toward your first year.\n\nWarmly,\nThe Fixer Nation Education Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'trial_expired',
    label: 'Trial — Expired',
    subject: 'Your FNE trial has ended',
    body: "Hi {{firstName}},\n\nYour 30-day FNE trial has ended and your lesson access has been paused.\n\nIf you're ready to bring FNE to your classroom, your $74.50 trial payment applies as a credit toward an annual license — just log in to your account and choose \"Convert to Annual Access\" before the credit expires.\n\nWarmly,\nThe Fixer Nation Education Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'trial_converted',
    label: 'Trial — Converted to Annual',
    subject: "You're all set — your annual FNE license is active",
    body: "Hi {{firstName}},\n\nWelcome to full FNE access. Your annual license is active and your $74.50 trial credit has been applied.\n\nLog in any time to explore the full curriculum library.\n\nWarmly,\nThe Fixer Nation Education Team",
    reminderDaysBefore: null,
  },
  {
    eventKey: 'quote_accepted',
    label: 'Quote Accepted — School Onboarding',
    subject: "Welcome to Fixer Nation Education — let's get your school set up",
    body: "Hi {{firstName}},\n\nYour Fixer Nation Education license for {{school}} is confirmed. Here's what happens next:\n\n1. Set up your School License Administrator account at the link below.\n2. Once you're in, you can invite your teachers directly from the School Admin portal.\n3. Teachers accept their invitation and get immediate access to the lesson library.\n4. If you prefer support through the onboarding process, contact us at admin@fixernationeducation.com.\n\nGet started here: {{setupUrl}}\n\nIf you'd rather have someone else manage the account, just forward this email and have them use the same link.\n\nWe're glad to have {{school}} on board.\n\nFixer Nation Education",
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

  // Patch existing quote_accepted body to add step 4 (support contact line)
  const newQuoteAcceptedBody = AUTOMATIONS.find(a => a.eventKey === 'quote_accepted').body;
  const [patchResult] = await connection.query(
    "UPDATE email_automations SET body = ? WHERE event_key = 'quote_accepted' AND body NOT LIKE '%admin@fixernationeducation.com%'",
    [newQuoteAcceptedBody]
  );
  if (patchResult.affectedRows) console.log('Patched body: quote_accepted');

  console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
  await connection.end();
}

main().catch(err => {
  console.error('Seeding email automations failed:', err.message);
  process.exit(1);
});

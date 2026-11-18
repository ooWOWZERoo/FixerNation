require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Customer Hub follow-up to G14: the reminder email at a task's chosen time of day. Run every 5 minutes from cPanel cron (see setup-cron-jobs.sh). Self-contained: it loads .env, opens its
// own connection, does its work and closes it. Safe to run any number of times: each reminder moment is claimed in crm_task_reminder_sends BEFORE the email is written.
//
// STAFF ONLY: the one recipient is the staff member the task is assigned to. It never emails a customer, a contact or the sales inbox. OFF until the owner has read a dry run:
//   node scripts/crm-task-reminders.js                          report only (counts what it would send; changes nothing, sends nothing)
//   node scripts/crm-task-reminders.js --apply                  sends, but only if the switch below is ON
//   node scripts/crm-task-reminders.js --apply --only-if-enabled   what cron runs: does nothing while crm_v2_enabled is not 'true'
//   node scripts/crm-task-reminders.js --task-reminders on|off|status   the switch (setting crm_task_reminder_emails)
//
// Output is counts only (no names, no email addresses). Needs alter-add-crm-task-reminder-time.js (it says so, and does nothing, until that has run).
const mysql = require('mysql2/promise');
const R = require('../lib/crm-task-reminders');

async function setting(db, key) {
  const [[row]] = await db.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]).catch(() => [[undefined]]);
  return row ? row.setting_value : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  try {
    const si = process.argv.indexOf('--task-reminders');
    if (si !== -1) {
      const mode = process.argv[si + 1];
      if (!['on', 'off', 'status'].includes(mode)) { console.error('Use --task-reminders on, off or status.'); process.exitCode = 1; return; }
      if (mode !== 'status') {
        const value = mode === 'on' ? 'true' : 'false';
        await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', [R.SWITCH, value, value]);
      }
      console.log(`Task reminder emails are ${(await setting(db, R.SWITCH)) === 'true' ? 'ON' : 'OFF'} (${R.SWITCH}).`);
      return;
    }
    if (process.argv.includes('--only-if-enabled') && (await setting(db, 'crm_v2_enabled')) !== 'true') { console.log('The Sales CRM is off (crm_v2_enabled is not true). Nothing to do.'); return; }
    const on = (await setting(db, R.SWITCH)) === 'true';
    const live = apply && on;
    const mailer = require('../lib/mailer');
    const base = process.env.SITE_URL || '';
    const r = await R.sendDue(db, {
      apply: live, now: new Date(),
      send: ({ to, task }) => mailer.sendTaskReminderEmail({ to, title: task.title, dueOn: task.dueOn, about: task.about, linkUrl: `${base}/admin-crm-tasks.html?view=reminders` }),
    });
    if (!r.available) { console.log('Task reminder emails: skipped, because the table or columns are missing. Run scripts/alter-add-crm-task-reminder-time.js, then run this again.'); return; }
    console.log(`Task reminder emails (${on ? 'switched ON' : 'switched OFF'}${apply ? '' : ', report only'}): ${r.timed} open task(s) have a reminder time near now; ${r.due} are due now (${r.early} later, ${r.missed} missed more than ${R.WINDOW_MINUTES} minutes ago).`);
    console.log(live
      ? `  Sent: ${r.sent}. Failed: ${r.failed}. Already sent: ${r.alreadySent}. In progress elsewhere: ${r.inFlight}. Gave up after ${R.MAX_ATTEMPTS} tries: ${r.gaveUp}. No one assigned: ${r.noOwner}. Owner has no email address: ${r.noAddress}.`
      : `  It would send: ${r.wouldSend}. Already sent: ${r.alreadySent}. No one assigned: ${r.noOwner}. Owner has no email address: ${r.noAddress}. Nothing was sent${on ? '' : ' (the switch is off)'}.`);
  } finally { await db.end(); }
}

main().catch(err => { console.error(err); process.exit(1); });

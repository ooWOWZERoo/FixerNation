// Run via cPanel Cron Jobs every 5 minutes:
//   source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
//   cd /home/fixernat/repositories/fixernation/server && \
//   node scripts/send-morning-boost-email.js
//
// The script checks whether the configured send time has been reached for
// today and whether a send hasn't happened yet. Runs once per day at most.
// A run more than 3 hours past the configured time is treated as "missed"
// and the day is skipped (admin can manually resend from the dashboard).

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { runMorningBoostSend } = require('../routes/morning-boost');
const { sendContactFormEmail } = require('../lib/mailer');
const { getSetting } = require('../lib/settings');

const MISS_WINDOW_HOURS = 3; // skip automated send if we're this many hours past the configured time

function nowInTimezone(tz) {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  } catch {
    return new Date();
  }
}

function todayInTimezone(tz) {
  const d = nowInTimezone(tz);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function minutesAfterMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = (timeStr || '07:00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function notifyAdminOfFailure(errors) {
  const adminEmail = await getSetting('contact_email_admin').catch(() => null)
    || process.env.SMTP_USER;
  if (!adminEmail) return;
  try {
    await sendContactFormEmail({
      to: adminEmail,
      formName: 'Morning Boost Email — Send Failure',
      fields: {
        'Date': new Date().toLocaleDateString('en-US'),
        'Errors': Array.isArray(errors) ? errors.join('\n') : String(errors),
        'Action': 'Log in to admin-morning-boost-email.html to review the config or manually resend.',
      },
    });
  } catch (e) {
    console.error('[mb-email] Could not send admin failure notification:', e.message);
  }
}

async function main() {
  const [[config]] = await pool.query('SELECT * FROM morning_boost_email_config ORDER BY id LIMIT 1');

  if (!config || !config.enabled) {
    console.log('[mb-email] Morning Boost email is disabled — skipping.');
    await pool.end();
    return;
  }

  const tz = config.send_timezone || 'America/New_York';
  const todayDate = todayInTimezone(tz);
  const nowLocal = nowInTimezone(tz);
  const nowMinutes = minutesAfterMidnight(nowLocal);
  const sendMinutes = parseTimeToMinutes(config.send_time);

  if (nowMinutes < sendMinutes) {
    console.log(`[mb-email] Not yet send time (${config.send_time} ${tz}) — skipping.`);
    await pool.end();
    return;
  }

  if (nowMinutes > sendMinutes + MISS_WINDOW_HOURS * 60) {
    console.log(`[mb-email] Send window (${MISS_WINDOW_HOURS}h) has passed for today — skipping. Use admin UI to manually resend.`);
    await pool.end();
    return;
  }

  // TESTING: already-sent guard temporarily disabled — restore before going back to production
  // const [[existingSend]] = await pool.query(
  //   "SELECT id FROM morning_boost_sends WHERE boost_date = ? AND status IN ('completed','sending')",
  //   [todayDate]
  // );
  // if (existingSend) {
  //   console.log(`[mb-email] Already sent for ${todayDate} (send #${existingSend.id}) — skipping.`);
  //   await pool.end();
  //   return;
  // }

  console.log(`[mb-email] Starting Morning Boost send for ${todayDate}...`);
  const result = await runMorningBoostSend({ targetDate: todayDate, initiatedBy: null, isResend: false });

  if (result.ok) {
    console.log(`[mb-email] Done — sent:${result.sent} failed:${result.failed} skipped:${result.skipped} (send #${result.sendId})`);
  } else {
    console.error('[mb-email] Send failed:', result.errors);
    await notifyAdminOfFailure(result.errors);
  }

  await pool.end();
}

main().catch(async err => {
  console.error('[mb-email] Unexpected error:', err.message);
  await notifyAdminOfFailure([err.message]);
  await pool.end().catch(() => {});
  process.exit(1);
});

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Error spike alerts (phase B of docs/reference/help-support-tools-requirements.md). Run every 10 minutes from cPanel cron (see setup-cron-jobs.sh).
// Self-contained: it loads .env, opens its own connection, does its work and closes it. Safe to run any number of times: a quiet period per error group and a
// daily limit (both settings) stop repeats.
//
//   node scripts/alert-error-spikes.js              report only: says what it WOULD send; changes nothing and sends nothing
//   node scripts/alert-error-spikes.js --apply      sends, but only while the setting error_alerts_enabled is true and a recipient is set (what cron runs)
//   node scripts/alert-error-spikes.js --status     shows the current settings (no addresses are printed)
//
// STAFF ONLY: the recipients are the addresses an admin typed on the Errors page. Output is counts only.
const mysql = require('mysql2/promise');
const A = require('../lib/error-alerts');

async function main() {
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  try {
    const [t] = await db.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'error_alerts'`, [process.env.DB_NAME]);
    if (!t.length) { console.log('Error alerts: skipped, because the table is missing. Run scripts/alter-create-error-alerts.js first.'); return; }
    const cfg = await A.loadConfig((sql, p) => db.query(sql, p));
    if (process.argv.includes('--status')) {
      console.log(`Error alerts are ${cfg.enabled ? 'ON' : 'OFF'}; ${cfg.recipients.length} recipient(s); ${cfg.browserReports} reports from ${cfg.browsers} browsers, ${cfg.serverErrors} server errors; quiet ${cfg.quietHours} h; at most ${cfg.dailyCap} a day.`);
      return;
    }
    const mailer = require('../lib/mailer');
    const base = process.env.SITE_URL || '';
    const r = await A.run({
      query: (sql, p) => db.query(sql, p), now: new Date(), apply, cfg,
      send: async ({ recipients, spikes, more }) => {
        let failures = 0;
        for (const to of recipients) {
          try { await mailer.sendErrorAlertEmail({ to, lines: spikes.map(s => s.line), more, linkUrl: `${base}/admin-support-errors.html` }); } catch (e) { failures++; }
        }
        if (failures === recipients.length) throw new Error('every recipient failed');
      },
    });
    if (r.skipped) { console.log(`Error alerts: ${r.skipped}`); return; }
    console.log(`Error alerts${apply ? '' : ' (report only)'}: ${r.spikes} group(s) over a threshold, ${r.quiet} still in their quiet period, ${r.held} held by the daily limit.`
      + (apply ? ` Sent: ${r.sent}.${r.failed ? ' The email could not be sent; it will be tried again next run.' : ''}` : ` It would send: ${r.wouldSend}. Nothing was sent.`));
  } finally { await db.end(); }
}

main().catch(err => { console.error(err); process.exit(1); });

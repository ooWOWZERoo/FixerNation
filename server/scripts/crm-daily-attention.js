require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Sales CRM daily job (docs/reference/sales-crm-update-requirements.md, phase 3). Run once a day from cPanel cron (see setup-cron-jobs.sh).
// It evaluates the "Needs Attention" rules (overdue next steps and tasks, quiet deals, quotes about to run out, and the rest), skips anything staff snoozed or
// dismissed, and writes one "first seen" row for each item it has not seen before (same rule, same subject, same due date). That row is what makes the job idempotent:
// run it twice in a row and the second run finds nothing new, so it fires nothing a second time.
//
// Optional owner digest: when the setting crm_attention_email is 'true' (OFF unless the owner turns it on), each staff member with new items gets ONE email listing
// them, sent through lib/mailer.js. Items nobody owns are only on the page. The email goes out once per item, never again.
//
//   node scripts/crm-daily-attention.js                          report only (changes nothing, sends nothing)
//   node scripts/crm-daily-attention.js --apply                  write the first-seen rows, send the digest if it is switched on
//   node scripts/crm-daily-attention.js --apply --only-if-enabled   what cron runs: does nothing while crm_v2_enabled is not 'true'
//
// Output is counts only (no names, no email addresses).
const mysql = require('mysql2/promise');
const A = require('../lib/crm-attention');

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
    if (process.argv.includes('--only-if-enabled') && (await setting(db, 'crm_v2_enabled')) !== 'true') {
      console.log('The Sales CRM is off (crm_v2_enabled is not true). Nothing to do.');
      return;
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    let sendDigest = null;
    if (apply && (await setting(db, 'crm_attention_email')) === 'true') {
      const mailer = require('../lib/mailer');
      sendDigest = (to, list) => {
        const fields = {};
        list.slice(0, 15).forEach((it, i) => { fields[`${i + 1}. ${it.ruleLabel}: ${it.title}`] = it.why; });
        if (list.length > 15) fields['And more'] = `${list.length - 15} more on the page.`;
        return mailer.sendSalesAlertEmail({
          to, subject: `${list.length} thing${list.length === 1 ? '' : 's'} need${list.length === 1 ? 's' : ''} your attention in the Customer Hub`, fields,
          linkUrl: `${process.env.SITE_URL || ''}/admin-crm-attention.html`, linkLabel: 'Open Needs Attention',
        });
      };
    }
    const r = await A.runDaily(db, { apply, now, sendDigest });
    console.log(`${apply ? 'Needs Attention' : 'Needs Attention (report only)'}: ${r.active} item(s) active (${r.held} snoozed or dismissed), ${r.fresh} first seen today.`);
    for (const [k, n] of Object.entries(r.byRule)) if (n) console.log(`  ${k}: ${n}`);
    if (sendDigest) console.log(`Digest emails sent: ${r.digests}.`);
  } finally {
    await db.end();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });

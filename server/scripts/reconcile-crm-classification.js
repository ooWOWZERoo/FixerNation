require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Sales CRM: the nightly safety net for Suspect / Prospect / Customer (docs/reference/sales-crm-update-requirements.md, phase 1). It re-derives every contact
// whose label could change (anyone with a purchase or a quote, and every Customer) using lib/crm-classification.js, the one definition of a Customer. The
// payment and quote routes already do this per change; this catches anything they missed (a script, a missed hook, a manual database fix).
//
//   node scripts/reconcile-crm-classification.js                        report only
//   node scripts/reconcile-crm-classification.js --apply                write
//   node scripts/reconcile-crm-classification.js --apply --only-if-enabled   what cron runs: does nothing while crm_v2_enabled is not 'true'
//
// Output is counts and ids only. It never demotes anyone: a Customer who no longer has a qualifying purchase is flagged (event "needs_review"), not changed.
const mysql = require('mysql2/promise');
const { reconcileAll, listPurchasesNeedingReview } = require('../lib/crm-classification');

async function main() {
  const apply = process.argv.includes('--apply');
  const onlyIfEnabled = process.argv.includes('--only-if-enabled');
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  try {
    if (onlyIfEnabled) {
      const [[row]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'crm_v2_enabled'").catch(() => [[undefined]]);
      if (!row || row.setting_value !== 'true') { console.log('The Sales CRM is off (crm_v2_enabled is not true). Nothing to do.'); return; }
    }
    const s = await reconcileAll(db, { dryRun: !apply });
    console.log(`${apply ? 'Reconcile' : 'Reconcile (report only)'}: ${s.examined} contacts examined, ${s.changed.length} change${s.changed.length === 1 ? '' : 's'} (${s.toCustomer} to Customer, ${s.toProspect} to Prospect), ${s.needsReview.length} Customer(s) flagged for review.`);
    for (const c of s.changed) console.log(`  contact #${c.contactId}: ${c.from} -> ${c.to} (${c.eventType})`);
    for (const id of s.needsReview) console.log(`  contact #${id}: Customer with no qualifying purchase; review`);
    const review = await listPurchasesNeedingReview(db);
    if (review.length) console.log(`${review.length} paid, non-trial purchase(s) have no amount or a zero amount and are not counted: ${review.map(r => '#' + r.purchaseId).join(', ')}`);
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

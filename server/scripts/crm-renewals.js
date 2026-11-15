require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Sales CRM phase 6: the renewal and expansion generator (docs/reference/sales-crm-update-requirements.md, "Phase 6 spec"). Finds PAID group licenses that end within
// 120 days (or ended in the last 30) and makes one Renewal deal for each, plus an Expansion deal when 90% or more of the seats are registered. Each source purchase
// gets at most one of each, ever (crm_opportunities.generated_key is unique), so running it twice, or twice at once, makes nothing new the second time.
// It writes deals only: never a purchase, invoice, license, seat, quote, contact label or email.
//
//   node scripts/crm-renewals.js                              report only (changes nothing)
//   node scripts/crm-renewals.js --apply                      make the deals
//   node scripts/crm-renewals.js --apply --only-if-enabled    what cron runs: does nothing unless crm_v2_enabled is 'true' AND crm_renewal_generator is 'true'
//
// Output is counts only (no names, no email addresses). The generator setting is OFF until the owner has read a report on production:
//   node scripts/crm-renewals.js --generator on|off|status
const mysql = require('mysql2/promise');
const G = require('../lib/crm-growth');

async function setting(db, key) {
  const [[row]] = await db.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]).catch(() => [[undefined]]);
  return row ? row.setting_value : null;
}

async function main() {
  const args = process.argv.slice(2);
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  try {
    const gi = args.indexOf('--generator');
    if (gi !== -1) {
      const mode = args[gi + 1];
      if (!['on', 'off', 'status'].includes(mode)) { console.error('Use --generator on, off or status.'); process.exitCode = 1; return; }
      if (mode !== 'status') {
        const value = mode === 'on' ? 'true' : 'false';
        await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['crm_renewal_generator', value, value]);
      }
      console.log(`The renewal generator is ${(await setting(db, 'crm_renewal_generator')) === 'true' ? 'ON' : 'OFF'} (crm_renewal_generator).`);
      return;
    }
    const apply = args.includes('--apply');
    if (args.includes('--only-if-enabled')) {
      if ((await setting(db, 'crm_v2_enabled')) !== 'true') { console.log('The Sales CRM is off (crm_v2_enabled is not true). Nothing to do.'); return; }
      if ((await setting(db, 'crm_renewal_generator')) !== 'true') { console.log('The renewal generator is off (crm_renewal_generator is not true). Nothing to do.'); return; }
    }
    // The key column is the whole safety net: without it nothing may run.
    const [cols] = await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'crm_opportunities' AND COLUMN_NAME = 'generated_key'", [process.env.DB_NAME]);
    if (!cols.length) { console.error('Stopped: crm_opportunities.generated_key is missing. Run scripts/alter-create-crm-growth.js first. Nothing was changed.'); process.exitCode = 1; return; }

    const r = await G.runGrowth(db, { apply });
    console.log(`Renewal generator${apply ? '' : ' (report only, nothing was changed)'}:`);
    console.log(`  ${r.sources} paid group license(s) end within ${G.LEAD_DAYS} days (or ended in the last ${G.LOOKBACK_DAYS}).`);
    console.log(apply ? `  Renewal deals made: ${r.renewal.made}.  Expansion deals made: ${r.expansion.made}.` : `  Renewal deals it would make: ${r.renewal.wouldMake}.  Expansion deals it would make: ${r.expansion.wouldMake}.`);
    const s = r.skipped;
    console.log(`  Skipped: already made ${s.alreadyMade}; already renewed ${s.alreadyRenewed}; no CRM account for the school ${s.noAccount}; an open deal of that type exists ${s.openDeal}; renewal won in the last ${G.WON_GUARD_DAYS} days ${s.wonRecently}.`);
    console.log(`  Expansion check: seat count unknown ${s.seatsUnknown}; under ${G.EXPANSION_SEAT_PCT}% of seats registered ${s.belowSeatThreshold}.`);
    console.log(`  Left out because the amount is unknown or zero (never a source; confirm them on the review list): ${r.amountUnknown}.`);
  } finally {
    await db.end();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1); });

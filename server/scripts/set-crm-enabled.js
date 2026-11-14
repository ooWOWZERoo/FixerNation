require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Sales CRM: the on/off switch (setting crm_v2_enabled; docs/reference/sales-crm-update-requirements.md, decision D10). Off means every /api/crm route
// answers "not found". Turning it off removes nothing: the data stays and the nightly check skips itself. There is no admin page for this yet.
//
//   node scripts/set-crm-enabled.js --status
//   node scripts/set-crm-enabled.js --on
//   node scripts/set-crm-enabled.js --off
const mysql = require('mysql2/promise');

async function main() {
  const arg = process.argv[2];
  if (!['--status', '--on', '--off'].includes(arg)) { console.error('Use --status, --on or --off.'); process.exit(1); }
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    if (arg !== '--status') {
      const value = arg === '--on' ? 'true' : 'false';
      if (value === 'true') {
        // Refuse to switch on before the alter script has run: the routes would answer 503 for everyone.
        const [cols] = await db.query("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'admin_users' AND COLUMN_NAME = 'crm_role'", [process.env.DB_NAME]);
        if (!cols.length) { console.error('Not switched on: admin_users.crm_role is missing. Run scripts/alter-create-crm-core.js first.'); process.exit(1); }
      }
      await db.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?', ['crm_v2_enabled', value, value]);
    }
    const [[row]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'crm_v2_enabled'").catch(() => [[undefined]]);
    console.log(`Sales CRM is ${row && row.setting_value === 'true' ? 'ON' : 'OFF'} (crm_v2_enabled = ${row ? row.setting_value : '(not set)'}).`);
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

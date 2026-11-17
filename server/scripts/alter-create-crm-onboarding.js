require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');
const { TEMPLATE_NAME, STARTER_STEPS } = require('../lib/crm-onboarding');

// Sales CRM punch list G4 (FR-WON-03): the record of which Won-and-paid deals the daily job has already given an onboarding checklist, so a deal gets it at most once, ever.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app and before the daily job runs with the new code (the job skips this step, and says so, while the table is missing).
// Everything is additive. It also adds the starter checklist template named "Onboarding" ONLY if no template with that name exists (an edited one is never touched);
// the owner changes the steps afterwards under Hub Settings. Nothing is back-filled and nothing is added to any deal here.
//
//   node scripts/alter-create-crm-onboarding.js

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async (t) => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  for (const t of ['crm_opportunities', 'crm_procurement_templates', 'crm_opportunity_checklist_items']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here (run scripts/alter-create-crm-execution.js first). Nothing was changed.`); process.exit(1); }
  }
  if (await hasTable('crm_onboarding_started')) console.log('Skipped: crm_onboarding_started already exists.');
  else {
    await db.query(`CREATE TABLE IF NOT EXISTS crm_onboarding_started (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      opportunity_id INT UNSIGNED NOT NULL,
      template_id INT UNSIGNED NULL,
      steps_added INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_onboarding_opp (opportunity_id),
      CONSTRAINT fk_crm_onboarding_opp FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_onboarding_template FOREIGN KEY (template_id) REFERENCES crm_procurement_templates (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created crm_onboarding_started.');
  }
  const [[have]] = await db.query('SELECT id FROM crm_procurement_templates WHERE name = ?', [TEMPLATE_NAME]);
  if (have) console.log(`Skipped: a checklist template named "${TEMPLATE_NAME}" already exists (left as it is).`);
  else {
    await db.query('INSERT INTO crm_procurement_templates (name, description, items_json, is_active) VALUES (?, ?, ?, 1)',
      [TEMPLATE_NAME, 'Added to a deal by the daily check once it is Won and its purchase is paid.', JSON.stringify(STARTER_STEPS.map(label => ({ label })))]);
    console.log(`Added the starter template "${TEMPLATE_NAME}" (${STARTER_STEPS.length} steps). Edit it under Hub Settings.`);
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

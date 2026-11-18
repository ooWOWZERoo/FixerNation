require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G15 (PROC-01): an owner on each procurement step, and files that belong to a step.
//   crm_opportunity_checklist_items.owner_admin_id  (the staff member responsible; blank means the deal owner)
//   crm_attachments.checklist_item_id               (the step a file is attached to; the file still belongs to the deal)
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the checklist panel, the files list and Needs Attention read these columns. Additive only: no row is changed,
// and no saved checklist is edited (the three missing standard steps are added by a one-click button on Hub Settings).
//
//   node scripts/alter-add-crm-checklist-owner-files.js

const COLUMNS = [
  ['crm_opportunity_checklist_items', 'owner_admin_id', 'INT UNSIGNED NULL'],
  ['crm_attachments', 'checklist_item_id', 'INT UNSIGNED NULL'],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  for (const t of ['crm_opportunity_checklist_items', 'crm_attachments']) {
    const [[x]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]);
    if (!Number(x.n)) { console.error(`Stopped: ${t} does not exist here (run scripts/alter-create-crm-execution.js first). Nothing was changed.`); process.exit(1); }
  }
  for (const [table, name, ddl] of COLUMNS) {
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, table, name]);
    if (Number(c.n)) { console.log(`Skipped: ${table}.${name} already exists.`); continue; }
    try { await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`); console.log(`Added ${table}.${name}.`); }
    catch (err) { if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: ${table}.${name} already exists.`); else throw err; }
  }
  const [[ix]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'crm_attachments' AND INDEX_NAME = 'idx_crm_attachments_item'", [schema]);
  if (Number(ix.n)) console.log('Skipped: idx_crm_attachments_item already exists.');
  else { await db.query('CREATE INDEX idx_crm_attachments_item ON crm_attachments (checklist_item_id)'); console.log('Added idx_crm_attachments_item.'); }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

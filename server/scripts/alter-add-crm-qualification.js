require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G6 (FR-QUAL-01): the qualification answers on a deal. Eight optional columns on crm_opportunities (counts and short notes). The champion and decision
// maker come from the buying committee, and start of use and competitor are the deal's existing fields, so nothing else is added.
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the deal page and route read and write these columns. Additive only: no row is changed.
//
//   node scripts/alter-add-crm-qualification.js

const COLUMNS = [
  ['qual_schools', 'INT UNSIGNED NULL'],
  ['qual_teachers', 'INT UNSIGNED NULL'],
  ['qual_students', 'INT UNSIGNED NULL'],
  ['qual_grades', 'VARCHAR(64) NULL'],
  ['qual_need', 'VARCHAR(1000) NULL'],
  ['qual_funding', 'VARCHAR(255) NULL'],
  ['qual_procurement_path', 'VARCHAR(255) NULL'],
  ['qual_risks', 'VARCHAR(1000) NULL'],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const [[t]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, 'crm_opportunities']);
  if (!Number(t.n)) { console.error('Stopped: crm_opportunities does not exist here (run scripts/alter-create-crm-core.js first). Nothing was changed.'); process.exit(1); }
  for (const [name, ddl] of COLUMNS) {
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, 'crm_opportunities', name]);
    if (Number(c.n)) { console.log(`Skipped: crm_opportunities.${name} already exists.`); continue; }
    try {
      await db.query(`ALTER TABLE crm_opportunities ADD COLUMN ${name} ${ddl}`);
      console.log(`Added crm_opportunities.${name}.`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: crm_opportunities.${name} already exists.`);
      else throw err;
    }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

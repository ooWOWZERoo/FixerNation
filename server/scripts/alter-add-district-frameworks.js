require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Per-district frameworks (docs/standards-crosswalk/DISTRICT-FRAMEWORKS-REQUIREMENTS.md).
// Adds columns to standards_frameworks and standards_alignments, and swaps the framework
// unique key so two districts (or a district and its state) can each have a framework
// with the same name. Idempotent: every step checks information_schema first.
// Run it BEFORE restarting the Node app. db/schema.sql carries the same definitions.

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;

  async function hasColumn(table, column) {
    const [r] = await db.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, table, column]);
    return r.length > 0;
  }
  async function hasIndex(table, index) {
    const [r] = await db.query(
      'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?', [schema, table, index]);
    return r.length > 0;
  }
  async function hasForeignKey(table, name) {
    const [r] = await db.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`, [schema, table, name]);
    return r.length > 0;
  }
  async function addColumn(table, column, ddl) {
    if (await hasColumn(table, column)) { console.log(`Skipped: ${table}.${column} already exists.`); return; }
    await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    console.log(`Added ${table}.${column}.`);
  }

  // ---- standards_frameworks ----
  await addColumn('standards_frameworks', 'district_id', 'INT UNSIGNED NULL');
  await addColumn('standards_frameworks', 'owner_key', 'INT UNSIGNED NOT NULL DEFAULT 0');
  await addColumn('standards_frameworks', 'submitted_at', 'DATETIME NULL');
  await addColumn('standards_frameworks', 'submitted_by_site_user_id', 'INT UNSIGNED NULL');
  await addColumn('standards_frameworks', 'attested_at', 'DATETIME NULL');
  await addColumn('standards_frameworks', 'attested_by_site_user_id', 'INT UNSIGNED NULL');

  // New unique key first, THEN drop the old one, so the table is never unprotected.
  if (!(await hasIndex('standards_frameworks', 'uq_owner_type_name'))) {
    await db.query('ALTER TABLE standards_frameworks ADD UNIQUE KEY uq_owner_type_name (state_code, framework_type, name, owner_key)');
    console.log('Added unique key uq_owner_type_name.');
  } else console.log('Skipped: uq_owner_type_name already exists.');
  if (await hasIndex('standards_frameworks', 'uq_state_type_name')) {
    await db.query('ALTER TABLE standards_frameworks DROP INDEX uq_state_type_name');
    console.log('Dropped old unique key uq_state_type_name.');
  } else console.log('Skipped: uq_state_type_name already gone.');
  if (!(await hasIndex('standards_frameworks', 'idx_district'))) {
    await db.query('ALTER TABLE standards_frameworks ADD INDEX idx_district (district_id)');
    console.log('Added index idx_district.');
  }
  const fks = [
    ['standards_frameworks', 'fk_sf_district', 'district_id', 'districts', 'CASCADE'],
    ['standards_frameworks', 'fk_sf_submitted_by', 'submitted_by_site_user_id', 'site_users', 'SET NULL'],
    ['standards_frameworks', 'fk_sf_attested_by', 'attested_by_site_user_id', 'site_users', 'SET NULL'],
  ];

  // ---- standards_alignments ----
  await addColumn('standards_alignments', 'suggested_by_site_user_id', 'INT UNSIGNED NULL');
  await addColumn('standards_alignments', 'district_note', 'VARCHAR(500) NULL');
  fks.push(['standards_alignments', 'fk_sa_suggested_by', 'suggested_by_site_user_id', 'site_users', 'SET NULL']);

  for (const [table, name, col, refTable, onDelete] of fks) {
    if (await hasForeignKey(table, name)) { console.log(`Skipped: ${name} already exists.`); continue; }
    await db.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} FOREIGN KEY (${col}) REFERENCES ${refTable}(id) ON DELETE ${onDelete}`);
    console.log(`Added ${name}.`);
  }

  await db.end();
}

main().catch((err) => { console.error(err); process.exit(1); });

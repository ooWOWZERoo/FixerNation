require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Doubles how much a CRM task can hold: title 255 to 510 characters, details 1000 to 2000. Idempotent; safe to re-run: it reads the current column width first and only ever widens, never
// narrows, so no existing text is cut. Run it BEFORE restarting the Node app: the new code accepts the longer text, and until the columns are wider a long task would fail to save.
// Nothing is dropped, renamed or rewritten, and the NOT NULL / NULL setting of each column is kept.
//
//   node scripts/alter-widen-crm-task-text.js

const WANT = [['title', 510, 'NOT NULL'], ['details', 2000, 'NULL']];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const [t] = await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, 'crm_tasks']);
  if (!t.length) { console.error('Stopped: crm_tasks does not exist here. Nothing was changed.'); process.exit(1); }
  for (const [col, len, nullable] of WANT) {
    const [[c]] = await db.query('SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, 'crm_tasks', col]);
    if (!c) { console.error(`Stopped: crm_tasks.${col} is not there. Nothing was changed.`); process.exit(1); }
    if (c.DATA_TYPE !== 'varchar') { console.log(`Skipped: crm_tasks.${col} is ${c.DATA_TYPE}, not a varchar; left as it is.`); continue; }
    if (Number(c.len) >= len) { console.log(`Skipped: crm_tasks.${col} already holds ${c.len} characters.`); continue; }
    await db.query(`ALTER TABLE crm_tasks MODIFY COLUMN ${col} VARCHAR(${len}) ${nullable}`);
    console.log(`Widened crm_tasks.${col} from ${c.len} to ${len} characters.`);
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

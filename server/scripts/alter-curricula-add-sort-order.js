require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  if (await columnExists(connection, 'curricula', 'sort_order')) {
    console.log('Skipped: sort_order column already exists on curricula');
    await connection.end();
    return;
  }

  await connection.query(
    'ALTER TABLE curricula ADD COLUMN sort_order INT UNSIGNED NOT NULL DEFAULT 0'
  );
  console.log('Added sort_order column to curricula');

  // Backfill: assign 1, 2, 3… in current newest-first order so existing display order is preserved
  const [rows] = await connection.query('SELECT id FROM curricula ORDER BY created_at DESC');
  for (let i = 0; i < rows.length; i++) {
    await connection.query('UPDATE curricula SET sort_order = ? WHERE id = ?', [i + 1, rows[i].id]);
  }
  console.log(`Backfilled sort_order for ${rows.length} curricula`);

  await connection.end();
}

main().catch(err => { console.error(err); process.exit(1); });

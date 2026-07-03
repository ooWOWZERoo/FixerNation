require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const COLUMNS = [
  { name: 'kindle_price', ddl: 'DECIMAL(10,2)' },
  { name: 'kindle_url', ddl: 'VARCHAR(512)' },
  { name: 'hardcover_price', ddl: 'DECIMAL(10,2)' },
  { name: 'hardcover_url', ddl: 'VARCHAR(512)' },
  { name: 'paperback_price', ddl: 'DECIMAL(10,2)' },
  { name: 'paperback_url', ddl: 'VARCHAR(512)' },
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const col of COLUMNS) {
    const [existing] = await connection.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [process.env.DB_NAME, 'books', col.name]
    );
    if (existing.length) {
      console.log(`Skipped (already exists): ${col.name}`);
      continue;
    }
    await connection.query(`ALTER TABLE books ADD COLUMN ${col.name} ${col.ddl}`);
    console.log(`Added column: ${col.name}`);
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

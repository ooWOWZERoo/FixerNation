require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'quote_requests' AND COLUMN_NAME IN ('status','notes')`,
    [process.env.DB_NAME]
  );
  const existing = cols.map(c => c.COLUMN_NAME);

  if (!existing.includes('status')) {
    await connection.query(
      `ALTER TABLE quote_requests
       ADD COLUMN status ENUM('new','contacted','converted','closed') NOT NULL DEFAULT 'new'
       AFTER message`
    );
    console.log('Added column: quote_requests.status');
  } else {
    console.log('Skipped (already exists): quote_requests.status');
  }

  if (!existing.includes('notes')) {
    await connection.query(
      `ALTER TABLE quote_requests ADD COLUMN notes TEXT AFTER status`
    );
    console.log('Added column: quote_requests.notes');
  } else {
    console.log('Skipped (already exists): quote_requests.notes');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

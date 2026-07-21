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

  const [tables] = await connection.query("SHOW TABLES LIKE 'curriculum_downloads'");
  console.log('1. curriculum_downloads table exists:', tables.length > 0);

  const [curRows] = await connection.query(
    'SELECT id, title, download_limit FROM curricula WHERE id = 144'
  );
  console.log('2. Curriculum 144:', curRows[0] || 'NOT FOUND');

  if (tables.length > 0) {
    const [dlRows] = await connection.query(
      'SELECT * FROM curriculum_downloads WHERE curriculum_id = 144'
    );
    console.log('3. Download records for curriculum 144:', dlRows.length ? dlRows : '(none)');
  } else {
    console.log('3. Skipped — table does not exist');
  }

  await connection.end();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

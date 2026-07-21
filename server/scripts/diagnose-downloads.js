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

  // 1. Table exists?
  const [tables] = await connection.query("SHOW TABLES LIKE 'curriculum_downloads'");
  const tableExists = tables.length > 0;
  console.log('1. curriculum_downloads table exists:', tableExists);

  // 2. Download limit for curriculum 144
  const [curRows] = await connection.query(
    'SELECT id, title, download_limit FROM curricula WHERE id = 144'
  );
  console.log('2. Curriculum 144:', curRows[0] || 'NOT FOUND');

  // 3. Existing records
  if (tableExists) {
    const [dlRows] = await connection.query(
      'SELECT * FROM curriculum_downloads WHERE curriculum_id = 144'
    );
    console.log('3. Download records for curriculum 144:', dlRows.length ? dlRows : '(none)');
  }

  // 4. Teacher site_user record
  const [suRows] = await connection.query(
    "SELECT id, email, first_name, last_name FROM site_users WHERE email = 'johnfshaw@yahoo.com'"
  );
  console.log('4. site_users record:', suRows[0] || 'NOT FOUND');

  // 5. Teacher has active license?
  if (suRows[0]) {
    const [lsRows] = await connection.query(
      'SELECT ls.id, ls.purchase_id, p.school_domain FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id WHERE ls.registered_site_user_id = ?',
      [suRows[0].id]
    );
    console.log('5. License seats:', lsRows.length ? lsRows : '(none — teacher has no active seat)');
  }

  // 6. Test INSERT into curriculum_downloads (then delete it)
  if (tableExists) {
    try {
      await connection.query(
        `INSERT INTO curriculum_downloads (curriculum_id, teacher_email, count, last_download)
         VALUES (144, 'test@diagnose.example', 1, NOW())
         ON DUPLICATE KEY UPDATE count = count + 1, last_download = NOW()`
      );
      await connection.query(
        "DELETE FROM curriculum_downloads WHERE teacher_email = 'test@diagnose.example'"
      );
      console.log('6. Test INSERT/DELETE: OK — DB user has write permission on this table');
    } catch (err) {
      console.log('6. Test INSERT FAILED:', err.message, '← this is why no records are being written');
    }
  }

  await connection.end();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

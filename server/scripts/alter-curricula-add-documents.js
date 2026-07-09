require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
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

  if (await tableExists(connection, 'curriculum_documents')) {
    console.log('Skipped (already exists): curriculum_documents');
  } else {
    await connection.query(`
      CREATE TABLE curriculum_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        curriculum_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: curriculum_documents');

    // Migrate existing lesson_document data into the new table.
    const [rows] = await connection.query(
      "SELECT id, lesson_document, lesson_document_name FROM curricula WHERE lesson_document IS NOT NULL AND lesson_document != ''"
    );
    if (rows.length) {
      await connection.query(
        'INSERT INTO curriculum_documents (curriculum_id, file_path, file_name, sort_order) VALUES ' +
        rows.map(() => '(?, ?, ?, 0)').join(', '),
        rows.flatMap(r => [r.id, r.lesson_document, r.lesson_document_name || 'Lesson Plan'])
      );
      console.log(`Migrated ${rows.length} existing lesson document(s) into curriculum_documents`);
    } else {
      console.log('No existing lesson documents to migrate');
    }
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

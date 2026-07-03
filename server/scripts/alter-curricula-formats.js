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

  if (await columnExists(connection, 'curricula', 'lessons_count')) {
    console.log('Skipped (already exists): curricula.lessons_count');
  } else {
    await connection.query('ALTER TABLE curricula ADD COLUMN lessons_count INT UNSIGNED');
    console.log('Added column: curricula.lessons_count');
  }

  if (await columnExists(connection, 'curricula', 'weeks_count')) {
    console.log('Skipped (already exists): curricula.weeks_count');
  } else {
    await connection.query('ALTER TABLE curricula ADD COLUMN weeks_count INT UNSIGNED');
    console.log('Added column: curricula.weeks_count');
  }

  if (await columnExists(connection, 'curricula', 'estimated_duration')) {
    // Best-effort carry-over: parse "5 lessons · 1 week" style text into the
    // new structured columns before the free-text column is dropped, so
    // existing curricula don't silently lose their duration data.
    const [rows] = await connection.query(
      "SELECT id, estimated_duration FROM curricula WHERE estimated_duration IS NOT NULL AND estimated_duration != ''"
    );
    for (const row of rows) {
      const lessonsMatch = row.estimated_duration.match(/(\d+)\s*lesson/i);
      const weeksMatch = row.estimated_duration.match(/(\d+)\s*week/i);
      const lessonsCount = lessonsMatch ? parseInt(lessonsMatch[1], 10) : null;
      const weeksCount = weeksMatch ? parseInt(weeksMatch[1], 10) : null;
      if (lessonsCount !== null || weeksCount !== null) {
        await connection.query('UPDATE curricula SET lessons_count = ?, weeks_count = ? WHERE id = ?', [lessonsCount, weeksCount, row.id]);
        console.log(`Parsed curriculum #${row.id}: "${row.estimated_duration}" -> lessons=${lessonsCount}, weeks=${weeksCount}`);
      }
    }

    await connection.query('ALTER TABLE curricula DROP COLUMN estimated_duration');
    console.log('Dropped column: curricula.estimated_duration');
  } else {
    console.log('Skipped (already dropped): curricula.estimated_duration');
  }

  if (await columnExists(connection, 'curriculum_resources', 'file_path')) {
    console.log('Skipped (already exists): curriculum_resources.file_path');
  } else {
    await connection.query('ALTER TABLE curriculum_resources ADD COLUMN file_path VARCHAR(512)');
    console.log('Added column: curriculum_resources.file_path');
  }

  if (await columnExists(connection, 'curriculum_resources', 'file_name')) {
    console.log('Skipped (already exists): curriculum_resources.file_name');
  } else {
    await connection.query('ALTER TABLE curriculum_resources ADD COLUMN file_name VARCHAR(255)');
    console.log('Added column: curriculum_resources.file_name');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

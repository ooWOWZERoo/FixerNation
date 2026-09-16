// morning_boost_email_groups.group_id had NO foreign key at all (unlike
// contact_group_members, which correctly cascades on group delete) - so
// deleting a contact_groups row anywhere left a permanently dangling,
// silently-broken reference here. That's the actual root cause behind
// Morning Boost quietly sending to only a leftover "Test Campaign" group
// for its entire operating history: a real audience group referenced by
// this config was deleted at some point, and nothing ever noticed or
// cleaned it up.
//
// This: (1) removes any already-orphaned rows (there was at least one -
// group_id 28, which no longer exists in contact_groups), (2) adds the FK
// with ON DELETE CASCADE so this can never happen again - deleting a group
// automatically and correctly removes it from any Morning Boost config too.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function constraintExists(conn, table, constraintName) {
  const [rows] = await conn.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [process.env.DB_NAME, table, constraintName]
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

  if (await constraintExists(connection, 'morning_boost_email_groups', 'fk_mb_email_groups_group')) {
    console.log('Skipped (already exists): fk_mb_email_groups_group');
  } else {
    const [orphaned] = await connection.query(
      `SELECT mbg.config_id, mbg.group_id FROM morning_boost_email_groups mbg
       LEFT JOIN contact_groups cg ON cg.id = mbg.group_id
       WHERE cg.id IS NULL`
    );
    if (orphaned.length) {
      console.log(`Found ${orphaned.length} orphaned row(s), removing:`, orphaned);
      await connection.query(
        `DELETE mbg FROM morning_boost_email_groups mbg
         LEFT JOIN contact_groups cg ON cg.id = mbg.group_id
         WHERE cg.id IS NULL`
      );
    } else {
      console.log('No orphaned rows found.');
    }

    await connection.query(
      `ALTER TABLE morning_boost_email_groups
       ADD CONSTRAINT fk_mb_email_groups_group
       FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE`
    );
    console.log('Added FK: morning_boost_email_groups.group_id -> contact_groups.id ON DELETE CASCADE');
  }

  await connection.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

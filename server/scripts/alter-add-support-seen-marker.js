require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Release 118: adds support_requests.requester_seen_message_id -- the newest staff reply a person has opened, so their list can show a
// "New reply" tag (replies are read on the Get help page, not emailed). Idempotent. Run it BEFORE restarting the Node app: the
// person-side routes read the column.
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [cols] = await connection.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'support_requests' AND COLUMN_NAME = 'requester_seen_message_id'`,
    [process.env.DB_NAME]
  );
  if (cols.length) {
    console.log('Skipped: support_requests.requester_seen_message_id already exists.');
  } else {
    await connection.query('ALTER TABLE support_requests ADD COLUMN requester_seen_message_id INT UNSIGNED NOT NULL DEFAULT 0');
    // Replies that existed before this column are treated as already seen, so nobody gets a New reply tag for old answers.
    const [r] = await connection.query(
      `UPDATE support_requests sr SET requester_seen_message_id =
         COALESCE((SELECT MAX(m.id) FROM support_request_messages m WHERE m.request_id = sr.id AND m.author_type = 'staff' AND m.visibility = 'public'), 0)`
    );
    console.log(`Added requester_seen_message_id to support_requests (${r.affectedRows} existing request(s) marked as seen).`);
  }
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Emailing a prospect demo invitation (docs/reference/demo-invitation-email-requirements.md, phase 1). Creates public_demo_invitation_recipients: one row for every
// attempt to email an invitation to a person, sent or failed. It never holds the message, the access code or any secret, and has no foreign key to
// newsletter_contacts (deleting a contact must not cascade into it; the timeline matches by address).
// Idempotent; safe to re-run. Run it BEFORE restarting the Node app on the release that needs it (the Email block on the Demo page reads it).
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [existing] = await connection.query(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'public_demo_invitation_recipients'");
  if (existing.length) {
    console.log('public_demo_invitation_recipients is already in place.');
  } else {
    await connection.query(`
      CREATE TABLE public_demo_invitation_recipients (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        invitation_id INT UNSIGNED NOT NULL,
        contact_id INT UNSIGNED NULL,
        email VARCHAR(255) NOT NULL,
        result VARCHAR(12) NOT NULL,        -- 'sent' | 'failed'
        error_code VARCHAR(30) NULL,        -- the mail server's code only, never its message
        sent_by VARCHAR(80) NOT NULL,
        sent_at DATETIME NOT NULL,          -- UTC
        INDEX idx_pdir_invitation (invitation_id, sent_at),
        INDEX idx_pdir_email (email, sent_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created public_demo_invitation_recipients.');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

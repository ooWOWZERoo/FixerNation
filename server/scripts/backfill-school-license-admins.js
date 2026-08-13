// Backfills school_license_admins rows for quote-acceptance accounts that were
// created before the auto-registration fix. Safe to re-run — INSERT IGNORE
// skips rows that already exist (unique key: site_user_id + purchase_id).
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

  // Find accepted quotes that have a purchase and a site_user but no admin row
  const [candidates] = await connection.query(`
    SELECT
      qr.id     AS quote_id,
      qr.email,
      qr.first_name,
      qr.last_name,
      p.id      AS purchase_id,
      su.id     AS site_user_id,
      su.role   AS current_role
    FROM quote_requests qr
    JOIN purchases p        ON p.quote_id = qr.id
    JOIN site_users su      ON LOWER(su.email) = LOWER(qr.email)
    LEFT JOIN school_license_admins sla
                            ON sla.site_user_id = su.id AND sla.purchase_id = p.id
    WHERE qr.accepted_at IS NOT NULL
      AND sla.id IS NULL
    ORDER BY qr.accepted_at
  `);

  if (!candidates.length) {
    console.log('Nothing to backfill — all accepted quotes already have admin rows.');
    await connection.end();
    return;
  }

  console.log(`Found ${candidates.length} quote(s) to backfill:\n`);

  let inserted = 0;
  for (const row of candidates) {
    console.log(`  Quote #${row.quote_id} | ${row.email} | purchase ${row.purchase_id}`);

    // Upgrade role if needed (don't demote an existing admin)
    if (!['admin', 'school_license_admin'].includes(row.current_role)) {
      await connection.query(
        "UPDATE site_users SET role = 'school_license_admin' WHERE id = ?",
        [row.site_user_id]
      );
    }

    const [result] = await connection.query(
      "INSERT IGNORE INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active) VALUES (?, ?, 'primary', 1)",
      [row.site_user_id, row.purchase_id]
    );
    if (result.affectedRows) inserted++;
  }

  console.log(`\nDone. Inserted ${inserted} row(s) into school_license_admins.`);
  await connection.end();
}

main().catch(err => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});

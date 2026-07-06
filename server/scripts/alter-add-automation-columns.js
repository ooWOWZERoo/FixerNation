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

  // email_automations is a brand-new table — migrate.js's CREATE TABLE IF NOT
  // EXISTS already handles it. This script only covers the two new columns
  // on the pre-existing membership_plans/contact_memberships tables.

  if (await columnExists(connection, 'membership_plans', 'duration_days')) {
    console.log('Skipped (already exists): membership_plans.duration_days');
  } else {
    await connection.query('ALTER TABLE membership_plans ADD COLUMN duration_days INT UNSIGNED NULL');
    console.log('Added column: membership_plans.duration_days');

    // One-time backfill for the 7 plans seeded before this column existed —
    // without this, no already-live plan would ever get an ends_at computed
    // or a renewal reminder, defeating the point of this feature for
    // anything that already signed up. Matches server/scripts/seed-membership-plans.js's durationDays values.
    const BACKFILL = {
      'Free w/ Book Purchase': 90,
      'Fixer Nation Monthly Membership': 30,
      'Fixer Nation Annual Membership': 365,
      'Fixer Nation Service Providers - Monthly': 30,
      'Fixer Nation Service Providers - Annual': 365,
      'Registration 2D Education Program': 365,
      'Fixer Nation Brand Ambassador': 365,
    };
    for (const [name, days] of Object.entries(BACKFILL)) {
      const [result] = await connection.query('UPDATE membership_plans SET duration_days = ? WHERE name = ?', [days, name]);
      if (result.affectedRows > 0) console.log(`Backfilled duration_days=${days} for "${name}"`);
    }
  }

  if (await columnExists(connection, 'contact_memberships', 'reminder_sent_at')) {
    console.log('Skipped (already exists): contact_memberships.reminder_sent_at');
  } else {
    await connection.query('ALTER TABLE contact_memberships ADD COLUMN reminder_sent_at DATETIME NULL');
    console.log('Added column: contact_memberships.reminder_sent_at');
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

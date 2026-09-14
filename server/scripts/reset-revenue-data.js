// One-time pre-launch reset of revenue/financial dashboard data — the
// admin-dashboard.html "Financial Insights" section's backing tables:
// purchases, invoices, quote_requests. Scoped to ONLY these (plus what
// cascades from purchases via FK) — does not touch analytics, campaigns,
// or anything else. Every row was individually verified (2026-09-05) to be
// test/internal data: qa-*@example.com accounts, the internal
// vssus.com/fixernation.org staff domains, or the developer's own
// dogfooding account. Zero real customers or real leads existed at the
// time this ran.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function count(connection, table) {
  const [[row]] = await connection.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return row.n;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  console.log('Before:');
  console.log('  purchases:', await count(connection, 'purchases'));
  console.log('  license_seats:', await count(connection, 'license_seats'));
  console.log('  school_license_admins:', await count(connection, 'school_license_admins'));
  console.log('  invoices:', await count(connection, 'invoices'));
  console.log('  quote_requests:', await count(connection, 'quote_requests'));

  // purchases cascades (ON DELETE CASCADE) to license_seats,
  // school_license_admins, and school_invitations automatically.
  await connection.query('DELETE FROM purchases');
  await connection.query('DELETE FROM invoices');
  await connection.query('DELETE FROM quote_requests');

  console.log('\nAfter:');
  console.log('  purchases:', await count(connection, 'purchases'));
  console.log('  license_seats:', await count(connection, 'license_seats'));
  console.log('  school_license_admins:', await count(connection, 'school_license_admins'));
  console.log('  invoices:', await count(connection, 'invoices'));
  console.log('  quote_requests:', await count(connection, 'quote_requests'));

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

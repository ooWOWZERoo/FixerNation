// Read-only — dumps the TRUE live schema straight from the database via
// SHOW CREATE TABLE for every table, since server/db/schema.sql is a known
// stale/incomplete source of truth (many tables and columns only ever
// arrived via one-off alter-*.js scripts, never backfilled into schema.sql).
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [tables] = await conn.query('SHOW TABLES');
  const tableKey = Object.keys(tables[0])[0];
  const tableNames = tables.map(t => t[tableKey]).sort();

  console.log(`-- Live schema dump — ${process.env.DB_NAME} — ${tableNames.length} tables`);
  console.log(`-- Generated ${new Date().toISOString()}\n`);

  for (const name of tableNames) {
    const [[row]] = await conn.query('SHOW CREATE TABLE `' + name + '`');
    console.log(row['Create Table'] + ';\n');
  }

  await conn.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

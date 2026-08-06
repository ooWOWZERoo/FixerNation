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

  const [result] = await conn.query(
    "UPDATE curriculum_materials SET material = REPLACE(material, '*', '') WHERE material LIKE '%*%'"
  );
  console.log(`Updated ${result.affectedRows} material row(s) — asterisks removed.`);

  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });

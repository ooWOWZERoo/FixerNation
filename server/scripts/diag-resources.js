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

  // All distinct resource names in use
  const [distinct] = await conn.query(
    'SELECT DISTINCT resource FROM curriculum_resources ORDER BY resource'
  );
  console.log('\n=== All distinct resource names in curriculum_resources ===');
  distinct.forEach(r => console.log(JSON.stringify(r.resource)));

  // Resources for the specific "Finish What You Started" curricula
  const [rows] = await conn.query(
    `SELECT c.id, c.title, cr.resource, cr.file_name
     FROM curricula c
     JOIN curriculum_resources cr ON cr.curriculum_id = c.id
     WHERE c.title LIKE '%Finish What You Started%'
     ORDER BY c.id, cr.resource`
  );
  console.log('\n=== Resources on "Finish What You Started" curricula ===');
  rows.forEach(r => console.log(`[${r.id}] ${r.title}  →  ${JSON.stringify(r.resource)}  (${r.file_name || 'no file'})`));

  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });

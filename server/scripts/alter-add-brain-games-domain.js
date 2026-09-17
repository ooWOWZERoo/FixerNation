// Tune Your Brain — adds brain_games.domain and brain_games.casel_competencies
// so the catalog page (brain-games.html) can filter by learning domain and
// so SEL-competency coverage is queryable, per roadmap §6.1 (five domains)
// and §6.4 (CASEL competency mapping). Prompted by
// docs/tune-your-brain/GAP_ANALYSIS_2026-09-17.md's SEL-coverage finding.
//
// casel_competencies is a SET, not a join table — deliberately simple for
// the 2 games that need it today (Decision Point, Choice Quest); revisit
// if/when enough SEL content exists to justify a real many-to-many model.
//
// Safe to re-run: each column is skipped if it already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(conn, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
    [process.env.DB_NAME, 'brain_games', column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  if (await columnExists(conn, 'domain')) {
    console.log('Skipped: brain_games.domain already exists');
  } else {
    await conn.query(
      `ALTER TABLE brain_games
         ADD COLUMN domain ENUM('literacy','math','executive','sel','wellness') NULL`
    );
    console.log('Added: brain_games.domain');
  }

  if (await columnExists(conn, 'casel_competencies')) {
    console.log('Skipped: brain_games.casel_competencies already exists');
  } else {
    await conn.query(
      `ALTER TABLE brain_games
         ADD COLUMN casel_competencies SET(
           'self_awareness','self_management','social_awareness',
           'relationship_skills','responsible_decision_making'
         ) NULL`
    );
    console.log('Added: brain_games.casel_competencies');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });

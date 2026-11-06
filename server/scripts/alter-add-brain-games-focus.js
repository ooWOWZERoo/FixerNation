// Release 137 - adds brain_games.focus: the one field the games page filters on and the coverage grid counts.
// Five SEL competencies (self_awareness, self_management, social_awareness, relationship_skills, responsible_decision_making)
// for the SEL games and literacy / math / thinking for the skills games. `domain` and `casel_competencies` stay as they were
// (casel_competencies becomes the secondary list). Values are written by seed-brain-games-focus-values.js.
// See docs/reference/games-focus-regroup-requirements.md.
//
// Safe to re-run: skipped if the column already exists. Run it BEFORE restarting the Node app.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [existing] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
    [process.env.DB_NAME, 'brain_games', 'focus']
  );

  if (existing.length) {
    console.log('Skipped: brain_games.focus already exists');
  } else {
    try {
      await conn.query(
        `ALTER TABLE brain_games
           ADD COLUMN focus ENUM('self_awareness','self_management','social_awareness','relationship_skills','responsible_decision_making','literacy','math','thinking') NULL`
      );
      console.log('Added: brain_games.focus');
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') console.log('Skipped: brain_games.focus already exists');
      else throw err;
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });

// Tune Your Brain — populates brain_games.domain (the 14 original games) and
// brain_games.casel_competencies (Decision Point, Choice Quest and the two money games) per
// roadmap §6.1/§6.4. See alter-add-brain-games-domain.js's header comment.
// 2026-11-01: Money Matters and Money Moves moved from 'wellness' to 'sel' (the owner decided
// they are SEL games: goals and plans, NY SEL 1C and 3B), with CASEL competencies added. Games
// added later set their own domain and competencies in their seed-*-catalog-entry.js scripts.
//
// Safe to re-run: idempotent UPDATEs, always sets the same values.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DOMAINS = {
  'memory-match': 'executive',
  'reaction-time': 'executive',
  'simon-sequence': 'executive',
  'stroop-challenge': 'executive',
  'number-sequence': 'math', // Release 137: pattern arithmetic, so math (was executive)
  'quick-math': 'math',
  'sound-safari': 'literacy',
  'reading-detective': 'literacy',
  'headline': 'literacy',
  'critical-read': 'literacy',
  'decision-point': 'sel',
  'choice-quest': 'sel',
  'money-matters': 'sel',
  'money-moves': 'sel',
};

const CASEL_COMPETENCIES = {
  'decision-point': 'social_awareness,relationship_skills,responsible_decision_making',
  'choice-quest': 'social_awareness,relationship_skills,responsible_decision_making',
  'money-matters': 'self_management,responsible_decision_making',
  'money-moves': 'self_management,responsible_decision_making',
};

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  for (const [slug, domain] of Object.entries(DOMAINS)) {
    const [result] = await conn.query('UPDATE brain_games SET domain=? WHERE slug=?', [domain, slug]);
    if (result.affectedRows) {
      console.log(`Set ${slug} domain -> ${domain}`);
    } else {
      console.warn(`Warning: no brain_games row found for slug '${slug}'`);
    }
  }

  for (const [slug, competencies] of Object.entries(CASEL_COMPETENCIES)) {
    await conn.query('UPDATE brain_games SET casel_competencies=? WHERE slug=?', [competencies, slug]);
    console.log(`Set ${slug} casel_competencies -> ${competencies}`);
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });

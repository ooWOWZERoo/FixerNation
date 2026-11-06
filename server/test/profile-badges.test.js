// A Community profile shows featured badges first, then the 6 latest earned ones when none are featured. Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { profileBadges } = require('../lib/profile-badges');

const sql = new DatabaseSync(':memory:');
sql.exec(`
CREATE TABLE brain_badges (id INTEGER PRIMARY KEY, name TEXT, emoji TEXT, rarity TEXT);
CREATE TABLE user_brain_badges (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, badge_id INTEGER, earned_at TEXT, featured INTEGER DEFAULT 0, featured_position INTEGER);
`);
for (let i = 1; i <= 8; i++) sql.prepare('INSERT INTO brain_badges VALUES (?,?,?,?)').run(i, `Badge ${i}`, '🏅', 'common');
const db = { query: async (q, p) => [sql.prepare(q).all(...p)] };
const earn = (user, badge, day, featured, pos) => sql.prepare('INSERT INTO user_brain_badges (user_id, badge_id, earned_at, featured, featured_position) VALUES (?,?,?,?,?)').run(user, badge, `2026-11-0${day} 10:00:00`, featured, pos);

test('a person who earned badges but featured none still sees their 6 latest', async () => {
  for (let i = 1; i <= 8; i++) earn(1, i, Math.min(i, 9), 0, null);
  const r = await profileBadges(db, 1);
  assert.equal(r.featured, false);
  assert.equal(r.badges.length, 6);
  assert.equal(r.badges[0].name, 'Badge 8', 'newest first');
});

test('featured badges win, in their chosen order, and only those show', async () => {
  earn(2, 5, 3, 1, 2); earn(2, 6, 4, 1, 1); earn(2, 7, 5, 0, null);
  const r = await profileBadges(db, 2);
  assert.equal(r.featured, true);
  assert.deepEqual(r.badges.map((b) => b.name), ['Badge 6', 'Badge 5']);
});

test('a person with no badges gets an empty list, and another person\'s badges never leak in', async () => {
  const r = await profileBadges(db, 99);
  assert.deepEqual(r, { badges: [], featured: false });
});

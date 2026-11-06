// Which Brain Games badges a Community profile shows. A person can feature up to 6 on the badges page; those come first.
// Until they feature any, the profile shows their 6 most recently earned badges instead of an empty box, because a person who
// has earned badges but never found the "feature" button used to see "No featured badges yet" on their own profile.
// `featured` in the result says which of the two it is, so the page can explain it.
// Portable SQL (no NOW(), no array params) so the test runs it on node:sqlite.
async function profileBadges(db, userId) {
  const base = `SELECT b.name, b.emoji, b.rarity, ub.featured_position
                FROM user_brain_badges ub JOIN brain_badges b ON b.id = ub.badge_id
                WHERE ub.user_id = ?`;
  const [featured] = await db.query(`${base} AND ub.featured = 1 ORDER BY ub.featured_position`, [userId]);
  if (featured.length) return { badges: featured, featured: true };
  const [recent] = await db.query(`${base} ORDER BY ub.earned_at DESC, ub.id DESC LIMIT 6`, [userId]);
  return { badges: recent, featured: false };
}

module.exports = { profileBadges };

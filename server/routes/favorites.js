// Favorites for lessons and games, and one list of everything a person has starred (Release 165).
// Access matrix (docs/reference/game-pages-parent-view-favorites-requirements.md, section 3): signed out = nothing (401); any signed-in
// site user = their own favorites only, adding a published lesson or an active game, removing always; students (PIN logins) and the
// admin session have no access. The user id always comes from the session, never from the request. Limits: 500 per kind per user,
// 60 changes a minute per user. Morning Boost posts keep their own route (routes/blog-favorites.js); this route only lists them,
// so the browser can read all three kinds in one request.
const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { limiter } = require('../lib/rate-limit');
const { pilotEnabledForUser } = require('../lib/game-pages');

const router = express.Router();
const MAX_FAVORITES = 500;
const changeLimit = limiter({ name: 'favorite-change', windowMs: 60 * 1000, max: 60, key: (req) => (req.siteUser ? String(req.siteUser.id) : null) });

// Table and column names are fixed constants here, never request input.
const KINDS = {
  lessons: { table: 'lesson_favorites', col: 'curriculum_id' },
  games: { table: 'game_favorites', col: 'game_id' },
};

async function countFor(kind, userId) {
  const k = KINDS[kind];
  const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${k.table} WHERE site_user_id = ?`, [userId]);
  return Number(row && row.n) || 0;
}

// GET /api/favorites  ->  { posts: [ids], lessons: [ids], games: [ids] }  live items only, newest star first.
router.get('/', requireSiteAuth, async (req, res) => {
  const userId = req.siteUser.id;
  const pilot = await pilotEnabledForUser(userId);
  const [posts] = await pool.query(
    `SELECT f.post_id AS id FROM blog_post_favorites f JOIN blog_posts p ON p.id = f.post_id
     WHERE f.site_user_id = ? AND p.published = 1 AND (p.publish_date IS NULL OR p.publish_date <= CURDATE())
     ORDER BY f.created_at DESC, f.post_id DESC`, [userId]);
  const [lessons] = await pool.query(
    `SELECT f.curriculum_id AS id FROM lesson_favorites f JOIN curricula c ON c.id = f.curriculum_id
     WHERE f.site_user_id = ? AND c.published = 1
     ORDER BY f.created_at DESC, f.curriculum_id DESC`, [userId]);
  const [games] = await pool.query(
    `SELECT f.game_id AS id FROM game_favorites f JOIN brain_games g ON g.id = f.game_id
     WHERE f.site_user_id = ? AND g.active = 1 AND (g.reward_pipeline <> 'classroom_generic' OR ? = 1)
     ORDER BY f.created_at DESC, f.game_id DESC`, [userId, pilot ? 1 : 0]);
  res.json({ posts: posts.map((r) => Number(r.id)), lessons: lessons.map((r) => Number(r.id)), games: games.map((r) => Number(r.id)) });
});

// PUT /api/favorites/lessons/:id and /api/favorites/games/:id   body { favorited: true | false }  ->  { ok, favorited, count }
// A set, not a toggle, so a repeated tap or a second open tab can never flip it the wrong way.
async function setFavorite(kind, req, res) {
  const k = KINDS[kind];
  if (typeof req.params.id !== 'string' || !/^\d{1,10}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const id = Number(req.params.id);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof body.favorited !== 'boolean') return res.status(400).json({ error: 'favorited must be true or false' });
  const userId = req.siteUser.id;

  if (!body.favorited) {
    await pool.query(`DELETE FROM ${k.table} WHERE site_user_id = ? AND ${k.col} = ?`, [userId, id]);
    return res.json({ ok: true, favorited: false, count: await countFor(kind, userId) });
  }

  if (kind === 'lessons') {
    const [[row]] = await pool.query('SELECT id FROM curricula WHERE id = ? AND published = 1', [id]);
    if (!row) return res.status(404).json({ error: 'Lesson not found' });
  } else {
    const [[row]] = await pool.query('SELECT id, reward_pipeline FROM brain_games WHERE id = ? AND active = 1', [id]);
    if (!row || (row.reward_pipeline === 'classroom_generic' && !(await pilotEnabledForUser(userId)))) return res.status(404).json({ error: 'Game not found' });
  }

  const [[have]] = await pool.query(`SELECT ${k.col} AS id FROM ${k.table} WHERE site_user_id = ? AND ${k.col} = ?`, [userId, id]);
  if (!have) {
    if ((await countFor(kind, userId)) >= MAX_FAVORITES) return res.status(409).json({ error: `You can keep up to ${MAX_FAVORITES} favorites. Remove one to add another.` });
    try {
      await pool.query(`INSERT INTO ${k.table} (site_user_id, ${k.col}) VALUES (?, ?)`, [userId, id]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' && !/UNIQUE|PRIMARY KEY/i.test(String(err.message))) throw err; // a second request got there first: same result
    }
  }
  res.json({ ok: true, favorited: true, count: await countFor(kind, userId) });
}

router.put('/lessons/:id', requireSiteAuth, changeLimit, (req, res) => setFavorite('lessons', req, res));
router.put('/games/:id', requireSiteAuth, changeLimit, (req, res) => setFavorite('games', req, res));

module.exports = router;
module.exports.MAX_FAVORITES = MAX_FAVORITES;

// Favorites for blog posts, which includes Morning Boost (Release 91). A signed-in site user stars posts and can list their own stars.
// Access matrix (confirmed before building): signed out = nothing (401); any signed-in site user = their own favorites only, adding a post
// that is published, not future-dated and not locked for them (locked posts need an active license), removing always; students and the
// admin session have no access. The user id always comes from the session, never from the request, so nobody can read or change another
// person's favorites. Limits: 500 per user, 60 changes a minute per user.
const express = require('express');
const pool = require('../db/pool');
const { requireSiteAuth } = require('./site-auth');
const { hasActiveLicense } = require('../lib/access');
const { limiter } = require('../lib/rate-limit');

const router = express.Router();
const MAX_FAVORITES = 500;
const changeLimit = limiter({ name: 'blog-favorite', windowMs: 60 * 1000, max: 60, key: (req) => (req.siteUser ? String(req.siteUser.id) : null) });
// The same rule the public posts list uses (routes/blog.js): published, and a scheduled post stays hidden until its date.
const LIVE = 'published = 1 AND (publish_date IS NULL OR publish_date <= CURDATE())';

async function countFor(userId) {
  const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM blog_post_favorites WHERE site_user_id = ?', [userId]);
  return Number(row && row.n) || 0;
}

// GET /api/blog-favorites  ->  { ids: [...] }  the user's starred posts that are live now, newest star first.
// Declared before the /:postId route (Express would otherwise read "" as an id).
router.get('/', requireSiteAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT f.post_id FROM blog_post_favorites f JOIN blog_posts p ON p.id = f.post_id
     WHERE f.site_user_id = ? AND p.published = 1 AND (p.publish_date IS NULL OR p.publish_date <= CURDATE())
     ORDER BY f.created_at DESC, f.post_id DESC`,
    [req.siteUser.id]
  );
  res.json({ ids: rows.map((r) => Number(r.post_id)) });
});

// PUT /api/blog-favorites/:postId  body { favorited: true | false }  ->  { ok, favorited, count }
// A set, not a toggle, so a repeated tap or a second open tab can never flip it the wrong way.
router.put('/:postId', requireSiteAuth, changeLimit, async (req, res) => {
  if (typeof req.params.postId !== 'string' || !/^\d{1,10}$/.test(req.params.postId)) return res.status(400).json({ error: 'Invalid post' });
  const postId = Number(req.params.postId);
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof body.favorited !== 'boolean') return res.status(400).json({ error: 'favorited must be true or false' });
  const userId = req.siteUser.id;

  if (!body.favorited) {
    await pool.query('DELETE FROM blog_post_favorites WHERE site_user_id = ? AND post_id = ?', [userId, postId]);
    return res.json({ ok: true, favorited: false, count: await countFor(userId) });
  }

  const [[post]] = await pool.query(`SELECT id, requires_membership FROM blog_posts WHERE id = ? AND ${LIVE}`, [postId]);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.requires_membership && !(await hasActiveLicense(userId))) return res.status(403).json({ error: 'This post needs an active license.' });

  const [[have]] = await pool.query('SELECT post_id FROM blog_post_favorites WHERE site_user_id = ? AND post_id = ?', [userId, postId]);
  if (!have) {
    if ((await countFor(userId)) >= MAX_FAVORITES) return res.status(409).json({ error: `You can keep up to ${MAX_FAVORITES} favorites. Remove one to add another.` });
    try {
      await pool.query('INSERT INTO blog_post_favorites (site_user_id, post_id) VALUES (?, ?)', [userId, postId]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err; // a second request got there first: same result
    }
  }
  res.json({ ok: true, favorited: true, count: await countFor(userId) });
});

module.exports = router;
module.exports.MAX_FAVORITES = MAX_FAVORITES;

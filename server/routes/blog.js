const express = require('express');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');

const router = express.Router();

async function attachTags(posts) {
  if (posts.length === 0) return posts;
  const [tagRows] = await pool.query('SELECT post_id, tag FROM blog_post_tags WHERE post_id IN (?)', [posts.map(p => p.id)]);
  const tagsByPost = {};
  tagRows.forEach(row => { (tagsByPost[row.post_id] = tagsByPost[row.post_id] || []).push(row.tag); });
  return posts.map(p => ({ ...p, tags: tagsByPost[p.id] || [] }));
}

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    author: row.author,
    category: row.category,
    featuredImage: row.featured_image,
    excerpt: row.excerpt,
    body: row.body,
    videoUrl: row.video_url,
    videoFileName: row.video_file_name,
    videoFileSize: row.video_file_size_label,
    publishDate: row.publish_date,
    featured: !!row.featured,
    published: !!row.published,
    createdAt: row.created_at,
    tags: row.tags || [],
  };
}

router.get('/posts', async (req, res) => {
  const wantsAll = req.query.all === 'true' && !!getAuthUser(req);
  const [rows] = wantsAll
    ? await pool.query('SELECT * FROM blog_posts ORDER BY publish_date DESC')
    : await pool.query('SELECT * FROM blog_posts WHERE published = 1 ORDER BY publish_date DESC');
  const posts = (await attachTags(rows)).map(serialize);
  res.json({ posts });
});

async function findUniqueSlug(baseSlug, excludeId) {
  let slug = baseSlug;
  let n = 2;
  while (true) {
    const [rows] = excludeId
      ? await pool.query('SELECT id FROM blog_posts WHERE slug = ? AND id != ?', [slug, excludeId])
      : await pool.query('SELECT id FROM blog_posts WHERE slug = ?', [slug]);
    if (!rows.length) return slug;
    slug = `${baseSlug}-${n}`;
    n++;
  }
}

router.post('/posts', requireAuth, async (req, res) => {
  const p = req.body || {};
  if (!p.title || !p.category) {
    return res.status(400).json({ error: 'Title and category are required' });
  }
  const slug = await findUniqueSlug(p.slug || p.title, null);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (p.featured) {
      await connection.query('UPDATE blog_posts SET featured = 0');
    }
    const [result] = await connection.query(
      `INSERT INTO blog_posts (title, slug, author, category, featured_image, excerpt, body, video_url, video_file_name, video_file_size_label, publish_date, featured, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.title, slug, p.author || '', p.category, p.featuredImage || '', p.excerpt || '', p.body || '', p.videoUrl || '', p.videoFileName || '', p.videoFileSize || '', p.publishDate || null, p.featured ? 1 : 0, p.published ? 1 : 0]
    );
    const tags = Array.isArray(p.tags) ? p.tags : [];
    if (tags.length) {
      await connection.query('INSERT INTO blog_post_tags (post_id, tag) VALUES ' + tags.map(() => '(?, ?)').join(', '), tags.flatMap(t => [result.insertId, t]));
    }
    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM blog_posts WHERE id = ?', [result.insertId]);
    const [post] = await attachTags(rows);
    res.status(201).json({ post: serialize(post) });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

router.put('/posts/:id', requireAuth, async (req, res) => {
  const p = req.body || {};
  if (!p.title || !p.category) {
    return res.status(400).json({ error: 'Title and category are required' });
  }
  const [existing] = await pool.query('SELECT id FROM blog_posts WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Post not found' });

  const slug = await findUniqueSlug(p.slug || p.title, req.params.id);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (p.featured) {
      await connection.query('UPDATE blog_posts SET featured = 0 WHERE id != ?', [req.params.id]);
    }
    await connection.query(
      `UPDATE blog_posts SET title=?, slug=?, author=?, category=?, featured_image=?, excerpt=?, body=?, video_url=?, video_file_name=?, video_file_size_label=?, publish_date=?, featured=?, published=?
       WHERE id=?`,
      [p.title, slug, p.author || '', p.category, p.featuredImage || '', p.excerpt || '', p.body || '', p.videoUrl || '', p.videoFileName || '', p.videoFileSize || '', p.publishDate || null, p.featured ? 1 : 0, p.published ? 1 : 0, req.params.id]
    );
    await connection.query('DELETE FROM blog_post_tags WHERE post_id = ?', [req.params.id]);
    const tags = Array.isArray(p.tags) ? p.tags : [];
    if (tags.length) {
      await connection.query('INSERT INTO blog_post_tags (post_id, tag) VALUES ' + tags.map(() => '(?, ?)').join(', '), tags.flatMap(t => [req.params.id, t]));
    }
    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM blog_posts WHERE id = ?', [req.params.id]);
    const [post] = await attachTags(rows);
    res.json({ post: serialize(post) });
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
});

router.delete('/posts/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM blog_posts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

// --- Master tag list (growing, separate from the fixed blog categories) ---

router.get('/tags', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT tag FROM blog_tags ORDER BY tag');
  res.json({ tags: rows.map(r => r.tag) });
});

router.post('/tags', requireAuth, async (req, res) => {
  const tag = (req.body && req.body.tag || '').trim();
  if (!tag) return res.status(400).json({ error: 'Tag is required' });

  const [existing] = await pool.query('SELECT tag FROM blog_tags WHERE LOWER(tag) = LOWER(?)', [tag]);
  if (existing[0]) return res.json({ tag: existing[0].tag });

  await pool.query('INSERT INTO blog_tags (tag) VALUES (?)', [tag]);
  res.status(201).json({ tag });
});

module.exports = router;

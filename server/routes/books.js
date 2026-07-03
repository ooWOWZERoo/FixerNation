const express = require('express');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');

const router = express.Router();

async function attachTags(books) {
  if (books.length === 0) return books;
  const [tagRows] = await pool.query(
    'SELECT book_id, tag FROM book_tags WHERE book_id IN (?)',
    [books.map(b => b.id)]
  );
  const tagsByBook = {};
  tagRows.forEach(row => {
    (tagsByBook[row.book_id] = tagsByBook[row.book_id] || []).push(row.tag);
  });
  return books.map(b => ({ ...b, tags: tagsByBook[b.id] || [] }));
}

function serializeBook(row) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    coverImage: row.cover_image,
    shortDescription: row.short_description,
    longDescription: row.long_description,
    price: row.price === null ? '' : Number(row.price),
    compareAtPrice: row.compare_at_price === null ? '' : Number(row.compare_at_price),
    sku: row.sku,
    category: row.category,
    tags: row.tags || [],
    stockStatus: row.stock_status,
    amazonUrl: row.amazon_url,
    kindlePrice: row.kindle_price === null ? '' : Number(row.kindle_price),
    kindleUrl: row.kindle_url || '',
    hardcoverPrice: row.hardcover_price === null ? '' : Number(row.hardcover_price),
    hardcoverUrl: row.hardcover_url || '',
    paperbackPrice: row.paperback_price === null ? '' : Number(row.paperback_price),
    paperbackUrl: row.paperback_url || '',
    published: !!row.published,
    createdAt: row.created_at,
  };
}

// Public: published books only. Admin (authenticated): all books, via ?all=true.
router.get('/', async (req, res) => {
  const wantsAll = req.query.all === 'true' && !!getAuthUser(req);

  const [rows] = wantsAll
    ? await pool.query('SELECT * FROM books ORDER BY created_at DESC')
    : await pool.query('SELECT * FROM books WHERE published = 1 ORDER BY created_at DESC');

  const books = (await attachTags(rows)).map(serializeBook);
  res.json({ books });
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Book not found' });
  const [book] = await attachTags(rows);
  res.json({ book: serializeBook(book) });
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.title || b.price === '' || b.price === undefined || b.price === null) {
    return res.status(400).json({ error: 'Title and price are required' });
  }

  const [result] = await pool.query(
    `INSERT INTO books (title, author, cover_image, short_description, long_description, price, compare_at_price, sku, category, stock_status, amazon_url, kindle_price, kindle_url, hardcover_price, hardcover_url, paperback_price, paperback_url, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.title, b.author || '', b.coverImage || '', b.shortDescription || '', b.longDescription || '',
      b.price, b.compareAtPrice || null, b.sku || '', b.category || '', b.stockStatus || 'In Stock',
      b.amazonUrl || '',
      b.kindlePrice || null, b.kindleUrl || null,
      b.hardcoverPrice || null, b.hardcoverUrl || null,
      b.paperbackPrice || null, b.paperbackUrl || null,
      b.published ? 1 : 0,
    ]
  );

  if (Array.isArray(b.tags) && b.tags.length) {
    await pool.query(
      'INSERT INTO book_tags (book_id, tag) VALUES ' + b.tags.map(() => '(?, ?)').join(', '),
      b.tags.flatMap(tag => [result.insertId, tag])
    );
  }

  const [rows] = await pool.query('SELECT * FROM books WHERE id = ?', [result.insertId]);
  const [book] = await attachTags(rows);
  res.status(201).json({ book: serializeBook(book) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.title || b.price === '' || b.price === undefined || b.price === null) {
    return res.status(400).json({ error: 'Title and price are required' });
  }

  const [existing] = await pool.query('SELECT id FROM books WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Book not found' });

  await pool.query(
    `UPDATE books SET title=?, author=?, cover_image=?, short_description=?, long_description=?, price=?, compare_at_price=?, sku=?, category=?, stock_status=?, amazon_url=?, kindle_price=?, kindle_url=?, hardcover_price=?, hardcover_url=?, paperback_price=?, paperback_url=?, published=?
     WHERE id=?`,
    [
      b.title, b.author || '', b.coverImage || '', b.shortDescription || '', b.longDescription || '',
      b.price, b.compareAtPrice || null, b.sku || '', b.category || '', b.stockStatus || 'In Stock',
      b.amazonUrl || '',
      b.kindlePrice || null, b.kindleUrl || null,
      b.hardcoverPrice || null, b.hardcoverUrl || null,
      b.paperbackPrice || null, b.paperbackUrl || null,
      b.published ? 1 : 0, req.params.id,
    ]
  );

  await pool.query('DELETE FROM book_tags WHERE book_id = ?', [req.params.id]);
  if (Array.isArray(b.tags) && b.tags.length) {
    await pool.query(
      'INSERT INTO book_tags (book_id, tag) VALUES ' + b.tags.map(() => '(?, ?)').join(', '),
      b.tags.flatMap(tag => [req.params.id, tag])
    );
  }

  const [rows] = await pool.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
  const [book] = await attachTags(rows);
  res.json({ book: serializeBook(book) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM books WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Book not found' });
  res.json({ ok: true });
});

module.exports = router;

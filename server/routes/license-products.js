const express = require('express');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    seatCount: row.seat_count,
    price: Number(row.price_cents) / 100,
    callForQuote: !!row.call_for_quote,
    sortOrder: row.sort_order,
    active: !!row.active,
    autoAssignGroupId: row.auto_assign_group_id || null,
    createdAt: row.created_at,
  };
}

// Public: active products only, ordered for display. Admin (authenticated):
// everything including inactive/draft products, via ?all=true.
router.get('/', async (req, res) => {
  const wantsAll = req.query.all === 'true' && !!getAuthUser(req);

  const [rows] = wantsAll
    ? await pool.query('SELECT * FROM license_products ORDER BY sort_order, id')
    : await pool.query('SELECT * FROM license_products WHERE active = 1 ORDER BY sort_order, id');

  res.json({ licenseProducts: rows.map(serialize) });
});

router.get('/:id', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM license_products WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'License product not found' });
  res.json({ licenseProduct: serialize(rows[0]) });
});

router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const callForQuote = !!b.callForQuote;
  if (!b.name || !(Number(b.seatCount) > 0) || (!callForQuote && !(Number(b.price) >= 0))) {
    return res.status(400).json({ error: 'Name, a positive seat count, and (unless Call For Quote) a price are required' });
  }

  const groupId = Number(b.autoAssignGroupId) || null;
  const [result] = await pool.query(
    'INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, sort_order, active, auto_assign_group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [b.name, b.description || '', Number(b.seatCount), callForQuote ? 0 : Math.round(Number(b.price) * 100), callForQuote ? 1 : 0, Number(b.sortOrder) || 0, b.active === false ? 0 : 1, groupId]
  );

  const [rows] = await pool.query('SELECT * FROM license_products WHERE id = ?', [result.insertId]);
  res.status(201).json({ licenseProduct: serialize(rows[0]) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const b = req.body || {};
  const callForQuote = !!b.callForQuote;
  if (!b.name || !(Number(b.seatCount) > 0) || (!callForQuote && !(Number(b.price) >= 0))) {
    return res.status(400).json({ error: 'Name, a positive seat count, and (unless Call For Quote) a price are required' });
  }

  const [existing] = await pool.query('SELECT id FROM license_products WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'License product not found' });

  const groupId = Number(b.autoAssignGroupId) || null;
  await pool.query(
    'UPDATE license_products SET name=?, description=?, seat_count=?, price_cents=?, call_for_quote=?, sort_order=?, active=?, auto_assign_group_id=? WHERE id=?',
    [b.name, b.description || '', Number(b.seatCount), callForQuote ? 0 : Math.round(Number(b.price) * 100), callForQuote ? 1 : 0, Number(b.sortOrder) || 0, b.active === false ? 0 : 1, groupId, req.params.id]
  );

  const [rows] = await pool.query('SELECT * FROM license_products WHERE id = ?', [req.params.id]);
  res.json({ licenseProduct: serialize(rows[0]) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM license_products WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'License product not found' });
  res.json({ ok: true });
});

module.exports = router;

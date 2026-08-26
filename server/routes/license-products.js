const express = require('express');
const pool = require('../db/pool');
const { requireAuth, getAuthUser } = require('../middleware/auth');

const router = express.Router();

// Trial fields are only meaningful when isTrial is true — unchecking "Trial?"
// clears them, so a product never carries stale trial numbers around that
// a future accidental re-check could resurrect unexpectedly.
function trialFieldsFromBody(b) {
  const isTrial = !!b.isTrial;
  return {
    isTrial: isTrial ? 1 : 0,
    trialDays: isTrial && b.trialDays != null ? (Number(b.trialDays) || null) : null,
    trialLessonLimit: isTrial && b.trialLessonLimit != null ? (Number(b.trialLessonLimit) || null) : null,
    trialLibraryLimit: isTrial && b.trialLibraryLimit != null ? (Number(b.trialLibraryLimit) || null) : null,
  };
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    seatCount: row.seat_count,
    price: Number(row.price_cents) / 100,
    callForQuote: !!row.call_for_quote,
    variableSeats: !!row.variable_seats,
    sortOrder: row.sort_order,
    active: !!row.active,
    autoAssignGroupId: row.auto_assign_group_id || null,
    bulletPoints: row.bullet_points ? row.bullet_points.split('\n').filter(Boolean) : [],
    footerNote: row.footer_note || '',
    createdAt: row.created_at,
    addonRate: row.addon_rate_cents ? Number(row.addon_rate_cents) / 100 : null,
    isTrial: !!row.is_trial,
    trialDays: row.trial_days || null,
    trialLessonLimit: row.trial_lesson_limit || null,
    trialLibraryLimit: row.trial_library_limit || null,
    durationDays: row.duration_days || null,
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
  const bulletPoints = Array.isArray(b.bulletPoints) ? b.bulletPoints.filter(Boolean).join('\n') : (b.bulletPoints || '');
  const addonRateCents = b.addonRateCents != null ? (Number(b.addonRateCents) || null) : null;
  const trial = trialFieldsFromBody(b);
  const durationDays = b.durationDays != null ? (Number(b.durationDays) || null) : null;
  const [result] = await pool.query(
    'INSERT INTO license_products (name, description, seat_count, price_cents, call_for_quote, variable_seats, sort_order, active, auto_assign_group_id, bullet_points, footer_note, addon_rate_cents, is_trial, trial_days, trial_lesson_limit, trial_library_limit, duration_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [b.name, b.description || '', Number(b.seatCount) || 1, callForQuote ? 0 : Math.round(Number(b.price) * 100), callForQuote ? 1 : 0, b.variableSeats ? 1 : 0, Number(b.sortOrder) || 0, b.active === false ? 0 : 1, groupId, bulletPoints || null, b.footerNote || null, addonRateCents, trial.isTrial, trial.trialDays, trial.trialLessonLimit, trial.trialLibraryLimit, durationDays]
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
  const bulletPointsUpd = Array.isArray(b.bulletPoints) ? b.bulletPoints.filter(Boolean).join('\n') : (b.bulletPoints || '');
  const addonRateCentsUpd = b.addonRateCents != null ? (Number(b.addonRateCents) || null) : null;
  const trial = trialFieldsFromBody(b);
  const durationDaysUpd = b.durationDays != null ? (Number(b.durationDays) || null) : null;
  await pool.query(
    'UPDATE license_products SET name=?, description=?, seat_count=?, price_cents=?, call_for_quote=?, variable_seats=?, sort_order=?, active=?, auto_assign_group_id=?, bullet_points=?, footer_note=?, addon_rate_cents=?, is_trial=?, trial_days=?, trial_lesson_limit=?, trial_library_limit=?, duration_days=? WHERE id=?',
    [b.name, b.description || '', Number(b.seatCount) || 1, callForQuote ? 0 : Math.round(Number(b.price) * 100), callForQuote ? 1 : 0, b.variableSeats ? 1 : 0, Number(b.sortOrder) || 0, b.active === false ? 0 : 1, groupId, bulletPointsUpd || null, b.footerNote || null, addonRateCentsUpd, trial.isTrial, trial.trialDays, trial.trialLessonLimit, trial.trialLibraryLimit, durationDaysUpd, req.params.id]
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

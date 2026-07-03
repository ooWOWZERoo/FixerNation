const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { unsubscribeToken } = require('../lib/mailer');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    address: { street: row.street || '', city: row.city || '', state: row.state || '', zip: row.zip || '' },
    signupDate: row.signup_date,
    source: row.source,
    status: row.status,
  };
}

// Public — used by both the homepage signup form and the admin's "Add Contact" button.
router.post('/contacts', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ ok: false, reason: 'invalid' });
  }

  const address = b.address || {};
  try {
    const [result] = await pool.query(
      'INSERT INTO newsletter_contacts (name, email, street, city, state, zip, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [b.name || '', email, address.street || '', address.city || '', address.state || '', address.zip || '', b.source || 'Homepage', 'Subscribed']
    );
    const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, contact: serialize(rows[0]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ ok: false, reason: 'duplicate' });
    }
    throw err;
  }
});

router.get('/contacts', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM newsletter_contacts ORDER BY signup_date DESC');
  res.json({ contacts: rows.map(serialize) });
});

router.put('/contacts/:id', requireAuth, async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Status is required' });
  const [result] = await pool.query('UPDATE newsletter_contacts SET status = ? WHERE id = ?', [status, req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Contact not found' });
  const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  res.json({ contact: serialize(rows[0]) });
});

router.delete('/contacts/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true });
});

// Public link clicked from inside a sent campaign email — no auth, verified by
// an HMAC token instead so a link can't be used to unsubscribe someone else.
router.get('/unsubscribe', async (req, res) => {
  const email = (req.query.email || '').trim();
  const token = req.query.token || '';
  res.set('Content-Type', 'text/html');

  if (!email || token !== unsubscribeToken(email)) {
    return res.status(400).send('<p style="font-family:sans-serif; padding:40px; text-align:center;">This unsubscribe link is invalid.</p>');
  }
  await pool.query('UPDATE newsletter_contacts SET status = ? WHERE email = ?', ['Unsubscribed', email]);
  res.send(`<p style="font-family:sans-serif; padding:40px; text-align:center;">${email} has been unsubscribed from Fixer Nation emails.</p>`);
});

// Bulk import — rows already parsed client-side from CSV.
router.post('/contacts/import', requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  const defaultSource = (req.body && req.body.defaultSource) || 'Bulk Import';

  const [existingRows] = await pool.query('SELECT email FROM newsletter_contacts');
  const existingEmails = new Set(existingRows.map(r => r.email.toLowerCase()));

  let imported = 0, skippedInvalid = 0, skippedDuplicate = 0;
  for (const row of rows) {
    const email = (row.email || '').trim();
    if (!email || !EMAIL_PATTERN.test(email)) { skippedInvalid++; continue; }
    if (existingEmails.has(email.toLowerCase())) { skippedDuplicate++; continue; }
    await pool.query(
      'INSERT INTO newsletter_contacts (name, email, street, city, state, zip, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.name || '', email, row.street || '', row.city || '', row.state || '', row.zip || '', row.source || defaultSource, 'Subscribed']
    );
    existingEmails.add(email.toLowerCase());
    imported++;
  }

  res.json({ imported, skippedInvalid, skippedDuplicate });
});

module.exports = router;

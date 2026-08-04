const express = require('express');
const pool = require('../db/pool');
const { sendContactFormEmail } = require('../lib/mailer');
const { getSetting } = require('../lib/settings');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/general-inquiry', async (req, res) => {
  const { name, email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });

  await sendContactFormEmail({
    to: await getSetting('contact_email_general'),
    formName: 'Contact Us',
    fields: {
      Name: name,
      Email: email,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

router.post('/ask-the-fixer', async (req, res) => {
  const { firstName, lastName, email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });

  await sendContactFormEmail({
    to: await getSetting('contact_email_ask_the_fixer'),
    formName: 'Ask The Fixer',
    fields: {
      'First Name': firstName,
      'Last Name': lastName,
      Email: email,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

router.post('/quote', async (req, res) => {
  const { firstName, lastName, email, school, phone, message } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  await pool.query(
    'INSERT INTO quote_requests (first_name, last_name, email, school, phone, message) VALUES (?, ?, ?, ?, ?, ?)',
    [firstName || '', lastName || '', email, school || '', phone || '', message || '']
  );

  await pool.query(
    `INSERT INTO newsletter_contacts (name, email, company, source, status)
     VALUES (?, ?, ?, 'Quote Request', 'Subscribed')
     ON DUPLICATE KEY UPDATE
       name    = IF(name    = '' OR name    IS NULL, VALUES(name),    name),
       company = IF(company = '' OR company IS NULL, VALUES(company), company)`,
    [`${firstName || ''} ${lastName || ''}`.trim() || email, email, school || null]
  );

  await sendContactFormEmail({
    to: await getSetting('contact_email_quote'),
    formName: 'Request a Formal Quotation',
    fields: {
      'First Name': firstName,
      'Last Name': lastName,
      Email: email,
      School: school,
      Phone: phone,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

const REQUEST_TYPE_LABELS = {
  access: 'Access — what personal information do you have about me?',
  delete: 'Delete my personal information',
  opt_out: 'Opt out of any sale/sharing of my personal information',
  other: 'Other',
};

router.post('/privacy-request', async (req, res) => {
  const { name, email, requestType, message } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  await sendContactFormEmail({
    to: await getSetting('contact_email_privacy'),
    formName: 'Privacy Request',
    fields: {
      Name: name,
      Email: email,
      'Request Type': REQUEST_TYPE_LABELS[requestType] || requestType,
      Message: message,
    },
    replyTo: email,
  });
  res.json({ ok: true });
});

const VALID_STATUSES = ['new', 'contacted', 'converted', 'closed'];

router.get('/quotes', requireAuth, async (req, res) => {
  const { status, search } = req.query;
  let sql = 'SELECT * FROM quote_requests WHERE 1=1';
  const params = [];

  if (status && VALID_STATUSES.includes(status)) {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR school LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  sql += ' ORDER BY created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ quotes: rows });
});

router.put('/quotes/:id', requireAuth, async (req, res) => {
  const { status, notes } = req.body || {};
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const [existing] = await pool.query('SELECT id FROM quote_requests WHERE id = ?', [req.params.id]);
  if (!existing.length) return res.status(404).json({ error: 'Not found' });

  const updates = [];
  const params = [];
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (notes  !== undefined) { updates.push('notes = ?');  params.push(notes);  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  await pool.query(`UPDATE quote_requests SET ${updates.join(', ')} WHERE id = ?`, params);
  const [[row]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.id]);
  res.json({ ok: true, quote: row });
});

module.exports = router;

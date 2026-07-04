const express = require('express');
const pool = require('../db/pool');
const { sendContactFormEmail } = require('../lib/mailer');

const router = express.Router();

router.post('/ask-the-fixer', async (req, res) => {
  const { firstName, lastName, email, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Email and message are required' });

  await sendContactFormEmail({
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

  await sendContactFormEmail({
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

module.exports = router;

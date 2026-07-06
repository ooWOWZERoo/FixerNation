const express = require('express');
const pool = require('../db/pool');
const { sendContactFormEmail } = require('../lib/mailer');
const { getSetting } = require('../lib/settings');

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

module.exports = router;

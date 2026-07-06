const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../lib/settings');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/contact-emails', requireAuth, async (req, res) => {
  const [askTheFixer, quote, privacy, general] = await Promise.all([
    getSetting('contact_email_ask_the_fixer'),
    getSetting('contact_email_quote'),
    getSetting('contact_email_privacy'),
    getSetting('contact_email_general'),
  ]);
  res.json({ askTheFixer, quote, privacy, general });
});

router.put('/contact-emails', requireAuth, async (req, res) => {
  const b = req.body || {};
  const askTheFixer = (b.askTheFixer || '').trim();
  const quote = (b.quote || '').trim();
  const privacy = (b.privacy || '').trim();
  const general = (b.general || '').trim();

  if (![askTheFixer, quote, privacy, general].every(v => EMAIL_PATTERN.test(v))) {
    return res.status(400).json({ error: 'All fields need a valid email address' });
  }

  await Promise.all([
    setSetting('contact_email_ask_the_fixer', askTheFixer),
    setSetting('contact_email_quote', quote),
    setSetting('contact_email_privacy', privacy),
    setSetting('contact_email_general', general),
  ]);
  res.json({ ok: true });
});

router.get('/invoice-branding', requireAuth, async (req, res) => {
  const [businessName, tagline, logoUrl] = await Promise.all([
    getSetting('invoice_business_name'),
    getSetting('invoice_tagline'),
    getSetting('invoice_logo_url'),
  ]);
  res.json({ businessName, tagline, logoUrl });
});

router.put('/invoice-branding', requireAuth, async (req, res) => {
  const b = req.body || {};
  const businessName = (b.businessName || '').trim();
  const tagline = (b.tagline || '').trim();
  const logoUrl = (b.logoUrl || '').trim();

  if (!businessName) {
    return res.status(400).json({ error: 'Business name is required' });
  }

  await Promise.all([
    setSetting('invoice_business_name', businessName),
    setSetting('invoice_tagline', tagline),
    setSetting('invoice_logo_url', logoUrl),
  ]);
  res.json({ ok: true });
});

module.exports = router;

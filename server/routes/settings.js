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

router.get('/quote', requireAuth, async (req, res) => {
  const [fromEmail, twoYrPct, threeYrPct] = await Promise.all([
    getSetting('quote_from_email'),
    getSetting('quote_2yr_discount_pct'),
    getSetting('quote_3yr_discount_pct'),
  ]);
  res.json({
    fromEmail: fromEmail || '',
    twoYrDiscountPct: Number(twoYrPct) || 5,
    threeYrDiscountPct: Number(threeYrPct) || 8,
  });
});

router.put('/quote', requireAuth, async (req, res) => {
  const b = req.body || {};
  const fromEmail    = (b.fromEmail    || '').trim();
  const twoYrPct    = parseInt(b.twoYrDiscountPct,    10);
  const threeYrPct  = parseInt(b.threeYrDiscountPct,  10);

  if (fromEmail && !EMAIL_PATTERN.test(fromEmail)) {
    return res.status(400).json({ error: 'From email must be a valid address' });
  }
  if (isNaN(twoYrPct)   || twoYrPct   < 0 || twoYrPct   > 100) return res.status(400).json({ error: '2-year discount must be 0–100' });
  if (isNaN(threeYrPct) || threeYrPct < 0 || threeYrPct > 100) return res.status(400).json({ error: '3-year discount must be 0–100' });

  await Promise.all([
    fromEmail ? setSetting('quote_from_email', fromEmail) : Promise.resolve(),
    setSetting('quote_2yr_discount_pct',   String(twoYrPct)),
    setSetting('quote_3yr_discount_pct',   String(threeYrPct)),
  ]);
  res.json({ ok: true });
});

router.get('/morning-boost-voice', requireAuth, async (req, res) => {
  const voiceId = await getSetting('morning_boost_voice_id');
  res.json({ voiceId });
});

router.put('/morning-boost-voice', requireAuth, async (req, res) => {
  const voiceId = (req.body && req.body.voiceId || '').trim();
  if (!voiceId) return res.status(400).json({ error: 'A voice ID is required' });
  await setSetting('morning_boost_voice_id', voiceId);
  res.json({ ok: true });
});

router.get('/morning-boost-audio-limit', requireAuth, async (req, res) => {
  const raw = await getSetting('morning_boost_audio_limit');
  const limit = Math.max(1, Math.min(100, parseInt(raw || '20', 10)));
  res.json({ limit });
});

router.put('/morning-boost-audio-limit', requireAuth, async (req, res) => {
  const limit = parseInt(req.body && req.body.limit, 10);
  if (!limit || limit < 1 || limit > 100) return res.status(400).json({ error: 'Limit must be 1–100' });
  await setSetting('morning_boost_audio_limit', String(limit));
  res.json({ ok: true });
});

module.exports = router;

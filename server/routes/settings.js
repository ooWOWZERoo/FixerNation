const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../lib/settings');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/contact-emails', requireAuth, async (req, res) => {
  const [askTheFixer, quote, privacy, general, salesAlerts] = await Promise.all([
    getSetting('contact_email_ask_the_fixer'),
    getSetting('contact_email_quote'),
    getSetting('contact_email_privacy'),
    getSetting('contact_email_general'),
    getSetting('contact_email_sales_alerts'),
  ]);
  res.json({ askTheFixer, quote, privacy, general, salesAlerts });
});

router.put('/contact-emails', requireAuth, async (req, res) => {
  const b = req.body || {};
  const askTheFixer = (b.askTheFixer || '').trim();
  const quote = (b.quote || '').trim();
  const privacy = (b.privacy || '').trim();
  const general = (b.general || '').trim();
  const salesAlerts = (b.salesAlerts || '').trim();

  if (![askTheFixer, quote, privacy, general, salesAlerts].every(v => EMAIL_PATTERN.test(v))) {
    return res.status(400).json({ error: 'All fields need a valid email address' });
  }

  await Promise.all([
    setSetting('contact_email_ask_the_fixer', askTheFixer),
    setSetting('contact_email_quote', quote),
    setSetting('contact_email_privacy', privacy),
    setSetting('contact_email_general', general),
    setSetting('contact_email_sales_alerts', salesAlerts),
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
  const saves = [];

  if (b.fromEmail !== undefined) {
    const fromEmail = (b.fromEmail || '').trim();
    if (fromEmail && !EMAIL_PATTERN.test(fromEmail)) {
      return res.status(400).json({ error: 'From email must be a valid address' });
    }
    if (fromEmail) saves.push(setSetting('quote_from_email', fromEmail));
  }

  if (b.twoYrDiscountPct !== undefined) {
    const pct = parseInt(b.twoYrDiscountPct, 10);
    if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: '2-year discount must be 0–100' });
    saves.push(setSetting('quote_2yr_discount_pct', String(pct)));
  }

  if (b.threeYrDiscountPct !== undefined) {
    const pct = parseInt(b.threeYrDiscountPct, 10);
    if (isNaN(pct) || pct < 0 || pct > 100) return res.status(400).json({ error: '3-year discount must be 0–100' });
    saves.push(setSetting('quote_3yr_discount_pct', String(pct)));
  }

  if (!saves.length) return res.status(400).json({ error: 'Nothing to update' });
  await Promise.all(saves);
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

router.get('/teacher-lesson-plan-limit', requireAuth, async (req, res) => {
  const raw = await getSetting('teacher_lesson_plan_limit');
  const limit = Math.max(1, parseInt(raw || '40', 10));
  res.json({ limit });
});

router.put('/teacher-lesson-plan-limit', requireAuth, async (req, res) => {
  const limit = parseInt(req.body && req.body.limit, 10);
  if (!limit || limit < 1) return res.status(400).json({ error: 'Limit must be at least 1' });
  await setSetting('teacher_lesson_plan_limit', String(limit));
  res.json({ ok: true });
});

// Default library limit for trial teachers — see settings.js's DEFAULTS
// comment for how this is used (fallback for older trial purchases, and a
// one-time pre-fill in admin-licenses.html's "Trial?" checkbox).
router.get('/teacher-lesson-plan-limit-trial', requireAuth, async (req, res) => {
  const raw = await getSetting('teacher_lesson_plan_limit_trial');
  const limit = Math.max(1, parseInt(raw || '10', 10));
  res.json({ limit });
});

router.put('/teacher-lesson-plan-limit-trial', requireAuth, async (req, res) => {
  const limit = parseInt(req.body && req.body.limit, 10);
  if (!limit || limit < 1) return res.status(400).json({ error: 'Limit must be at least 1' });
  await setSetting('teacher_lesson_plan_limit_trial', String(limit));
  res.json({ ok: true });
});

router.get('/auto-refresh', requireAuth, async (req, res) => {
  const raw = await getSetting('admin_auto_refresh_sec');
  res.json({ intervalSec: Math.max(0, parseInt(raw || '0', 10)) });
});

router.put('/auto-refresh', requireAuth, async (req, res) => {
  const sec = parseInt(req.body && req.body.intervalSec, 10);
  if (isNaN(sec) || sec < 0) return res.status(400).json({ error: 'Interval must be 0 or a positive number of seconds' });
  await setSetting('admin_auto_refresh_sec', String(sec));
  res.json({ ok: true });
});

// Content Safety — contextual AI moderation (OpenAI omni-moderation) is
// off by default; this is the admin ON/OFF switch described in
// CONTENT_SAFETY_IMPLEMENTATION_PLAN.md. Enabling it still requires
// OPENAI_API_KEY to be set in server/.env (lib/safety/contextual.js) —
// this flag alone doesn't make it live if the key is missing.
router.get('/content-safety-openai', requireAuth, async (req, res) => {
  const raw = await getSetting('content_safety_openai_enabled');
  res.json({ enabled: raw === 'true' });
});

router.put('/content-safety-openai', requireAuth, async (req, res) => {
  const enabled = req.body && req.body.enabled === true;
  await setSetting('content_safety_openai_enabled', enabled ? 'true' : 'false');
  res.json({ ok: true });
});

// Fallback destination for a CRITICAL_BLOCK_ALERT with zero school-configured
// recipients (lib/safety/incident.js) — so a critical finding never reaches
// nobody just because a school hasn't set up its own alert recipients yet.
router.get('/content-safety-fallback-email', requireAuth, async (req, res) => {
  const email = await getSetting('content_safety_fallback_email');
  res.json({ email: email || '' });
});

router.put('/content-safety-fallback-email', requireAuth, async (req, res) => {
  const email = (req.body && req.body.email || '').trim();
  if (email && !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ error: 'Must be a valid email address' });
  }
  await setSetting('content_safety_fallback_email', email);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../lib/settings');
const { trimmedLogoUrl, faviconPng } = require('../lib/site-logo');
const pogEvidence = require('../lib/pog-evidence');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/contact-emails', requireAuth, async (req, res) => {
  const [askTheFixer, quote, privacy, general, salesAlerts, support] = await Promise.all([
    getSetting('contact_email_ask_the_fixer'),
    getSetting('contact_email_quote'),
    getSetting('contact_email_privacy'),
    getSetting('contact_email_general'),
    getSetting('contact_email_sales_alerts'),
    getSetting('contact_email_support'),
  ]);
  res.json({ askTheFixer, quote, privacy, general, salesAlerts, support });
});

router.put('/contact-emails', requireAuth, async (req, res) => {
  const b = req.body || {};
  const askTheFixer = (b.askTheFixer || '').trim();
  const quote = (b.quote || '').trim();
  const privacy = (b.privacy || '').trim();
  const general = (b.general || '').trim();
  const salesAlerts = (b.salesAlerts || '').trim();
  // Optional so an older copy of the settings page (without the support field) still saves; absent means leave it as it is.
  const support = typeof b.support === 'string' ? b.support.trim() : null;

  if (![askTheFixer, quote, privacy, general, salesAlerts, ...(support === null ? [] : [support])].every(v => EMAIL_PATTERN.test(v))) {
    return res.status(400).json({ error: 'All fields need a valid email address' });
  }

  await Promise.all([
    setSetting('contact_email_ask_the_fixer', askTheFixer),
    setSetting('contact_email_quote', quote),
    setSetting('contact_email_privacy', privacy),
    setSetting('contact_email_general', general),
    setSetting('contact_email_sales_alerts', salesAlerts),
    ...(support === null ? [] : [setSetting('contact_email_support', support)]),
  ]);
  res.json({ ok: true });
});

// How long an admin page that shows student names may sit idle before it hides them (minutes, 1 to 120).
router.get('/privacy-lock', requireAuth, async (req, res) => {
  const minutes = Number(await getSetting('admin_privacy_lock_minutes'));
  res.json({ minutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= 120 ? minutes : 5 });
});

router.put('/privacy-lock', requireAuth, async (req, res) => {
  const raw = (req.body || {}).minutes;
  const minutes = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return res.status(400).json({ error: 'Enter a whole number of minutes from 1 to 120' });
  await setSetting('admin_privacy_lock_minutes', String(minutes));
  res.json({ ok: true, minutes });
});

// Graduate Evidence: the smallest group of students a school or district screen will show a figure for. The saved value is clamped on
// every read (lib/pog-evidence.js), so a damaged row can never switch the rule off.
router.get('/pog-evidence-min-group', requireAuth, async (req, res) => {
  const { MIN_GROUP_FLOOR: min, MIN_GROUP_CEILING: max } = pogEvidence;
  res.json({ students: pogEvidence.clampMinGroup(await getSetting('pog_evidence_min_group')), min, max });
});

router.put('/pog-evidence-min-group', requireAuth, async (req, res) => {
  const { MIN_GROUP_FLOOR: min, MIN_GROUP_CEILING: max } = pogEvidence;
  const raw = (req.body || {}).students;
  const students = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim())) ? Number(raw) : NaN;
  if (!Number.isInteger(students) || students < min || students > max) return res.status(400).json({ error: `Enter a whole number of students from ${min} to ${max}` });
  await setSetting('pog_evidence_min_group', String(students));
  res.json({ ok: true, students });
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

// The website logo (public header and footer). GET is public: every page's nav.js/footer.js reads it, and it is only a file path.
// A path on this site ("/uploads/x.webp", "uploads/x.webp", "logo.png") or an https address; anything with another scheme
// (javascript:, data:) or markup characters is refused.
const LOGO_PATTERN = /^(https:\/\/[^\s"'<>]+|[^\s:"'<>]+)$/;

router.get('/site-logo', async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ url: await trimmedLogoUrl((await getSetting('website_logo_url')) || '') });
});

// The tab icon and home-screen icon on every page point here. With no website logo (or one we cannot use) it sends the
// built-in icon files instead, so the pages never end up with a broken icon.
const BUILT_IN_ICON = { 16: '/favicon-16x16.png', 32: '/favicon-32x32.png', 48: '/favicon-32x32.png', 180: '/apple-touch-icon.png' };

router.get('/favicon', async (req, res) => {
  const size = BUILT_IN_ICON[Number(req.query.size)] ? Number(req.query.size) : 32;
  const url = await getSetting('website_logo_url');
  const png = url ? await faviconPng(url, size) : null;
  res.set('Cache-Control', 'public, max-age=300');
  if (!png) return res.redirect(302, BUILT_IN_ICON[size]);
  res.type('png').send(png);
});

router.get('/website-logo', requireAuth, async (req, res) => {
  res.json({ logoUrl: (await getSetting('website_logo_url')) || '' });
});

router.put('/website-logo', requireAuth, async (req, res) => {
  const logoUrl = typeof (req.body || {}).logoUrl === 'string' ? req.body.logoUrl.trim() : '';
  if (logoUrl && !LOGO_PATTERN.test(logoUrl)) {
    return res.status(400).json({ error: 'Use an uploaded image, a file name, or an https:// image address' });
  }
  await setSetting('website_logo_url', logoUrl);
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
// Throttling for real campaign sends — see processCampaignBatch() in
// server/routes/campaigns.js. Combined into one endpoint since the two
// values are always edited together.
router.get('/campaign-batching', requireAuth, async (req, res) => {
  const [batchSizeRaw, intervalRaw] = await Promise.all([
    getSetting('campaign_batch_size'),
    getSetting('campaign_batch_interval_minutes'),
  ]);
  res.json({
    batchSize: Math.max(1, parseInt(batchSizeRaw, 10) || 60),
    intervalMinutes: Math.max(1, parseInt(intervalRaw, 10) || 60),
  });
});

router.put('/campaign-batching', requireAuth, async (req, res) => {
  const batchSize = parseInt(req.body && req.body.batchSize, 10);
  const intervalMinutes = parseInt(req.body && req.body.intervalMinutes, 10);
  if (!batchSize || batchSize < 1) return res.status(400).json({ error: 'Batch size must be at least 1' });
  if (!intervalMinutes || intervalMinutes < 1) return res.status(400).json({ error: 'Interval must be at least 1 minute' });
  await Promise.all([
    setSetting('campaign_batch_size', String(batchSize)),
    setSetting('campaign_batch_interval_minutes', String(intervalMinutes)),
  ]);
  res.json({ ok: true });
});

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

router.get('/teacher-lesson-plan-swap-limit', requireAuth, async (req, res) => {
  const raw = await getSetting('teacher_lesson_plan_swap_limit');
  const limit = parseInt(raw, 10);
  res.json({ limit: Number.isNaN(limit) ? 3 : Math.max(0, limit) });
});

// 0 is a real answer ("teachers cannot remove lessons"), so unlike the plan limits this accepts it.
router.put('/teacher-lesson-plan-swap-limit', requireAuth, async (req, res) => {
  const raw = req.body && req.body.limit;
  const limit = typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim())) ? Number(raw) : NaN;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) return res.status(400).json({ error: 'Swaps must be a whole number from 0 to 100' });
  await setSetting('teacher_lesson_plan_swap_limit', String(limit));
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

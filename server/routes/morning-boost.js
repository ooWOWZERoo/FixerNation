const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getSetting } = require('../lib/settings');
const { classifySendError } = require('../lib/campaign-tracking');
const nodemailer = require('nodemailer');

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST) throw new Error('SMTP not configured');
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return _transporter;
}

function mbUnsubscribeToken(email) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(email.toLowerCase()).digest('hex');
}
function mbUnsubscribeUrl(email) {
  const base = process.env.SITE_URL || '';
  return `${base}/api/morning-boost/email/unsubscribe?email=${encodeURIComponent(email)}&token=${mbUnsubscribeToken(email)}`;
}

// Render {{token}} placeholders in a template string.
function renderTemplate(template, vars) {
  return (template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined ? vars[key] : ''));
}

// Build a plain-text version from an HTML body (strip tags, collapse whitespace).
function htmlToPlainText(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Build HTML + text email for one recipient, given the config and blog-post vars.
function buildMorningBoostEmail(config, vars, recipientEmail) {
  const unsubUrl = mbUnsubscribeUrl(recipientEmail);
  const ctaUrl = vars.cta_url;
  const ctaText = config.cta_text || "Read Today's Morning Boost";

  let bodyHtml = renderTemplate(config.body, vars);
  let bodyText = config.body_format === 'html' ? htmlToPlainText(bodyHtml) : renderTemplate(config.body, vars);

  const ctaHtml = `<div style="margin:24px 0; text-align:center;"><a href="${ctaUrl}" style="display:inline-block; background:#F26B4D; color:#fff; padding:13px 28px; border-radius:999px; font-weight:700; font-size:15px; text-decoration:none;">${ctaText}</a></div>`;
  const ctaPlain = `\n\n${ctaText}: ${ctaUrl}`;

  const unsubHtml = `<hr style="border:none;border-top:1px solid #eee;margin:24px 0;"><p style="font-family:Arial,sans-serif;font-size:11px;color:#999;">You're receiving this because you are a member of a Fixer Nation recipient group. <a href="${unsubUrl}" style="color:#999;">Unsubscribe from Morning Boost</a>.</p>`;
  const unsubPlain = `\n\n---\nUnsubscribe from Morning Boost: ${unsubUrl}`;

  return {
    html: bodyHtml + ctaHtml + unsubHtml,
    text: bodyText + ctaPlain + unsubPlain,
  };
}

// Seed the default config row if it doesn't exist yet.
async function ensureConfig() {
  const [[row]] = await pool.query('SELECT id FROM morning_boost_email_config LIMIT 1');
  if (!row) {
    await pool.query(
      "INSERT INTO morning_boost_email_config (enabled, send_time, send_timezone, from_name, from_email, subject, body, body_format, cta_text) VALUES (0, '07:00:00', 'America/New_York', 'Fixer Nation', ?, 'Morning Boost — {{title}}', '', 'html', 'Read Today\\'s Morning Boost')",
      [process.env.SMTP_USER || '']
    );
  }
}

const router = express.Router();
const MAX_SCRIPTS_PER_BATCH = 13; // matches the doc's 13-scripts-per-day structure
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

async function getAudioLimit() {
  const raw = await getSetting('morning_boost_audio_limit');
  return Math.max(1, Math.min(100, parseInt(raw || '20', 10)));
}

function serialize(row) {
  return {
    id: row.id,
    boostDate: row.boost_date,
    theme: row.theme,
    series: row.series,
    blogPostId: row.blog_post_id,
  };
}

// Optional ?start=YYYY-MM-DD&end=YYYY-MM-DD range filter — defaults to
// everything, since the whole 2026 calendar is only ~200 rows.
router.get('/', requireAuth, async (req, res) => {
  const { start, end } = req.query;
  let sql = 'SELECT * FROM morning_boost_calendar';
  const params = [];
  if (start && end) {
    sql += ' WHERE boost_date BETWEEN ? AND ?';
    params.push(start, end);
  }
  sql += ' ORDER BY boost_date';
  const [rows] = await pool.query(sql, params);
  res.json({ calendar: rows.map(serialize) });
});

// Must be registered before /:date — single-segment paths would otherwise be
// swallowed by that param route.
router.get('/audio-history', requireAuth, async (req, res) => {
  const limit = await getAudioLimit();
  const [rows] = await pool.query(
    'SELECT * FROM morning_boost_audio_clips ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  res.json({
    clips: rows.map(r => ({
      id: r.id,
      filename: r.filename,
      scriptText: r.script_text,
      url: `/api/morning-boost/audio/${r.filename}`,
      createdAt: r.created_at,
    })),
    limit,
  });
});

router.delete('/audio/:filename', requireAuth, async (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w\-]+\.mp3$/i.test(filename)) return res.status(400).json({ error: 'Invalid filename' });
  await pool.query('DELETE FROM morning_boost_audio_clips WHERE filename = ?', [filename]);
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// Batch-creates draft blog posts from calendar entries that don't have one yet.
router.post('/batch-create-posts', requireAuth, async (req, res) => {
  const dates = Array.isArray(req.body && req.body.dates) ? req.body.dates : [];
  if (!dates.length) return res.status(400).json({ error: 'Provide at least one date' });
  if (dates.length > 50) return res.status(400).json({ error: 'Max 50 dates per batch' });

  const results = [];
  const connection = await pool.getConnection();
  try {
    for (const date of dates) {
      const [[entry]] = await connection.query(
        'SELECT * FROM morning_boost_calendar WHERE boost_date = ?', [date]
      );
      if (!entry) { results.push({ date, ok: false, error: 'No calendar entry found' }); continue; }
      if (entry.blog_post_id) { results.push({ date, ok: false, skipped: true, reason: 'Already has a blog post' }); continue; }

      const title = `${entry.series}: ${entry.theme}`;
      let baseSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      let slug = baseSlug;
      let n = 2;
      while (true) {
        const [existing] = await connection.query('SELECT id FROM blog_posts WHERE slug = ?', [slug]);
        if (!existing.length) break;
        slug = `${baseSlug}-${n++}`;
      }

      try {
        await connection.beginTransaction();
        const [ins] = await connection.query(
          `INSERT INTO blog_posts (title, slug, author, category, excerpt, body, publish_date, featured, published, requires_membership)
           VALUES (?, ?, 'Fixer Nation', 'Morning Boost', '', '', ?, 0, 0, 0)`,
          [title, slug, date]
        );
        const postId = ins.insertId;
        await connection.query(
          'INSERT INTO blog_post_categories (post_id, category) VALUES (?, ?)',
          [postId, 'Morning Boost']
        );
        await connection.query(
          'UPDATE morning_boost_calendar SET blog_post_id = ? WHERE boost_date = ?',
          [postId, date]
        );
        await connection.commit();
        results.push({ date, ok: true, postId, slug, title });
      } catch (err) {
        await connection.rollback();
        results.push({ date, ok: false, error: err.message });
      }
    }
  } finally {
    connection.release();
  }

  res.json({
    created: results.filter(r => r.ok).length,
    skipped: results.filter(r => r.skipped).length,
    failed: results.filter(r => !r.ok && !r.skipped).length,
    results,
  });
});

// Returns calendar entries for the next N days (default 14), with linked blog post info.
// Used by the Schedule tab on admin-morning-boost-email.html to show/manage post linkage.
router.get('/schedule', requireAuth, async (req, res) => {
  const days = Math.min(Number(req.query.days) || 14, 60);
  const [rows] = await pool.query(
    `SELECT mbc.boost_date, mbc.blog_post_id, mbc.theme, mbc.series,
            bp.title AS post_title, bp.published AS post_published,
            bp.publish_date AS post_publish_date
     FROM morning_boost_calendar mbc
     LEFT JOIN blog_posts bp ON bp.id = mbc.blog_post_id
     WHERE mbc.boost_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
     ORDER BY mbc.boost_date`,
    [days - 1]
  );
  res.json({
    entries: rows.map(r => ({
      date: r.boost_date ? r.boost_date.toString().slice(0, 10) : null,
      blogPostId: r.blog_post_id || null,
      theme: r.theme || null,
      series: r.series || null,
      postTitle: r.post_title || null,
      postPublished: r.post_published === 1,
      postPublishDate: r.post_publish_date ? r.post_publish_date.toString().slice(0, 10) : null,
    }))
  });
});

router.get('/:date', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM morning_boost_calendar WHERE boost_date = ?', [req.params.date]);
  if (!rows[0]) return res.status(404).json({ error: 'No calendar entry for that date' });
  res.json({ entry: serialize(rows[0]) });
});

// Serves generated audio files with the correct Content-Type so the browser's
// <audio> element can play them (Apache serves uploads as octet-stream).
router.get('/audio/:filename', requireAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^[\w\-]+\.mp3$/i.test(filename)) return res.status(400).json({ error: 'Invalid filename' });
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  fs.createReadStream(filePath).pipe(res);
});

// Called once a blog post has actually been created/published for this
// calendar entry, so admin-blogs.html can show "already posted" and avoid
// double-publishing the same day.
router.put('/:date/blog-post', requireAuth, async (req, res) => {
  const blogPostId = req.body && req.body.blogPostId ? Number(req.body.blogPostId) : null;
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date format.' });
  if (blogPostId) {
    // Upsert: creates the calendar entry if none exists yet for this date
    await pool.query(
      `INSERT INTO morning_boost_calendar (boost_date, blog_post_id)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE blog_post_id = VALUES(blog_post_id)`,
      [date, blogPostId]
    );
  } else {
    await pool.query('UPDATE morning_boost_calendar SET blog_post_id = NULL WHERE boost_date = ?', [date]);
  }
  res.json({ ok: true });
});

// Batch-generates one voice-over MP3 per script via the ElevenLabs API,
// replacing "paste each script into ElevenLabs one at a time" with a single
// action. Coded but not live until a real ELEVENLABS_API_KEY is configured
// (same deferred-but-complete pattern as Stripe/SMTP) — the voice itself is
// admin-configurable via Settings since it stays the same across every
// batch, not a per-request choice.
router.post('/generate-audio', requireAuth, async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(400).json({ error: 'ElevenLabs is not configured yet — add ELEVENLABS_API_KEY to server/.env.' });
  }
  const voiceId = await getSetting('morning_boost_voice_id');
  if (!voiceId) {
    return res.status(400).json({ error: 'No ElevenLabs voice is configured yet — set one on the Morning Boost Studio page.' });
  }

  const scripts = Array.isArray(req.body && req.body.scripts) ? req.body.scripts.filter(s => (s || '').trim()) : [];
  if (!scripts.length) return res.status(400).json({ error: 'At least one script is required' });
  if (scripts.length > MAX_SCRIPTS_PER_BATCH) {
    return res.status(400).json({ error: `A batch is at most ${MAX_SCRIPTS_PER_BATCH} scripts` });
  }

  const results = [];
  for (let i = 0; i < scripts.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400));
    console.log(`[morning-boost] Script ${i + 1}/${scripts.length}: sending to ElevenLabs`);
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text: scripts[i], model_id: 'eleven_multilingual_v2' }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error(`[morning-boost] Script ${i + 1} failed: ${response.status} ${detail.slice(0, 200)}`);
        results.push({ index: i, ok: false, error: `ElevenLabs error (${response.status}): ${detail.slice(0, 200)}` });
        continue;
      }
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('audio')) {
        const detail = await response.text().catch(() => '');
        console.error(`[morning-boost] Script ${i + 1}: unexpected content-type "${contentType}": ${detail.slice(0, 200)}`);
        results.push({ index: i, ok: false, error: `ElevenLabs returned non-audio (${contentType}): ${detail.slice(0, 200)}` });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) {
        console.error(`[morning-boost] Script ${i + 1}: ElevenLabs returned empty audio`);
        results.push({ index: i, ok: false, error: 'ElevenLabs returned empty audio — try again' });
        continue;
      }
      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp3`;
      fs.writeFileSync(path.join(uploadsDir, filename), buffer);
      console.log(`[morning-boost] Script ${i + 1} saved: ${filename} (${buffer.length} bytes)`);

      // Persist to history and prune oldest beyond the configured limit.
      await pool.query(
        'INSERT IGNORE INTO morning_boost_audio_clips (filename, script_text) VALUES (?, ?)',
        [filename, scripts[i]]
      );
      const limit = await getAudioLimit();
      const [overflow] = await pool.query(
        'SELECT filename FROM morning_boost_audio_clips ORDER BY created_at DESC LIMIT 1000 OFFSET ?',
        [limit]
      );
      for (const row of overflow) {
        await pool.query('DELETE FROM morning_boost_audio_clips WHERE filename = ?', [row.filename]);
        const old = path.join(uploadsDir, row.filename);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      }

      results.push({ index: i, ok: true, filename, url: `/api/morning-boost/audio/${filename}` });
    } catch (err) {
      console.error(`[morning-boost] Script ${i + 1} threw: ${err.message}`);
      results.push({ index: i, ok: false, error: err.message });
    }
  }
  console.log(`[morning-boost] Done — ${results.filter(r => r.ok).length}/${scripts.length} succeeded`);
  res.json({ results });
});

// ============================================================
// Morning Boost Email Automation routes
// ============================================================

// GET /api/morning-boost/email/groups — contact groups with live member counts
router.get('/email/groups', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT g.id, g.name, COUNT(cgm.contact_id) AS memberCount
     FROM contact_groups g
     LEFT JOIN contact_group_members cgm ON cgm.group_id = g.id
     GROUP BY g.id, g.name
     ORDER BY g.name`
  );
  res.json({ groups: rows.map(r => ({ id: r.id, name: r.name, memberCount: Number(r.memberCount) })) });
});

// GET /api/morning-boost/email/config — admin: get config + assigned groups
router.get('/email/config', requireAuth, async (req, res) => {
  await ensureConfig();
  const [[config]] = await pool.query('SELECT * FROM morning_boost_email_config ORDER BY id LIMIT 1');
  const [groupRows] = await pool.query(
    'SELECT group_id FROM morning_boost_email_groups WHERE config_id = ?', [config.id]
  );
  res.json({
    config: {
      id: config.id,
      enabled: !!config.enabled,
      sendTime: config.send_time,
      sendTimezone: config.send_timezone,
      fromName: config.from_name,
      fromEmail: config.from_email,
      replyTo: config.reply_to || '',
      subject: config.subject,
      body: config.body,
      bodyFormat: config.body_format,
      ctaText: config.cta_text,
      ctaUrlOverride: config.cta_url_override || '',
      fallbackMessage: config.fallback_message || '',
      groupIds: groupRows.map(r => r.group_id),
    },
  });
});

// PUT /api/morning-boost/email/config — admin: update config + groups
router.put('/email/config', requireAuth, async (req, res) => {
  await ensureConfig();
  const [[existing]] = await pool.query('SELECT id FROM morning_boost_email_config LIMIT 1');
  const configId = existing.id;
  const b = req.body || {};

  await pool.query(
    `UPDATE morning_boost_email_config SET
      enabled=?, send_time=?, send_timezone=?, from_name=?, from_email=?,
      reply_to=?, subject=?, body=?, body_format=?, cta_text=?, cta_url_override=?,
      fallback_message=?, updated_by=?
     WHERE id=?`,
    [
      b.enabled ? 1 : 0,
      b.sendTime || '07:00:00',
      b.sendTimezone || 'America/New_York',
      b.fromName || 'Fixer Nation',
      b.fromEmail || '',
      b.replyTo || null,
      b.subject || '',
      b.body || '',
      b.bodyFormat === 'text' ? 'text' : 'html',
      b.ctaText || "Read Today's Morning Boost",
      b.ctaUrlOverride || null,
      b.fallbackMessage || null,
      req.user && req.user.id ? req.user.id : null,
      configId,
    ]
  );

  // Replace group assignments
  await pool.query('DELETE FROM morning_boost_email_groups WHERE config_id = ?', [configId]);
  const groupIds = Array.isArray(b.groupIds) ? b.groupIds.filter(id => Number.isInteger(Number(id))) : [];
  if (groupIds.length) {
    await pool.query(
      'INSERT INTO morning_boost_email_groups (config_id, group_id) VALUES ' + groupIds.map(() => '(?,?)').join(','),
      groupIds.flatMap(id => [configId, Number(id)])
    );
  }

  res.json({ ok: true });
});

// GET /api/morning-boost/email/sends — admin: paginated send history
router.get('/email/sends', requireAuth, async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
  const [rows] = await pool.query(
    `SELECT s.*, bp.title AS post_title, bp.slug AS post_slug
     FROM morning_boost_sends s
     LEFT JOIN blog_posts bp ON bp.id = s.blog_post_id
     ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM morning_boost_sends');
  res.json({
    sends: rows.map(s => ({
      id: s.id, boostDate: s.boost_date, status: s.status,
      subject: s.subject, fromEmail: s.from_email, scheduledFor: s.scheduled_for,
      sentAt: s.sent_at, recipientCount: s.recipient_count, sentCount: s.sent_count,
      failedCount: s.failed_count, skippedCount: s.skipped_count, isResend: !!s.is_resend,
      failureReason: s.failure_reason, postTitle: s.post_title, postSlug: s.post_slug,
    })),
    total,
  });
});

// GET /api/morning-boost/email/sends/:id — admin: send detail + recipient stats
router.get('/email/sends/:id', requireAuth, async (req, res) => {
  const [[send]] = await pool.query(
    `SELECT s.*, bp.title AS post_title FROM morning_boost_sends s
     LEFT JOIN blog_posts bp ON bp.id = s.blog_post_id WHERE s.id = ?`,
    [req.params.id]
  );
  if (!send) return res.status(404).json({ error: 'Send not found' });

  const [recipients] = await pool.query(
    'SELECT email, status, error_message, sent_at, opened_at, clicked_at FROM morning_boost_send_recipients WHERE send_id = ? ORDER BY email LIMIT 500',
    [send.id]
  );
  const [[stats]] = await pool.query(
    `SELECT
      SUM(status='sent') AS sent,
      SUM(status='failed') AS failed,
      SUM(status='skipped') AS skipped,
      SUM(opened_at IS NOT NULL) AS opened,
      SUM(clicked_at IS NOT NULL) AS clicked
     FROM morning_boost_send_recipients WHERE send_id = ?`,
    [send.id]
  );

  res.json({
    send: {
      id: send.id, boostDate: send.boost_date, status: send.status,
      subject: send.subject, fromEmail: send.from_email, fromName: send.from_name,
      replyTo: send.reply_to, ctaUrl: send.cta_url, scheduledFor: send.scheduled_for,
      sentAt: send.sent_at, recipientCount: send.recipient_count,
      isResend: !!send.is_resend, failureReason: send.failure_reason,
      postTitle: send.post_title, groupIds: send.group_ids ? JSON.parse(send.group_ids) : [],
    },
    stats: {
      sent: Number(stats.sent || 0), failed: Number(stats.failed || 0),
      skipped: Number(stats.skipped || 0), opened: Number(stats.opened || 0),
      clicked: Number(stats.clicked || 0),
    },
    recipients: recipients.map(r => ({
      email: r.email, status: r.status, error: r.error_message,
      sentAt: r.sent_at, openedAt: r.opened_at, clickedAt: r.clicked_at,
    })),
  });
});

// POST /api/morning-boost/email/trigger — admin: manual trigger for a date
router.post('/email/trigger', requireAuth, async (req, res) => {
  const targetDate = (req.body && req.body.date) || new Date().toISOString().slice(0, 10);
  const adminId = req.user && req.user.id ? req.user.id : null;

  // Check for duplicate (allow resend only if caller passes { resend: true })
  const isResend = !!(req.body && req.body.resend);
  if (!isResend) {
    const [[existing]] = await pool.query(
      "SELECT id FROM morning_boost_sends WHERE boost_date = ? AND status IN ('completed','sending')",
      [targetDate]
    );
    if (existing) {
      return res.status(409).json({ error: 'A send already exists for this date. Pass resend:true to force.' });
    }
  }

  const result = await runMorningBoostSend({ targetDate, initiatedBy: adminId, isResend });
  res.json(result);
});

// POST /api/morning-boost/email/sends/:id/resend — admin: resend a specific past send
router.post('/email/sends/:id/resend', requireAuth, async (req, res) => {
  const [[existing]] = await pool.query('SELECT * FROM morning_boost_sends WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Send not found' });

  const onlyFailed = !!(req.body && req.body.onlyFailed);
  const adminId = req.user && req.user.id ? req.user.id : null;
  const result = await runMorningBoostSend({
    targetDate: existing.boost_date,
    initiatedBy: adminId,
    isResend: true,
    originalSendId: onlyFailed ? existing.id : null,
  });
  res.json(result);
});

// GET /api/morning-boost/email/track-open — public: 1x1 pixel for open tracking
router.get('/email/track-open', async (req, res) => {
  const { token } = req.query;
  if (token) {
    await pool.query(
      'UPDATE morning_boost_send_recipients SET opened_at = COALESCE(opened_at, NOW()) WHERE open_token = ?',
      [token]
    ).catch(() => {});
  }
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
  );
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache' });
  res.end(pixel);
});

// GET /api/morning-boost/email/track-click — public: CTA click tracking + redirect
router.get('/email/track-click', async (req, res) => {
  const { token } = req.query;
  let destination = process.env.SITE_URL || '/';
  if (token) {
    const [[row]] = await pool.query(
      'SELECT r.click_token, s.cta_url FROM morning_boost_send_recipients r JOIN morning_boost_sends s ON s.id=r.send_id WHERE r.click_token = ?',
      [token]
    ).catch(() => [[null]]);
    if (row) {
      destination = row.cta_url || destination;
      await pool.query(
        'UPDATE morning_boost_send_recipients SET clicked_at = COALESCE(clicked_at, NOW()) WHERE click_token = ?',
        [token]
      ).catch(() => {});
    }
  }
  res.redirect(302, destination);
});

// GET /api/morning-boost/email/unsubscribe — public: Morning Boost-specific unsubscribe
router.get('/email/unsubscribe', async (req, res) => {
  const { email, token } = req.query;
  if (!email || !token || token !== mbUnsubscribeToken(email)) {
    return res.status(400).send('Invalid unsubscribe link.');
  }
  await pool.query(
    'UPDATE newsletter_contacts SET morning_boost_unsubscribed_at = COALESCE(morning_boost_unsubscribed_at, NOW()) WHERE email = ?',
    [email.toLowerCase()]
  );
  res.send('<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Unsubscribed</h2><p>You have been removed from the Morning Boost email list. Other Fixer Nation emails are unaffected.</p></body></html>');
});

// Core send logic shared by the automated cron and manual trigger/resend.
// targetDate: 'YYYY-MM-DD', initiatedBy: admin user id or null,
// isResend: bool, originalSendId: for onlyFailed resends (re-send to recipients who failed).
async function runMorningBoostSend({ targetDate, initiatedBy = null, isResend = false, originalSendId = null }) {
  await ensureConfig();
  const [[config]] = await pool.query('SELECT * FROM morning_boost_email_config ORDER BY id LIMIT 1');
  if (!config) return { ok: false, error: 'No Morning Boost email config found.' };

  const [groupRows] = await pool.query(
    'SELECT group_id FROM morning_boost_email_groups WHERE config_id = ?', [config.id]
  );
  const groupIds = groupRows.map(r => r.group_id);

  // Pre-send validation §7
  const errors = [];
  if (!config.from_email) errors.push('Sending email address is not configured.');
  if (!config.subject) errors.push('Subject line is missing.');
  if (!config.body) errors.push('Email body is missing.');
  if (!config.cta_text) errors.push('CTA button text is missing.');
  if (!groupIds.length) errors.push('No recipient groups are selected.');

  // Find today's Morning Boost calendar entry and published blog post
  const [[calEntry]] = await pool.query(
    'SELECT mbc.*, bp.title, bp.slug, bp.author, bp.excerpt, bp.publish_date, bp.status AS bp_status FROM morning_boost_calendar mbc LEFT JOIN blog_posts bp ON bp.id = mbc.blog_post_id WHERE mbc.boost_date = ?',
    [targetDate]
  );

  const siteUrl = process.env.SITE_URL || '';
  let ctaUrl = config.cta_url_override || null;
  let blogPostId = null;
  let vars = { date: targetDate, title: '', author: '', excerpt: '', theme: '', series: '', cta_url: '' };

  if (calEntry && calEntry.blog_post_id) {
    const publishedByDate = calEntry.publish_date &&
      calEntry.publish_date.toString().slice(0, 10) <= targetDate;
    const postPublished = publishedByDate || calEntry.bp_status === 'published';

    if (!postPublished) {
      errors.push('The associated Morning Boost blog post is not yet published.');
    }
    blogPostId = calEntry.blog_post_id;
    ctaUrl = ctaUrl || `${siteUrl}/blog.html?post=${calEntry.slug}`;
    vars = {
      date: new Date(targetDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      title: calEntry.title || '',
      author: calEntry.author || '',
      excerpt: calEntry.excerpt || '',
      theme: calEntry.theme || '',
      series: calEntry.series || '',
      cta_url: ctaUrl || '',
    };
  } else if (!config.fallback_message) {
    errors.push('No published Morning Boost post found for this date and no fallback message is configured.');
  } else {
    ctaUrl = ctaUrl || siteUrl;
    vars.cta_url = ctaUrl;
  }

  if (!ctaUrl) errors.push('No CTA URL could be determined.');

  if (errors.length) {
    return { ok: false, errors };
  }

  // Compile unique eligible recipients from selected groups
  let recipientQuery;
  if (originalSendId) {
    // Resend: only to recipients from the original send who failed or were never attempted
    recipientQuery = pool.query(
      `SELECT DISTINCT nc.id, nc.email
       FROM morning_boost_send_recipients mbr
       JOIN newsletter_contacts nc ON nc.id = mbr.contact_id
       WHERE mbr.send_id = ? AND mbr.status != 'sent'
         AND nc.status = 'Subscribed'
         AND nc.morning_boost_unsubscribed_at IS NULL`,
      [originalSendId]
    );
  } else {
    const placeholders = groupIds.map(() => '?').join(',');
    recipientQuery = pool.query(
      `SELECT DISTINCT nc.id, nc.email
       FROM newsletter_contacts nc
       JOIN contact_group_members cgm ON cgm.contact_id = nc.id
       WHERE cgm.group_id IN (${placeholders})
         AND nc.status = 'Subscribed'
         AND nc.morning_boost_unsubscribed_at IS NULL`,
      groupIds
    );
  }

  const [recipients] = await recipientQuery;

  if (!recipients.length) {
    return { ok: false, errors: ['No eligible recipients found in the selected groups.'] };
  }

  // Create the send record
  const [insertResult] = await pool.query(
    `INSERT INTO morning_boost_sends
       (config_id, blog_post_id, boost_date, scheduled_for, status, subject, from_email, from_name, reply_to, cta_url, group_ids, recipient_count, is_resend, initiated_by)
     VALUES (?, ?, ?, NOW(), 'sending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      config.id, blogPostId, targetDate,
      renderTemplate(config.subject, vars),
      config.from_email, config.from_name, config.reply_to || null,
      ctaUrl, JSON.stringify(groupIds), recipients.length,
      isResend ? 1 : 0, initiatedBy,
    ]
  );
  const sendId = insertResult.insertId;

  let sent = 0, failed = 0, skipped = 0;
  const bodyVarsWithCtaUrl = { ...vars, cta_url: ctaUrl };

  let transporter;
  try { transporter = getTransporter(); } catch (e) {
    await pool.query('UPDATE morning_boost_sends SET status=?, failure_reason=?, sent_at=NOW() WHERE id=?',
      ['failed', e.message, sendId]);
    return { ok: false, errors: [e.message] };
  }

  for (const contact of recipients) {
    const openToken = crypto.randomBytes(24).toString('hex');
    const clickToken = crypto.randomBytes(24).toString('hex');
    const [recResult] = await pool.query(
      "INSERT INTO morning_boost_send_recipients (send_id, contact_id, email, status, open_token, click_token) VALUES (?, ?, ?, 'pending', ?, ?)",
      [sendId, contact.id, contact.email, openToken, clickToken]
    );
    const recId = recResult.insertId;

    const { html, text } = buildMorningBoostEmail(
      { ...config, cta_url: ctaUrl },
      bodyVarsWithCtaUrl,
      contact.email
    );

    const trackingBase = siteUrl;
    const pixelTag = `<img src="${trackingBase}/api/morning-boost/email/track-open?token=${openToken}" width="1" height="1" border="0" alt="">`;
    const trackedCtaUrl = `${trackingBase}/api/morning-boost/email/track-click?token=${clickToken}`;
    const finalHtml = (config.body_format === 'html' ? html : null) && html.replace(ctaUrl, trackedCtaUrl) + pixelTag;

    try {
      await transporter.sendMail({
        from: `"${config.from_name}" <${config.from_email}>`,
        to: contact.email,
        replyTo: config.reply_to || undefined,
        subject: renderTemplate(config.subject, vars),
        html: config.body_format === 'html' ? finalHtml : undefined,
        text,
        headers: { 'List-Unsubscribe': `<${mbUnsubscribeUrl(contact.email)}>` },
      });
      await pool.query("UPDATE morning_boost_send_recipients SET status='sent', sent_at=NOW() WHERE id=?", [recId]);
      sent++;
    } catch (err) {
      const errStatus = classifySendError(err);
      await pool.query(
        "UPDATE morning_boost_send_recipients SET status='failed', error_message=? WHERE id=?",
        [err.message.slice(0, 500), recId]
      );
      if (errStatus === 'bounced') skipped++; else failed++;
    }
  }

  await pool.query(
    'UPDATE morning_boost_sends SET status=?, sent_at=NOW(), sent_count=?, failed_count=?, skipped_count=? WHERE id=?',
    ['completed', sent, failed, skipped, sendId]
  );

  return { ok: true, sendId, sent, failed, skipped, recipientCount: recipients.length };
}

module.exports = { router, runMorningBoostSend };

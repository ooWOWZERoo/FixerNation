const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getSetting } = require('../lib/settings');

const router = express.Router();
const MAX_SCRIPTS_PER_BATCH = 13; // matches the doc's 13-scripts-per-day structure
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

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

router.get('/:date', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM morning_boost_calendar WHERE boost_date = ?', [req.params.date]);
  if (!rows[0]) return res.status(404).json({ error: 'No calendar entry for that date' });
  res.json({ entry: serialize(rows[0]) });
});

// Called once a blog post has actually been created/published for this
// calendar entry, so admin-blogs.html can show "already posted" and avoid
// double-publishing the same day.
router.put('/:date/blog-post', requireAuth, async (req, res) => {
  const blogPostId = req.body && req.body.blogPostId ? Number(req.body.blogPostId) : null;
  const [result] = await pool.query('UPDATE morning_boost_calendar SET blog_post_id = ? WHERE boost_date = ?', [blogPostId, req.params.date]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'No calendar entry for that date' });
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

  const urlPrefix = process.env.UPLOADS_URL_PREFIX || '/uploads/';
  const results = [];
  for (let i = 0; i < scripts.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 400));
    console.log(`[morning-boost] Script ${i + 1}/${scripts.length}: sending to ElevenLabs`);
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: scripts[i], model_id: 'eleven_turbo_v2_5' }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        console.error(`[morning-boost] Script ${i + 1} failed: ${response.status} ${detail.slice(0, 200)}`);
        results.push({ index: i, ok: false, error: `ElevenLabs error (${response.status}): ${detail.slice(0, 200)}` });
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
      results.push({ index: i, ok: true, filename, url: urlPrefix + filename });
    } catch (err) {
      console.error(`[morning-boost] Script ${i + 1} threw: ${err.message}`);
      results.push({ index: i, ok: false, error: err.message });
    }
  }
  console.log(`[morning-boost] Done — ${results.filter(r => r.ok).length}/${scripts.length} succeeded`);
  res.json({ results });
});

module.exports = router;

const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { sendCampaignEmail } = require('../lib/mailer');
const { rewriteLinksForTracking, classifySendError } = require('../lib/campaign-tracking');
const { computeNextFireAt } = require('../lib/campaign-recurrence');

const router = express.Router();

// 1x1 transparent GIF served by the open-tracking pixel below.
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

async function getGroupIdsForCampaigns(campaignIds) {
  if (!campaignIds.length) return {};
  const [rows] = await pool.query('SELECT campaign_id, group_id FROM campaign_audience_groups WHERE campaign_id IN (?)', [campaignIds]);
  const byId = {};
  rows.forEach(r => { (byId[r.campaign_id] = byId[r.campaign_id] || []).push(r.group_id); });
  return byId;
}

// Replaces a campaign's selected audience groups wholesale — simplest
// correct semantics for "these are the groups now", no diffing needed.
async function setGroupIdsForCampaign(connOrPool, campaignId, groupIds) {
  await connOrPool.query('DELETE FROM campaign_audience_groups WHERE campaign_id = ?', [campaignId]);
  const ids = Array.isArray(groupIds) ? groupIds.filter(Boolean).map(Number) : [];
  if (ids.length) {
    const values = ids.map(gid => [campaignId, gid]);
    await connOrPool.query('INSERT IGNORE INTO campaign_audience_groups (campaign_id, group_id) VALUES ?', [values]);
  }
}

function serialize(row, groupIds) {
  return {
    id: row.id,
    subject: row.subject,
    fromName: row.from_name,
    fromEmail: row.from_email,
    audienceFilter: { status: row.audience_status, source: row.audience_source, groupIds: groupIds || [] },
    body: row.body,
    bodyFormat: row.body_format,
    status: row.status,
    scheduledFor: row.scheduled_for,
    seriesId: row.series_id,
    sentAt: row.sent_at,
    recipientCount: row.recipient_count,
    createdAt: row.created_at,
  };
}

router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
  const groupIdsById = await getGroupIdsForCampaigns(rows.map(r => r.id));
  res.json({ campaigns: rows.map(r => serialize(r, groupIdsById[r.id])) });
});

// Public — hit by the recipient's email client loading the tracking pixel
// image, so this can't require admin auth. Declared before any /:id route
// so Express never mistakes "track-open" for an :id value.
router.get('/track-open', async (req, res) => {
  const token = req.query.token;
  if (token) {
    await pool.query(
      'UPDATE campaign_sends SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1 WHERE token = ?',
      [token]
    );
  }
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(TRACKING_PIXEL);
});

// Public — hit when a recipient clicks a link inside an HTML campaign. The
// real destination was stored server-side when the link was rewritten at
// send time (see rewriteLinksForTracking); this endpoint never trusts a
// redirect target from the request itself, so it can't be abused as an open
// redirect. A click also counts as an implicit open (you can't click a link
// in an email you never opened).
router.get('/click', async (req, res) => {
  const linkId = req.query.l;
  const [[target]] = linkId ? await pool.query('SELECT * FROM campaign_link_targets WHERE link_id = ?', [linkId]) : [[]];
  if (!target) return res.status(404).send('This link is no longer valid.');

  await pool.query(
    'UPDATE campaign_link_targets SET click_count = click_count + 1 WHERE id = ?',
    [target.id]
  );
  await pool.query(
    'UPDATE campaign_sends SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1, clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1 WHERE id = ?',
    [target.send_id]
  );
  res.redirect(target.destination_url);
});

// A scheduledFor value moves the campaign straight to 'Scheduled' instead
// of 'Draft' — validated as a real future instant, never trusted to already
// be one just because the browser sent it.
function resolveScheduledFor(c) {
  if (!c.scheduledFor) return { status: 'Draft', scheduledFor: null };
  const d = new Date(c.scheduledFor);
  if (isNaN(d.getTime())) throw { status: 400, message: 'Invalid scheduledFor date' };
  if (d <= new Date()) throw { status: 400, message: 'Scheduled time must be in the future' };
  return { status: 'Scheduled', scheduledFor: d };
}

router.post('/', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });

  let schedule;
  try { schedule = resolveScheduledFor(c); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  // Drafts can legitimately have no body yet (still being written), but a
  // campaign actually being scheduled to send needs real content.
  if (schedule.status === 'Scheduled' && !(c.body && c.body.trim())) {
    return res.status(400).json({ error: 'Email body is required to schedule a campaign' });
  }

  const [result] = await pool.query(
    `INSERT INTO campaigns (subject, from_name, from_email, audience_status, audience_source, body, body_format, status, scheduled_for)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', c.body || '', c.bodyFormat || 'text', schedule.status, schedule.scheduledFor]
  );
  await setGroupIdsForCampaign(pool, result.insertId, c.audienceFilter && c.audienceFilter.groupIds);

  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [result.insertId]);
  const groupIdsById = await getGroupIdsForCampaigns([result.insertId]);
  res.status(201).json({ campaign: serialize(rows[0], groupIdsById[result.insertId]) });
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sends a one-off test email of whatever's currently in the compose form —
// works on unsaved content, no campaign row involved. Skips the unsubscribe-
// footer's tracking token (no real campaign_sends row exists to attach opens/
// clicks to) but otherwise renders exactly what a real subscriber would get.
// Declared before the generic /:id routes so Express never mistakes
// "test-send" for a campaign id.
router.post('/test-send', requireAuth, async (req, res) => {
  const c = req.body || {};
  const to = (c.to || '').trim();
  if (!to || !EMAIL_PATTERN.test(to)) return res.status(400).json({ error: 'A valid test email address is required' });
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });
  if (!(c.body && c.body.trim())) return res.status(400).json({ error: 'Email body is required' });

  await sendCampaignEmail({
    to,
    fromName: c.fromName || 'Fixer Nation',
    fromEmail: c.fromEmail || '',
    subject: `[TEST] ${c.subject}`,
    body: c.body,
    bodyFormat: c.bodyFormat || 'text',
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Recurring campaign series — a template that spawns an independently-
// tracked `campaigns` occurrence (its own recipient_count/opens/clicks)
// every time it fires, rather than one row that resends itself. Declared
// before the generic /:id routes below so Express never mistakes "series"
// for a campaign id.
// ---------------------------------------------------------------------------

const RECURRENCE_TYPES = ['daily', 'weekly', 'monthly'];

function serializeSeries(row, groupIds) {
  return {
    id: row.id,
    subject: row.subject,
    fromName: row.from_name,
    fromEmail: row.from_email,
    audienceFilter: { status: row.audience_status, source: row.audience_source, groupIds: groupIds || [] },
    body: row.body,
    bodyFormat: row.body_format,
    recurrenceType: row.recurrence_type,
    recurrenceDayOfWeek: row.recurrence_day_of_week,
    recurrenceDayOfMonth: row.recurrence_day_of_month,
    sendTime: row.send_time,
    sendTimezone: row.send_timezone,
    isActive: !!row.is_active,
    nextFireAt: row.next_fire_at,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
  };
}

async function getGroupIdsForSeriesList(seriesIds) {
  if (!seriesIds.length) return {};
  const [rows] = await pool.query('SELECT series_id, group_id FROM campaign_series_groups WHERE series_id IN (?)', [seriesIds]);
  const byId = {};
  rows.forEach(r => { (byId[r.series_id] = byId[r.series_id] || []).push(r.group_id); });
  return byId;
}

async function setGroupIdsForSeries(seriesId, groupIds) {
  await pool.query('DELETE FROM campaign_series_groups WHERE series_id = ?', [seriesId]);
  const ids = Array.isArray(groupIds) ? groupIds.filter(Boolean).map(Number) : [];
  if (ids.length) {
    const values = ids.map(gid => [seriesId, gid]);
    await pool.query('INSERT IGNORE INTO campaign_series_groups (series_id, group_id) VALUES ?', [values]);
  }
}

// Validates and normalizes the recurrence fields shared by create/update.
function parseRecurrenceFields(c) {
  if (!RECURRENCE_TYPES.includes(c.recurrenceType)) {
    throw { status: 400, message: 'recurrenceType must be daily, weekly, or monthly' };
  }
  let dayOfWeek = null, dayOfMonth = null;
  if (c.recurrenceType === 'weekly') {
    dayOfWeek = Number(c.recurrenceDayOfWeek);
    if (!(dayOfWeek >= 0 && dayOfWeek <= 6)) throw { status: 400, message: 'recurrenceDayOfWeek must be 0-6' };
  }
  if (c.recurrenceType === 'monthly') {
    dayOfMonth = Number(c.recurrenceDayOfMonth);
    if (!(dayOfMonth >= 1 && dayOfMonth <= 31)) throw { status: 400, message: 'recurrenceDayOfMonth must be 1-31' };
  }
  const sendTime = /^\d{2}:\d{2}(:\d{2})?$/.test(c.sendTime || '') ? c.sendTime : '09:00:00';
  const sendTimezone = (c.sendTimezone || 'America/New_York').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone: sendTimezone }); } catch {
    throw { status: 400, message: `"${sendTimezone}" is not a valid timezone` };
  }
  return { recurrence_type: c.recurrenceType, recurrence_day_of_week: dayOfWeek, recurrence_day_of_month: dayOfMonth, send_time: sendTime, send_timezone: sendTimezone };
}

router.get('/series', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM campaign_series ORDER BY created_at DESC');
  const groupIdsById = await getGroupIdsForSeriesList(rows.map(r => r.id));
  res.json({ series: rows.map(r => serializeSeries(r, groupIdsById[r.id])) });
});

router.post('/series', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });
  // Unlike a one-off campaign, a series has no "draft" state — it starts
  // scheduling real fires the moment it's created, so it always needs body.
  if (!(c.body && c.body.trim())) return res.status(400).json({ error: 'Email body is required' });

  let rec;
  try { rec = parseRecurrenceFields(c); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  const nextFireAt = computeNextFireAt(rec, new Date(), true);
  const [result] = await pool.query(
    `INSERT INTO campaign_series
       (subject, from_name, from_email, audience_status, audience_source, body, body_format,
        recurrence_type, recurrence_day_of_week, recurrence_day_of_month, send_time, send_timezone, next_fire_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', c.body || '', c.bodyFormat || 'text',
     rec.recurrence_type, rec.recurrence_day_of_week, rec.recurrence_day_of_month, rec.send_time, rec.send_timezone, nextFireAt]
  );
  await setGroupIdsForSeries(result.insertId, c.audienceFilter && c.audienceFilter.groupIds);

  const [rows] = await pool.query('SELECT * FROM campaign_series WHERE id = ?', [result.insertId]);
  const groupIdsById = await getGroupIdsForSeriesList([result.insertId]);
  res.status(201).json({ series: serializeSeries(rows[0], groupIdsById[result.insertId]) });
});

router.put('/series/:id', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });
  if (!(c.body && c.body.trim())) return res.status(400).json({ error: 'Email body is required' });

  const [existing] = await pool.query('SELECT id FROM campaign_series WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Series not found' });

  let rec;
  try { rec = parseRecurrenceFields(c); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  // Recomputed fresh from now — editing a series' schedule always
  // re-anchors it, rather than trying to preserve a stale next_fire_at
  // that may no longer even match the new rule.
  const nextFireAt = computeNextFireAt(rec, new Date(), true);
  await pool.query(
    `UPDATE campaign_series SET
       subject=?, from_name=?, from_email=?, audience_status=?, audience_source=?, body=?, body_format=?,
       recurrence_type=?, recurrence_day_of_week=?, recurrence_day_of_month=?, send_time=?, send_timezone=?, next_fire_at=?
     WHERE id=?`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', c.body || '', c.bodyFormat || 'text',
     rec.recurrence_type, rec.recurrence_day_of_week, rec.recurrence_day_of_month, rec.send_time, rec.send_timezone, nextFireAt, req.params.id]
  );
  await setGroupIdsForSeries(req.params.id, c.audienceFilter && c.audienceFilter.groupIds);

  const [rows] = await pool.query('SELECT * FROM campaign_series WHERE id = ?', [req.params.id]);
  const groupIdsById = await getGroupIdsForSeriesList([Number(req.params.id)]);
  res.json({ series: serializeSeries(rows[0], groupIdsById[req.params.id]) });
});

router.post('/series/:id/pause', requireAuth, async (req, res) => {
  const [result] = await pool.query('UPDATE campaign_series SET is_active = 0 WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Series not found' });
  res.json({ ok: true });
});

router.post('/series/:id/resume', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM campaign_series WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Series not found' });
  // Recompute from now, in case real time has moved well past the
  // previously-stored next_fire_at while this series sat paused.
  const nextFireAt = computeNextFireAt(rows[0], new Date(), true);
  await pool.query('UPDATE campaign_series SET is_active = 1, next_fire_at = ? WHERE id = ?', [nextFireAt, req.params.id]);
  res.json({ ok: true, nextFireAt });
});

router.delete('/series/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM campaign_series WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Series not found' });
  res.json({ ok: true });
});

router.put('/:id', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });

  const [existing] = await pool.query('SELECT id, status FROM campaigns WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Campaign not found' });
  if (existing[0].status === 'Sent') return res.status(400).json({ error: 'A sent campaign cannot be edited' });

  let schedule;
  try { schedule = resolveScheduledFor(c); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  if (schedule.status === 'Scheduled' && !(c.body && c.body.trim())) {
    return res.status(400).json({ error: 'Email body is required to schedule a campaign' });
  }

  await pool.query(
    `UPDATE campaigns SET subject=?, from_name=?, from_email=?, audience_status=?, audience_source=?, body=?, body_format=?, status=?, scheduled_for=?
     WHERE id=?`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', c.body || '', c.bodyFormat || 'text', schedule.status, schedule.scheduledFor, req.params.id]
  );
  await setGroupIdsForCampaign(pool, req.params.id, c.audienceFilter && c.audienceFilter.groupIds);

  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  const groupIdsById = await getGroupIdsForCampaigns([Number(req.params.id)]);
  res.json({ campaign: serialize(rows[0], groupIdsById[req.params.id]) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM campaigns WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ ok: true });
});

// Resolves the real recipient list for a campaign at the moment it's about
// to send (never at save/schedule time) — one or more audience groups are
// unioned (anyone in ANY selected group), further narrowed by source if
// set. Regardless of any filter, delivery ALWAYS excludes unsubscribed
// contacts — source/group filters only ever narrow further, never reach
// people who opted out.
async function resolveCampaignAudience(campaign) {
  const params = ['Subscribed'];
  let joinClause = '';
  let extraClauses = '';
  if (campaign.audience_source && campaign.audience_source !== 'All') {
    extraClauses += ' AND c.source = ?';
    params.push(campaign.audience_source);
  }
  const [groupRows] = await pool.query('SELECT group_id FROM campaign_audience_groups WHERE campaign_id = ?', [campaign.id]);
  const groupIds = groupRows.map(r => r.group_id);
  if (groupIds.length) {
    joinClause = ' JOIN contact_group_members m ON m.contact_id = c.id';
    extraClauses += ' AND m.group_id IN (?)';
    params.push(groupIds);
  }
  const [contacts] = await pool.query(
    `SELECT DISTINCT c.id, c.email FROM newsletter_contacts c${joinClause} WHERE c.status = ?${extraClauses}`,
    params
  );
  return contacts;
}

// Sends the campaign for real via SMTP — one individual email per recipient
// (each message's "To" header contains only that one address; there is no
// CC/BCC of the full list, so no recipient ever sees anyone else's address).
// Shared by the manual "Send Now"/"Send" action and the scheduled/recurring
// cron (server/scripts/send-scheduled-campaigns.js) — the exact same send
// path either way, just a different trigger.
async function sendCampaignNow(campaignId) {
  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
  if (!rows[0]) throw { status: 404, message: 'Campaign not found' };
  const campaign = rows[0];
  if (campaign.status === 'Sent') throw { status: 400, message: 'This campaign has already been sent' };
  if (!campaign.body || !campaign.body.trim()) throw { status: 400, message: 'Email body is required to send a campaign' };

  const contacts = await resolveCampaignAudience(campaign);

  let sent = 0, bounced = 0, undelivered = 0;
  for (const contact of contacts) {
    const token = crypto.randomBytes(24).toString('hex');
    // Inserted before sending (rather than after) so link-click tracking has
    // a real campaign_sends.id to attach its rewritten-link rows to.
    const [insertResult] = await pool.query(
      'INSERT INTO campaign_sends (campaign_id, contact_id, email, token, status) VALUES (?, ?, ?, ?, ?)',
      [campaign.id, contact.id, contact.email, token, 'sent']
    );
    const sendId = insertResult.insertId;

    try {
      const body = campaign.body_format === 'html'
        ? await rewriteLinksForTracking(campaign.body, sendId, campaign)
        : campaign.body;
      await sendCampaignEmail({
        to: contact.email,
        fromName: campaign.from_name,
        fromEmail: campaign.from_email,
        subject: campaign.subject,
        body,
        bodyFormat: campaign.body_format,
        trackingToken: token,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send campaign ${campaign.id} to ${contact.email}:`, err.message);
      const status = classifySendError(err);
      await pool.query(
        'UPDATE campaign_sends SET status = ?, error_message = ? WHERE id = ?',
        [status, err.message.slice(0, 500), sendId]
      );
      if (status === 'bounced') bounced++; else undelivered++;
    }
  }

  await pool.query(
    "UPDATE campaigns SET status = 'Sent', sent_at = NOW(), recipient_count = ? WHERE id = ?",
    [sent, campaignId]
  );
  return { sent, bounced, undelivered };
}

router.post('/:id/send', requireAuth, async (req, res) => {
  let result;
  try {
    result = await sendCampaignNow(req.params.id);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  const [updated] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  const groupIdsById = await getGroupIdsForCampaigns([Number(req.params.id)]);
  res.json({ campaign: serialize(updated[0], groupIdsById[req.params.id]), ...result });
});

router.get('/:id/stats', requireAuth, async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total,
       SUM(status = 'sent') AS sent,
       SUM(status = 'bounced') AS bounced,
       SUM(status = 'undelivered') AS undelivered,
       SUM(opened_at IS NOT NULL) AS opened,
       SUM(clicked_at IS NOT NULL) AS clicked,
       SUM(unsubscribed_at IS NOT NULL) AS unsubscribed
     FROM campaign_sends WHERE campaign_id = ?`,
    [req.params.id]
  );
  const sentCount = row.sent || 0;
  res.json({
    stats: {
      total: row.total,
      sent: sentCount,
      bounced: row.bounced || 0,
      undelivered: row.undelivered || 0,
      opened: row.opened || 0,
      clicked: row.clicked || 0,
      unsubscribed: row.unsubscribed || 0,
      openRate: sentCount > 0 ? (row.opened || 0) / sentCount : 0,
    },
  });
});

// Only the recipients matching each specific condition — not the full send
// list — since that's what the admin actually wants to see per campaign.
router.get('/:id/activity', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT email, status, error_message, opened_at, clicked_at, unsubscribed_at FROM campaign_sends WHERE campaign_id = ? ORDER BY email',
    [req.params.id]
  );

  // Per-link breakdown: aggregate click_count by destination_url across all
  // sends for this campaign, tracking which recipient emails clicked each URL.
  const [linkRows] = await pool.query(
    `SELECT clt.destination_url, clt.click_count, cs.email
     FROM campaign_link_targets clt
     JOIN campaign_sends cs ON cs.id = clt.send_id
     WHERE cs.campaign_id = ?
     ORDER BY clt.destination_url, cs.email`,
    [req.params.id]
  );
  const linkMap = new Map();
  for (const row of linkRows) {
    if (!linkMap.has(row.destination_url)) {
      linkMap.set(row.destination_url, { url: row.destination_url, totalClicks: 0, clickers: new Set() });
    }
    const entry = linkMap.get(row.destination_url);
    entry.totalClicks += row.click_count;
    if (row.click_count > 0) entry.clickers.add(row.email);
  }
  const links = [...linkMap.values()]
    .filter(l => l.totalClicks > 0)
    .map(l => ({ url: l.url, totalClicks: l.totalClicks, clickers: [...l.clickers] }))
    .sort((a, b) => b.totalClicks - a.totalClicks);

  res.json({
    opened: rows.filter(r => r.opened_at).map(r => ({ email: r.email, at: r.opened_at, clicked: !!r.clicked_at })),
    clicked: rows.filter(r => r.clicked_at).map(r => ({ email: r.email, at: r.clicked_at })),
    unsubscribed: rows.filter(r => r.unsubscribed_at).map(r => ({ email: r.email, at: r.unsubscribed_at })),
    bounced: rows.filter(r => r.status === 'bounced').map(r => ({ email: r.email, reason: r.error_message })),
    undelivered: rows.filter(r => r.status === 'undelivered').map(r => ({ email: r.email, reason: r.error_message })),
    nonOpenerCount: rows.filter(r => r.status === 'sent' && !r.opened_at).length,
    links,
  });
});

// Creates a draft follow-up campaign targeting a behavioral segment of a
// sent campaign. A new contact group is auto-created for the segment so
// the draft's audience filter points to a real, editable group.
router.post('/:id/follow-up', requireAuth, async (req, res) => {
  const { type } = req.body || {};
  if (!['non-openers', 'clickers'].includes(type)) {
    return res.status(400).json({ error: 'type must be non-openers or clickers' });
  }

  const [[campaign]] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'Sent') return res.status(400).json({ error: 'Campaign has not been sent' });

  const [contactRows] = type === 'non-openers'
    ? await pool.query(
        "SELECT DISTINCT contact_id FROM campaign_sends WHERE campaign_id = ? AND status = 'sent' AND opened_at IS NULL AND contact_id IS NOT NULL",
        [req.params.id]
      )
    : await pool.query(
        'SELECT DISTINCT contact_id FROM campaign_sends WHERE campaign_id = ? AND clicked_at IS NOT NULL AND contact_id IS NOT NULL',
        [req.params.id]
      );

  if (!contactRows.length) {
    const label = type === 'non-openers' ? 'non-openers' : 'clickers';
    return res.status(400).json({ error: `No ${label} found for this campaign` });
  }

  const groupLabel = type === 'non-openers' ? 'Non-openers' : 'Clickers';
  const [groupResult] = await pool.query(
    'INSERT INTO contact_groups (name) VALUES (?)',
    [`${groupLabel} · Campaign #${campaign.id}`]
  );
  const groupId = groupResult.insertId;

  const placeholders = contactRows.map(() => '(?, ?)').join(', ');
  const values = contactRows.flatMap(r => [r.contact_id, groupId]);
  await pool.query(`INSERT IGNORE INTO contact_group_members (contact_id, group_id) VALUES ${placeholders}`, values);

  const newSubject = type === 'clickers' ? `Re: ${campaign.subject}` : campaign.subject;
  const [newRow] = await pool.query(
    `INSERT INTO campaigns (subject, from_name, from_email, body_format, body, status)
     VALUES (?, ?, ?, ?, ?, 'Draft')`,
    [newSubject, campaign.from_name, campaign.from_email, campaign.body_format, campaign.body]
  );
  await setGroupIdsForCampaign(pool, newRow.insertId, [groupId]);

  res.json({ ok: true, campaignId: newRow.insertId, groupId, recipientCount: contactRows.length });
});

module.exports = { router, sendCampaignNow, computeNextFireAt };

const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { sendCampaignEmail } = require('../lib/mailer');
const { rewriteLinksForTracking, classifySendError } = require('../lib/campaign-tracking');

const router = express.Router();

// 1x1 transparent GIF served by the open-tracking pixel below.
const TRACKING_PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function serialize(row) {
  return {
    id: row.id,
    subject: row.subject,
    fromName: row.from_name,
    fromEmail: row.from_email,
    audienceFilter: { status: row.audience_status, source: row.audience_source, groupId: row.audience_group_id },
    body: row.body,
    bodyFormat: row.body_format,
    status: row.status,
    sentAt: row.sent_at,
    recipientCount: row.recipient_count,
    createdAt: row.created_at,
  };
}

router.get('/', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
  res.json({ campaigns: rows.map(serialize) });
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

router.post('/', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });

  const [result] = await pool.query(
    `INSERT INTO campaigns (subject, from_name, from_email, audience_status, audience_source, audience_group_id, body, body_format, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Draft')`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', (c.audienceFilter && c.audienceFilter.groupId) || null, c.body || '', c.bodyFormat || 'text']
  );
  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [result.insertId]);
  res.status(201).json({ campaign: serialize(rows[0]) });
});

router.put('/:id', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });

  const [existing] = await pool.query('SELECT id FROM campaigns WHERE id = ?', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Campaign not found' });

  await pool.query(
    `UPDATE campaigns SET subject=?, from_name=?, from_email=?, audience_status=?, audience_source=?, audience_group_id=?, body=?, body_format=?
     WHERE id=?`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', (c.audienceFilter && c.audienceFilter.groupId) || null, c.body || '', c.bodyFormat || 'text', req.params.id]
  );
  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  res.json({ campaign: serialize(rows[0]) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM campaigns WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ ok: true });
});

// Sends the campaign for real via SMTP — one individual email per recipient
// (each message's "To" header contains only that one address; there is no
// CC/BCC of the full list, so no recipient ever sees anyone else's address).
// Regardless of the audience_status filter stored on the campaign, delivery
// ALWAYS excludes unsubscribed contacts — source/group filters only ever
// narrow further, they can never be used to reach people who opted out.
router.post('/:id/send', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Campaign not found' });
  const campaign = rows[0];

  const params = ['Subscribed'];
  let joinClause = '';
  let extraClauses = '';
  if (campaign.audience_source && campaign.audience_source !== 'All') {
    extraClauses += ' AND c.source = ?';
    params.push(campaign.audience_source);
  }
  if (campaign.audience_group_id) {
    joinClause = ' JOIN contact_group_members m ON m.contact_id = c.id';
    extraClauses += ' AND m.group_id = ?';
    params.push(campaign.audience_group_id);
  }
  const [contacts] = await pool.query(
    `SELECT DISTINCT c.id, c.email FROM newsletter_contacts c${joinClause} WHERE c.status = ?${extraClauses}`,
    params
  );

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
        ? await rewriteLinksForTracking(campaign.body, sendId)
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
    [sent, req.params.id]
  );
  const [updated] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  res.json({ campaign: serialize(updated[0]), sent, bounced, undelivered });
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
    links,
  });
});

module.exports = router;

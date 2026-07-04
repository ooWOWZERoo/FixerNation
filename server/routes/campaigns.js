const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { sendCampaignEmail } = require('../lib/mailer');

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

  let sent = 0, failed = 0;
  for (const contact of contacts) {
    const token = crypto.randomBytes(24).toString('hex');
    try {
      await sendCampaignEmail({
        to: contact.email,
        fromName: campaign.from_name,
        fromEmail: campaign.from_email,
        subject: campaign.subject,
        body: campaign.body,
        bodyFormat: campaign.body_format,
        trackingToken: token,
      });
      await pool.query(
        'INSERT INTO campaign_sends (campaign_id, contact_id, email, token, status) VALUES (?, ?, ?, ?, ?)',
        [campaign.id, contact.id, contact.email, token, 'sent']
      );
      sent++;
    } catch (err) {
      console.error(`Failed to send campaign ${campaign.id} to ${contact.email}:`, err.message);
      await pool.query(
        'INSERT INTO campaign_sends (campaign_id, contact_id, email, token, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
        [campaign.id, contact.id, contact.email, token, 'failed', err.message.slice(0, 500)]
      );
      failed++;
    }
  }

  await pool.query(
    "UPDATE campaigns SET status = 'Sent', sent_at = NOW(), recipient_count = ? WHERE id = ?",
    [sent, req.params.id]
  );
  const [updated] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  res.json({ campaign: serialize(updated[0]), sent, failed });
});

router.get('/:id/stats', requireAuth, async (req, res) => {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS total,
       SUM(status = 'sent') AS sent,
       SUM(status = 'failed') AS failed,
       SUM(opened_at IS NOT NULL) AS opened,
       SUM(unsubscribed_at IS NOT NULL) AS unsubscribed
     FROM campaign_sends WHERE campaign_id = ?`,
    [req.params.id]
  );
  const sentCount = row.sent || 0;
  res.json({
    stats: {
      total: row.total,
      sent: sentCount,
      failed: row.failed || 0,
      opened: row.opened || 0,
      unsubscribed: row.unsubscribed || 0,
      openRate: sentCount > 0 ? (row.opened || 0) / sentCount : 0,
    },
  });
});

module.exports = router;

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { sendCampaignEmail } = require('../lib/mailer');

const router = express.Router();

function serialize(row) {
  return {
    id: row.id,
    subject: row.subject,
    fromName: row.from_name,
    fromEmail: row.from_email,
    audienceFilter: { status: row.audience_status, source: row.audience_source },
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

router.post('/', requireAuth, async (req, res) => {
  const c = req.body || {};
  if (!c.subject) return res.status(400).json({ error: 'Subject is required' });

  const [result] = await pool.query(
    `INSERT INTO campaigns (subject, from_name, from_email, audience_status, audience_source, body, body_format, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft')`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', c.body || '', c.bodyFormat || 'text']
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
    `UPDATE campaigns SET subject=?, from_name=?, from_email=?, audience_status=?, audience_source=?, body=?, body_format=?
     WHERE id=?`,
    [c.subject, c.fromName || 'Fixer Nation', c.fromEmail || '', (c.audienceFilter && c.audienceFilter.status) || 'Subscribed', (c.audienceFilter && c.audienceFilter.source) || 'All', c.body || '', c.bodyFormat || 'text', req.params.id]
  );
  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  res.json({ campaign: serialize(rows[0]) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM campaigns WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Campaign not found' });
  res.json({ ok: true });
});

// Sends the campaign for real via SMTP. Regardless of the audience_status
// filter stored on the campaign, delivery ALWAYS excludes unsubscribed
// contacts — that filter only ever narrows further (e.g. by source), it can
// never be used to reach people who opted out.
router.post('/:id/send', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Campaign not found' });
  const campaign = rows[0];

  const params = ['Subscribed'];
  let sourceClause = '';
  if (campaign.audience_source && campaign.audience_source !== 'All') {
    sourceClause = ' AND source = ?';
    params.push(campaign.audience_source);
  }
  const [contacts] = await pool.query(`SELECT email FROM newsletter_contacts WHERE status = ?${sourceClause}`, params);

  let sent = 0, failed = 0;
  for (const contact of contacts) {
    try {
      await sendCampaignEmail({
        to: contact.email,
        fromName: campaign.from_name,
        fromEmail: campaign.from_email,
        subject: campaign.subject,
        body: campaign.body,
        bodyFormat: campaign.body_format,
      });
      sent++;
    } catch (err) {
      console.error(`Failed to send campaign ${campaign.id} to ${contact.email}:`, err.message);
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

module.exports = router;

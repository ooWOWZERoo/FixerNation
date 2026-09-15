// Run via cPanel Cron Job every 5 minutes. Three independent jobs:
//   1. One-off scheduled campaigns (campaigns.status='Scheduled', due now)
//      — enqueued for sending (their first batch fires immediately).
//   2. Recurring series (campaign_series.is_active=1, due now) — each
//      spawns a brand-new, independently-tracked `campaigns` occurrence
//      (own recipient_count/opens/clicks) rather than resending the same
//      row, then enqueues it the same way.
//   3. Campaigns already mid-send (status='Sending', next_batch_at due) —
//      picks up their next batch. See processCampaignBatch() in
//      server/routes/campaigns.js for why sending is batched at all
//      (avoids firing an entire large audience in one uninterrupted burst).
// A failure on one campaign/occurrence never blocks the others in the
// same run — each is wrapped in its own try/catch.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { enqueueCampaignForSending, processCampaignBatch, computeNextFireAt } = require('../routes/campaigns');

async function sendDueScheduledCampaigns() {
  const [rows] = await pool.query("SELECT id, subject FROM campaigns WHERE status = 'Scheduled' AND scheduled_for <= NOW()");
  for (const row of rows) {
    try {
      const result = await enqueueCampaignForSending(row.id);
      console.log(`[scheduled] Started campaign ${row.id} ("${row.subject}") — first batch: ${result.sent} sent, ${result.remaining} remaining`);
    } catch (err) {
      console.error(`[scheduled] Failed to start campaign ${row.id} ("${row.subject}"):`, err.message || err);
    }
  }
  return rows.length;
}

async function spawnAndSendOccurrence(series) {
  const [result] = await pool.query(
    `INSERT INTO campaigns (subject, from_name, from_email, audience_status, audience_source, body, body_format, status, series_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Draft', ?)`,
    [series.subject, series.from_name, series.from_email, series.audience_status, series.audience_source, series.body, series.body_format, series.id]
  );
  const campaignId = result.insertId;

  const [groupRows] = await pool.query('SELECT group_id FROM campaign_series_groups WHERE series_id = ?', [series.id]);
  if (groupRows.length) {
    const values = groupRows.map(g => [campaignId, g.group_id]);
    await pool.query('INSERT IGNORE INTO campaign_audience_groups (campaign_id, group_id) VALUES ?', [values]);
  }

  return enqueueCampaignForSending(campaignId);
}

async function fireDueSeries() {
  const [seriesRows] = await pool.query('SELECT * FROM campaign_series WHERE is_active = 1 AND next_fire_at <= NOW()');
  for (const series of seriesRows) {
    try {
      const result = await spawnAndSendOccurrence(series);
      console.log(`[recurring] Fired series ${series.id} ("${series.subject}") — first batch: ${result.sent} sent, ${result.remaining} remaining`);
    } catch (err) {
      console.error(`[recurring] Failed to fire series ${series.id} ("${series.subject}"):`, err.message || err);
      // Still advance next_fire_at below even on failure — a persistently
      // broken series (bad SMTP config, etc.) should not fire every 5
      // minutes forever; it advances to its next real scheduled slot like
      // any other occurrence, and the admin sees the failure in server logs.
    }
    // Always advance strictly after the slot that was just due — anchored
    // to the previous next_fire_at (not "now"), so a delayed cron run never
    // skips or double-books an occurrence.
    const nextFireAt = computeNextFireAt(series, series.next_fire_at, false);
    await pool.query('UPDATE campaign_series SET last_fired_at = NOW(), next_fire_at = ? WHERE id = ?', [nextFireAt, series.id]);
  }
  return seriesRows.length;
}

async function processDueBatches() {
  const [rows] = await pool.query("SELECT id, subject FROM campaigns WHERE status = 'Sending' AND next_batch_at <= NOW()");
  for (const row of rows) {
    try {
      const result = await processCampaignBatch(row.id);
      console.log(`[batch] Campaign ${row.id} ("${row.subject}") — batch: ${result.sent} sent, ${result.remaining} remaining`);
    } catch (err) {
      console.error(`[batch] Failed to process batch for campaign ${row.id} ("${row.subject}"):`, err.message || err);
    }
  }
  return rows.length;
}

async function main() {
  const scheduledCount = await sendDueScheduledCampaigns();
  const seriesCount = await fireDueSeries();
  const batchCount = await processDueBatches();
  if (!scheduledCount && !seriesCount && !batchCount) console.log('Nothing due.');
  await pool.end();
}

main().catch(err => {
  console.error('send-scheduled-campaigns failed:', err.message);
  process.exit(1);
});

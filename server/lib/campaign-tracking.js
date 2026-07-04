const crypto = require('crypto');
const pool = require('../db/pool');

const HREF_PATTERN = /href="([^"]+)"/gi;

// Rewrites every http(s) link in an HTML campaign body to route through the
// click-tracking redirect, storing each real destination server-side keyed
// by a random link_id — the public click endpoint never trusts a redirect
// target from the request itself, so it can't be abused as an open redirect.
// mailto:/anchor/relative links are left untouched (nothing meaningful to
// track, and no destination_url to safely redirect to).
async function rewriteLinksForTracking(html, sendId) {
  const base = process.env.SITE_URL || '';
  const seen = new Map(); // avoid inserting duplicate rows if the same URL appears twice
  let result = html;
  const matches = [...html.matchAll(HREF_PATTERN)];

  for (const match of matches) {
    const originalUrl = match[1];
    if (!/^https?:\/\//i.test(originalUrl)) continue;

    let trackedUrl = seen.get(originalUrl);
    if (!trackedUrl) {
      const linkId = crypto.randomBytes(12).toString('hex');
      await pool.query(
        'INSERT INTO campaign_link_targets (send_id, link_id, destination_url) VALUES (?, ?, ?)',
        [sendId, linkId, originalUrl]
      );
      trackedUrl = `${base}/api/campaigns/click?l=${linkId}`;
      seen.set(originalUrl, trackedUrl);
    }
    result = result.split(`href="${originalUrl}"`).join(`href="${trackedUrl}"`);
  }

  return result;
}

// Classifies a nodemailer/SMTP send failure using whatever response code the
// relay gave us. A definitive 5xx means the address is permanently rejected
// (bounced); a 4xx or a connection-level failure with no response at all
// (timeout, DNS, refused) means we don't actually know the address is bad —
// that's "undelivered", not a confirmed bounce.
function classifySendError(err) {
  const code = err && err.responseCode;
  if (typeof code === 'number' && code >= 500 && code < 600) return 'bounced';
  return 'undelivered';
}

module.exports = { rewriteLinksForTracking, classifySendError };

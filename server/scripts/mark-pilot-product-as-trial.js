// One-off data fix: the "90-Day Classroom Pilot" license_products row was
// inserted (update-license-product-pricing.js) without is_trial/trial_days
// set, so quote-accept.js had no way to know it should ever expire. Pilot
// purchases are meant to be full, uncapped curriculum access for 90 days
// (not lesson-limited like the self-service 30-Day Trial), but
// trial_lesson_limit IS NOT NULL is the flag both curriculum.js and
// expire-trial-licenses.js use to recognize "this is a trial purchase" —
// so it needs a real (very high, effectively non-binding) number rather
// than NULL, or the purchase is invisible to both as a trial at all.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

const PRODUCT_NAME = '90-Day Classroom Pilot';
const TRIAL_DAYS = 90;
const EFFECTIVELY_UNCAPPED_LESSON_LIMIT = 9999;

(async () => {
  const [result] = await pool.query(
    `UPDATE license_products
     SET is_trial = 1, trial_days = ?, trial_lesson_limit = ?
     WHERE name = ? AND (is_trial = 0 OR trial_days IS NULL OR trial_lesson_limit IS NULL)`,
    [TRIAL_DAYS, EFFECTIVELY_UNCAPPED_LESSON_LIMIT, PRODUCT_NAME]
  );
  console.log(result.affectedRows ? `Updated "${PRODUCT_NAME}" to a proper 90-day trial.` : `"${PRODUCT_NAME}" already correctly flagged — no change.`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });

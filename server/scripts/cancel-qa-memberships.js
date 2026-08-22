// One-off cleanup: cancels the 2 real, currently-billing personal (consumer)
// memberships found while removing FNE's consumer-membership scope entirely
// (see the "scope mismatch" work) — both belong to the account owner's own
// dogfooding accounts from when the membership system was first built and
// verified with a real charge, confirmed via GET /api/memberships
// (memberType: 'consumer' on both, no ties to any teacher/license account).
//
// Cancels the real Stripe subscription (stops future billing) AND marks
// the local contact_memberships row 'cancelled' in the same step — using
// only the admin CRM's PUT /api/memberships/:id (status: 'cancelled')
// would update our own database but never touch Stripe at all, leaving
// both subscriptions billing indefinitely with zero record of them left in
// our own system to even notice.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const Stripe = require('stripe');
const pool = require('../db/pool');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SUBSCRIPTION_IDS = [
  'sub_1TrLfM5S5NgKHluw0hAJIZCE', // jshaw@npax.com
  'sub_1TrIXn5S5NgKHluwdIZZtLDY', // johnfshaw@yahoo.com
];

(async () => {
  for (const subId of SUBSCRIPTION_IDS) {
    try {
      const sub = await stripe.subscriptions.cancel(subId);
      console.log(`Cancelled Stripe subscription ${subId} (status: ${sub.status})`);
    } catch (err) {
      console.error(`Failed to cancel Stripe subscription ${subId}: ${err.message}`);
      continue;
    }

    const [result] = await pool.query(
      "UPDATE contact_memberships SET status = 'cancelled', ends_at = COALESCE(ends_at, NOW()) WHERE stripe_subscription_id = ?",
      [subId]
    );
    console.log(`  -> marked ${result.affectedRows} contact_memberships row(s) cancelled locally.`);
  }
  console.log('Done.');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });

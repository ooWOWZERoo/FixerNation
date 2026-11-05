// Finds seats bought for a person's own email (a trial or single license) that were left 'pending' because that person already
// had an account, so they were told they needed a license they had paid for. Seats a school administrator invited someone to are
// left alone. See lib/own-seat-claim.js.
//
//   node scripts/claim-own-purchase-seats.js            DRY RUN: lists them, changes nothing
//   node scripts/claim-own-purchase-seats.js --apply    claims them (the same as signing in would)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { findClaimableSeats, claimForAccountByEmail } = require('../lib/own-seat-claim');

async function main() {
  const apply = process.argv.includes('--apply');
  const found = await findClaimableSeats(pool);
  console.log(apply ? 'APPLYING' : 'DRY RUN (nothing was changed; add --apply to claim them)');
  console.log(`Seats waiting for an existing account: ${found.length}`);
  found.forEach((f) => console.log(`  seat ${f.seatId}: ${f.name || '(no name)'} <${f.email}>`));
  if (apply) {
    for (const email of [...new Set(found.map((f) => f.email))]) {
      const n = await claimForAccountByEmail(pool, email);
      console.log(`  claimed ${n} for ${email}`);
    }
  }
  await pool.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });

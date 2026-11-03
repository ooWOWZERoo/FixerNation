// READ-ONLY report: accepted quotes that were built on the Annual tab with Additional Seats, and whether the license each one
// created has those seats. Before Release 95 the added seats were charged on the quote but never added to the license, so a
// license from such a quote can be short. This script changes nothing; staff fix a short license by hand with the seat-count
// editor on admin-licenses.html.
//
//   node scripts/report-quote-added-seats.js                 quotes accepted before 2026-11-04 (the day this fix went live)
//   node scripts/report-quote-added-seats.js --before=2026-12-01
//
// How a row is judged: an Annual quote saved the old way recorded the tier's seats in quoted_seat_count and the added seats in
// quoted_addon_seats, so its license should have quoted_seat_count + quoted_addon_seats seats. A quote built on the Add-On Seats
// tab records the same number in both columns and is left out. Quotes accepted on or after the cutoff already include the added
// seats in quoted_seat_count and are not listed.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Pure, so it can be tested: what the license should have had, and whether it is short.
function judge(row) {
  const quoted = Number(row.quoted_seat_count) || 0;
  const added = Number(row.quoted_addon_seats) || 0;
  const shouldHave = quoted + added;
  const has = row.purchase_seats == null ? null : Number(row.purchase_seats);
  return { shouldHave, has, short: has == null ? null : Math.max(0, shouldHave - has) };
}

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--before='));
  const before = arg ? arg.slice('--before='.length) : '2026-11-04';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new Error('--before must look like 2026-12-01');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const [rows] = await conn.query(
    `SELECT q.id AS quote_id, q.quote_number, q.school, q.email, q.accepted_at, q.quoted_seat_count, q.quoted_addon_seats,
            q.quoted_amount_cents, p.id AS purchase_id, p.seat_count AS purchase_seats, p.school_domain
     FROM quote_requests q
     LEFT JOIN purchases p ON p.quote_id = q.id
     WHERE q.accepted_at IS NOT NULL AND q.accepted_at < ?
       AND q.quoted_addon_seats > 0 AND q.quoted_addon_seats <> q.quoted_seat_count
     ORDER BY q.accepted_at`,
    [before]
  );
  await conn.end();

  if (!rows.length) { console.log(`No accepted Annual quotes with added seats before ${before}. Nothing to fix.`); return; }
  let shortCount = 0;
  for (const r of rows) {
    const j = judge(r);
    if (j.short) shortCount++;
    const flag = j.has == null ? 'NO LICENSE FOUND' : (j.short ? `SHORT by ${j.short}` : 'ok');
    console.log([
      `quote #${r.quote_number || r.quote_id}`, r.school || r.email, `accepted ${String(r.accepted_at).slice(0, 10)}`,
      `quoted ${r.quoted_seat_count} + ${r.quoted_addon_seats} added`, `$${((r.quoted_amount_cents || 0) / 100).toFixed(2)}`,
      `purchase ${r.purchase_id || '-'} has ${j.has == null ? '-' : j.has} (should have ${j.shouldHave})`, r.school_domain || '', flag,
    ].join(' | '));
  }
  console.log(`\n${rows.length} quote(s) listed, ${shortCount} license(s) short. Nothing was changed.`);
}

module.exports = { judge };
if (require.main === module) main().catch((e) => { console.error('report-quote-added-seats failed:', e.message); process.exit(1); });

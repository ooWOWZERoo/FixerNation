// The one place seats are counted. Every page and every "is there room?" check uses this, so the numbers an
// admin sees and the numbers that decide whether an invitation goes through cannot disagree.
// Rules (docs/reference/seat-counts-requirements.md):
//   assigned  = registered + inactive + pending   (a deactivated teacher still holds a seat; an invite reserves one)
//   available = max(0, total - assigned)
//   revoked and 'available' placeholder rows use no seat
//   school and district admins never use a seat (notAdminSeatClause)
const pool = require('../db/pool');

// A seat is excluded from admin-facing seat counts/rosters/reports when its registered site_user also holds an
// active school or district admin assignment (anywhere, not just this school/district): administrators don't
// consume a license and shouldn't inflate "registered teacher" totals.
// `alias` is the table name or alias the query's license_seats rows use.
function notAdminSeatClause(alias) {
  return `(${alias}.registered_site_user_id IS NULL OR (
    NOT EXISTS (SELECT 1 FROM school_license_admins sla WHERE sla.site_user_id = ${alias}.registered_site_user_id AND sla.is_active = 1)
    AND NOT EXISTS (SELECT 1 FROM district_license_admins dla WHERE dla.site_user_id = ${alias}.registered_site_user_id AND dla.is_active = 1)
  ))`;
}

// `db` is the pool, or a connection when the caller is inside a transaction that already locked the purchase row.
async function getSeatCounts(purchaseId, db = pool) {
  const [[purchase]] = await db.query('SELECT seat_count FROM purchases WHERE id = ?', [purchaseId]);
  const [[c]] = await db.query(
    `SELECT
       SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS registered,
       SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked
     FROM license_seats WHERE purchase_id = ? AND ${notAdminSeatClause('license_seats')}`,
    [purchaseId]
  );
  const total = Number(purchase && purchase.seat_count) || 0;
  const registered = Number(c.registered || 0);
  const inactive = Number(c.inactive || 0);
  const pending = Number(c.pending || 0);
  const revoked = Number(c.revoked || 0);
  const assigned = registered + inactive + pending;
  return {
    total,
    registered,
    inactive,
    pending,
    revoked,
    assigned,
    available: Math.max(0, total - assigned),
    pctUsed: total > 0 ? Math.round((assigned / total) * 100) : 0,
  };
}

// The same counts for many purchases in two queries (a district's schools table), as a Map of purchaseId -> counts.
// Placeholders are built by hand so the SQL stays portable (the tests run it on node:sqlite).
async function getSeatCountsForPurchases(purchaseIds, db = pool) {
  const ids = [...new Set((purchaseIds || []).map(Number).filter(Number.isInteger))];
  const out = new Map();
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const [purchases] = await db.query(`SELECT id, seat_count FROM purchases WHERE id IN (${marks})`, ids);
  const [rows] = await db.query(
    `SELECT purchase_id,
            SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) AS registered,
            SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'revoked' THEN 1 ELSE 0 END) AS revoked
     FROM license_seats WHERE purchase_id IN (${marks}) AND ${notAdminSeatClause('license_seats')}
     GROUP BY purchase_id`,
    ids
  );
  const byPurchase = new Map(rows.map((r) => [Number(r.purchase_id), r]));
  for (const pr of purchases) {
    const c = byPurchase.get(Number(pr.id)) || {};
    const total = Number(pr.seat_count) || 0;
    const registered = Number(c.registered || 0), inactive = Number(c.inactive || 0), pending = Number(c.pending || 0), revoked = Number(c.revoked || 0);
    const assigned = registered + inactive + pending;
    out.set(Number(pr.id), { total, registered, inactive, pending, revoked, assigned, available: Math.max(0, total - assigned), pctUsed: total > 0 ? Math.round((assigned / total) * 100) : 0 });
  }
  return out;
}

module.exports = { getSeatCounts, getSeatCountsForPurchases, notAdminSeatClause };

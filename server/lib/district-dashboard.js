// The district administrator's landing page (docs/reference/district-dashboard-requirements.md).
// COUNTS AND SCHOOL-LEVEL FACTS ONLY: no teacher names or emails, no student data. Every figure comes from the
// district's own schools (scoped by districtId, which the route resolves against req.districtAdmin.districtIds).
// Seat figures use lib/seat-counts.js and the "is it open" rule uses lib/license-access.js, so the district sees the
// same numbers as each school's own administrator.
const pool = require('../db/pool');
const { getSeatCountsForPurchases } = require('./seat-counts');
const { licenseAccess } = require('./license-access');
const districtStandards = require('./district-standards');

const EXPIRING_DAYS = 90;      // a license ending within this many days is flagged
const NEARLY_FULL_PCT = 90;    // good news: ask to add seats
const LOW_ADOPTION_PCT = 25;   // assigned under this share ...
const LOW_ADOPTION_AFTER_DAYS = 60; // ... this long after the license started
const IN_FORCE = ['active', 'expiring_soon'];

const DAY = 24 * 60 * 60 * 1000;
const day = (v) => (v ? Date.parse(String(v).slice(0, 10) + 'T00:00:00Z') : null);

function statusLabel(p, access) {
  if (access.reason === 'po_not_received') return 'Waiting for purchase order';
  if (access.reason === 'payment_pending') return 'Payment pending';
  if (p.license_status === 'expired') return 'Expired';
  if (p.license_status === 'scheduled') return 'Starts later';
  if (p.license_status === 'expiring_soon') return 'Ending soon';
  if (IN_FORCE.includes(p.license_status || 'active')) return 'In force';
  return 'Not active';
}

// Pure: rows are the district's group-license purchases; counts is Map(purchaseId -> seat counts);
// adminsByPurchase is Map(purchaseId -> Set of site_user ids); today is a Date.
function buildDashboard({ rows, counts, adminsByPurchase, today = new Date() }) {
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const schools = new Set();
  const adminIds = new Set();
  const stats = { schools: 0, seatsTotal: 0, seatsAssigned: 0, seatsAvailable: 0, pctUsed: 0, activeTeachers: 0, schoolAdmins: 0 };
  const attention = { expiring: [], awaitingPO: [], noAdmin: [], lowAdoption: [], nearlyFull: [] };
  const table = [];

  for (const p of rows) {
    const c = counts.get(Number(p.purchase_id)) || { total: Number(p.seat_count) || 0, registered: 0, assigned: 0, available: 0, pctUsed: 0 };
    const access = licenseAccess(p);
    const inForce = IN_FORCE.includes(p.license_status || 'active');
    const admins = adminsByPurchase.get(Number(p.purchase_id)) || new Set();
    const name = p.school_display_name || p.school_domain || 'School';
    schools.add(p.school_id);
    admins.forEach((id) => adminIds.add(id));
    const base = { purchaseId: p.purchase_id, school: name, domain: p.school_domain, plan: p.plan_name || 'Group License' };

    const flags = [];
    if (access.reason === 'po_not_received') {
      attention.awaitingPO.push({ ...base });
      flags.push('Waiting for purchase order');
    }
    if (inForce) {
      stats.seatsTotal += c.total; stats.seatsAssigned += c.assigned; stats.seatsAvailable += c.available; stats.activeTeachers += c.registered;
      const endsAt = day(p.expiration_date);
      if (endsAt !== null) {
        const daysLeft = Math.round((endsAt - t) / DAY);
        if (daysLeft >= 0 && daysLeft <= EXPIRING_DAYS) { attention.expiring.push({ ...base, expires: String(p.expiration_date).slice(0, 10), daysLeft }); flags.push(`Ends in ${daysLeft} days`); }
      }
      if (admins.size === 0) { attention.noAdmin.push({ ...base }); flags.push('No school administrator'); }
      const startedAt = day(p.effective_date) ?? day(p.purchased_at);
      if (c.total > 0 && startedAt !== null && (t - startedAt) / DAY >= LOW_ADOPTION_AFTER_DAYS && c.pctUsed < LOW_ADOPTION_PCT) {
        attention.lowAdoption.push({ ...base, assigned: c.assigned, total: c.total, pctUsed: c.pctUsed }); flags.push('Few seats in use');
      }
      if (c.total > 0 && c.pctUsed >= NEARLY_FULL_PCT) { attention.nearlyFull.push({ ...base, assigned: c.assigned, total: c.total, pctUsed: c.pctUsed }); flags.push('Nearly full'); }
    }
    table.push({ ...base, status: statusLabel(p, access), seats: { total: c.total, assigned: c.assigned, pctUsed: c.pctUsed }, expires: p.expiration_date ? String(p.expiration_date).slice(0, 10) : null, admins: admins.size, flags });
  }
  stats.schools = schools.size;
  stats.schoolAdmins = adminIds.size;
  stats.pctUsed = stats.seatsTotal > 0 ? Math.round((stats.seatsAssigned / stats.seatsTotal) * 100) : 0;
  return { stats, attention, schools: table, thresholds: { expiringDays: EXPIRING_DAYS, nearlyFullPct: NEARLY_FULL_PCT, lowAdoptionPct: LOW_ADOPTION_PCT, lowAdoptionAfterDays: LOW_ADOPTION_AFTER_DAYS } };
}

// Portrait of a Graduate status for the district's own frameworks (counts only).
function portraitSummary(frameworks) {
  const pog = frameworks.filter((f) => f.type === 'portrait_of_graduate');
  const published = pog.filter((f) => f.status === 'published');
  let attributes = 0, withConnection = 0;
  published.forEach((f) => f.items.forEach((it) => { attributes++; if (it.alignments.some((a) => a.status === 'verified')) withConnection++; }));
  return { frameworks: pog.length, published: published.length, inReview: pog.filter((f) => f.status === 'in_review').length, draft: pog.filter((f) => f.status === 'draft').length, attributes, attributesWithVerifiedConnection: withConnection };
}

async function loadDashboard(districtIds, districtId, today = new Date()) {
  const [rows] = await pool.query(
    `SELECT p.id AS purchase_id, p.school_domain, p.seat_count, p.payment_status, p.payment_method, p.license_status,
            p.expiration_date, p.effective_date, p.purchased_at,
            s.id AS school_id, s.display_name AS school_display_name, lp.name AS plan_name
     FROM purchases p
     JOIN schools s ON (s.id = p.school_id OR s.domain = p.school_domain)
     LEFT JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.product_type = 'group_license' AND s.district_id = ?
     ORDER BY s.domain, p.purchased_at DESC`,
    [districtId]
  );
  const ids = rows.map((r) => r.purchase_id);
  const counts = await getSeatCountsForPurchases(ids);
  const adminsByPurchase = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    // Active school administrators, not counting anyone who is also a district administrator (a different tier).
    const [admins] = await pool.query(
      `SELECT sla.purchase_id, sla.site_user_id FROM school_license_admins sla
       WHERE sla.purchase_id IN (${marks}) AND sla.is_active = 1
         AND NOT EXISTS (SELECT 1 FROM district_license_admins dla WHERE dla.site_user_id = sla.site_user_id AND dla.is_active = 1)`,
      ids
    );
    admins.forEach((a) => { const k = Number(a.purchase_id); if (!adminsByPurchase.has(k)) adminsByPurchase.set(k, new Set()); adminsByPurchase.get(k).add(a.site_user_id); });
  }
  const data = buildDashboard({ rows, counts, adminsByPurchase, today });
  const own = await districtStandards.listOwn(districtIds, districtId);
  data.portrait = portraitSummary(own.frameworks);
  return data;
}

module.exports = { buildDashboard, portraitSummary, loadDashboard, EXPIRING_DAYS };

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toDollars(cents) {
  return cents === null || cents === undefined ? 0 : Number(cents) / 100;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Chart date range is its own endpoint (rather than a param on
// financial-summary) so switching the range doesn't require re-fetching
// everything else on the dashboard. Defaults to the last 14 days.
router.get('/sales-over-time', requireAuth, async (req, res) => {
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 13);

  let start = DATE_PATTERN.test(req.query.start) ? req.query.start : isoDate(defaultStart);
  let end = DATE_PATTERN.test(req.query.end) ? req.query.end : isoDate(today);
  if (start > end) [start, end] = [end, start];

  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  const rangeDays = Math.round((endDate - startDate) / 86400000);
  if (rangeDays > MAX_RANGE_DAYS) {
    endDate.setUTCDate(startDate.getUTCDate() + MAX_RANGE_DAYS);
    end = isoDate(endDate);
  }

  const [dailyRows] = await pool.query(
    `SELECT DATE(purchased_at) AS day, COALESCE(SUM(amount_cents),0) AS cents
     FROM purchases WHERE DATE(purchased_at) BETWEEN ? AND ?
     GROUP BY DATE(purchased_at)`,
    [start, end]
  );
  const dailyByDate = {};
  dailyRows.forEach(r => {
    const key = isoDate(r.day instanceof Date ? r.day : new Date(r.day));
    dailyByDate[key] = toDollars(r.cents);
  });

  const salesOverTime = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const key = isoDate(cursor);
    salesOverTime.push({ date: key, total: dailyByDate[key] || 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  res.json({ salesOverTime, start, end });
});

// Single aggregated endpoint for the dashboard's Financial Insights section —
// computed in SQL rather than the "fetch full list, reduce client-side"
// pattern used elsewhere, since purchases can grow large over time.
router.get('/financial-summary', requireAuth, async (req, res) => {
  const [[salesTodayRow]] = await pool.query(
    "SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS orders FROM purchases WHERE DATE(purchased_at) = CURDATE()"
  );
  const [[salesWeekRow]] = await pool.query(
    "SELECT COALESCE(SUM(amount_cents),0) AS cents FROM purchases WHERE purchased_at >= NOW() - INTERVAL 7 DAY"
  );
  const [[salesMonthRow]] = await pool.query(
    "SELECT COALESCE(SUM(amount_cents),0) AS cents FROM purchases WHERE purchased_at >= NOW() - INTERVAL 30 DAY"
  );
  const [[salesAllTimeRow]] = await pool.query(
    "SELECT COALESCE(SUM(amount_cents),0) AS cents, COUNT(*) AS orders FROM purchases"
  );
  const [[revenueRow]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN amount_cents ELSE 0 END),0) AS collected_cents,
       COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN amount_cents ELSE 0 END),0) AS outstanding_cents
     FROM purchases`
  );

  // "Best selling item" spans three separate item universes: books, fixed
  // license_products tiers, and the flat single-teacher-license product
  // (which has no row of its own — it's a hardcoded price in checkout.js).
  const [bookRows] = await pool.query(
    `SELECT p.book_id AS id, b.title AS name, COUNT(*) AS units, COALESCE(SUM(p.amount_cents),0) AS cents
     FROM purchases p JOIN books b ON b.id = p.book_id
     WHERE p.product_type = 'book' GROUP BY p.book_id, b.title`
  );
  const [licenseProductRows] = await pool.query(
    `SELECT p.license_product_id AS id, lp.name AS name, COUNT(*) AS units, COALESCE(SUM(p.amount_cents),0) AS cents
     FROM purchases p JOIN license_products lp ON lp.id = p.license_product_id
     WHERE p.product_type = 'group_license' AND p.license_product_id IS NOT NULL GROUP BY p.license_product_id, lp.name`
  );
  const [[singleLicenseRow]] = await pool.query(
    "SELECT COUNT(*) AS units, COALESCE(SUM(amount_cents),0) AS cents FROM purchases WHERE product_type = 'single_license'"
  );
  const [membershipPlanRows] = await pool.query(
    `SELECT p.membership_plan_id AS id, mp.name AS name, COUNT(*) AS units, COALESCE(SUM(p.amount_cents),0) AS cents
     FROM purchases p JOIN membership_plans mp ON mp.id = p.membership_plan_id
     WHERE p.product_type = 'membership' GROUP BY p.membership_plan_id, mp.name`
  );

  const items = [
    ...bookRows.map(r => ({ type: 'book', name: r.name, unitsSold: r.units, revenue: toDollars(r.cents) })),
    ...licenseProductRows.map(r => ({ type: 'license_product', name: r.name, unitsSold: r.units, revenue: toDollars(r.cents) })),
    ...membershipPlanRows.map(r => ({ type: 'membership', name: r.name, unitsSold: r.units, revenue: toDollars(r.cents) })),
  ];
  if (singleLicenseRow.units > 0) {
    items.push({ type: 'single_license', name: 'Single Teacher License', unitsSold: singleLicenseRow.units, revenue: toDollars(singleLicenseRow.cents) });
  }
  items.sort((a, b) => b.revenue - a.revenue);

  const [[invoiceTotals]] = await pool.query(
    `SELECT COUNT(*) AS total,
       SUM(status = 'unpaid') AS unpaid,
       SUM(status = 'paid') AS paid,
       SUM(status = 'cancelled') AS cancelled,
       COALESCE(SUM(CASE WHEN status = 'unpaid' THEN total_cents ELSE 0 END),0) AS outstanding_cents
     FROM invoices`
  );

  const [[quoteTotals]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(created_at >= NOW() - INTERVAL 30 DAY) AS last30 FROM quote_requests"
  );

  const [[activeCustomersRow]] = await pool.query(
    "SELECT COUNT(DISTINCT contact_id) AS count FROM purchases WHERE purchased_at >= NOW() - INTERVAL 30 DAY"
  );

  res.json({
    salesToday: toDollars(salesTodayRow.cents),
    ordersToday: salesTodayRow.orders,
    salesThisWeek: toDollars(salesWeekRow.cents),
    salesThisMonth: toDollars(salesMonthRow.cents),
    salesAllTime: toDollars(salesAllTimeRow.cents),
    ordersAllTime: salesAllTimeRow.orders,
    averageOrderValue: salesAllTimeRow.orders > 0 ? toDollars(salesAllTimeRow.cents) / salesAllTimeRow.orders : 0,
    revenueCollected: toDollars(revenueRow.collected_cents),
    revenueOutstanding: toDollars(revenueRow.outstanding_cents),
    bestSellingItem: items[0] || null,
    topItems: items.slice(0, 5),
    invoices: {
      total: invoiceTotals.total,
      unpaid: invoiceTotals.unpaid || 0,
      paid: invoiceTotals.paid || 0,
      cancelled: invoiceTotals.cancelled || 0,
      outstandingTotal: toDollars(invoiceTotals.outstanding_cents),
    },
    quotes: {
      total: quoteTotals.total,
      last30Days: quoteTotals.last30 || 0,
    },
    activeCustomersLast30Days: activeCustomersRow.count,
  });
});

// The 6 metrics from the old static "Recommended Insights" list, now
// computed for real from live data.
router.get('/insights', requireAuth, async (req, res) => {
  // 1. Month-over-month growth
  const [[momRow]] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN purchased_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN amount_cents ELSE 0 END), 0) AS this_month_cents,
       COALESCE(SUM(CASE WHEN purchased_at >= DATE_FORMAT(NOW() - INTERVAL 1 MONTH, '%Y-%m-01') AND purchased_at < DATE_FORMAT(NOW(), '%Y-%m-01') THEN amount_cents ELSE 0 END), 0) AS last_month_cents
     FROM purchases`
  );
  const thisMonth = toDollars(momRow.this_month_cents);
  const lastMonth = toDollars(momRow.last_month_cents);
  const momGrowthPct = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null;

  // 2. Quote-to-sale conversion rate
  const [[quoteConvRow]] = await pool.query(
    `SELECT COUNT(DISTINCT qr.email) AS total_quotes,
       COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN qr.email END) AS converted
     FROM quote_requests qr
     LEFT JOIN newsletter_contacts nc ON nc.email = qr.email
     LEFT JOIN purchases p ON p.contact_id = nc.id AND p.product_type IN ('single_license', 'group_license')`
  );
  const totalQuotes = quoteConvRow.total_quotes || 0;
  const convertedQuotes = quoteConvRow.converted || 0;

  // 3. Revenue by category
  const [categoryRows] = await pool.query(
    "SELECT product_type, COALESCE(SUM(amount_cents),0) AS cents FROM purchases GROUP BY product_type"
  );
  const categoryByType = Object.fromEntries(categoryRows.map(r => [r.product_type, toDollars(r.cents)]));
  const categoryTotal = Object.values(categoryByType).reduce((a, b) => a + b, 0);
  const CATEGORY_LABELS = {
    book: 'Books', single_license: 'Single Teacher Licenses', group_license: 'School/Group Licenses', membership: 'Memberships',
  };
  const revenueByCategory = ['book', 'single_license', 'group_license', 'membership'].map(type => ({
    type,
    label: CATEGORY_LABELS[type],
    revenue: categoryByType[type] || 0,
    percentOfTotal: categoryTotal > 0 ? ((categoryByType[type] || 0) / categoryTotal) * 100 : 0,
  }));

  // 4. Days sales outstanding
  const [[dsoRow]] = await pool.query(
    "SELECT AVG(DATEDIFF(paid_at, created_at)) AS avg_days FROM invoices WHERE status = 'paid' AND paid_at IS NOT NULL"
  );

  // 5. Customer lifetime value
  const [[ltvRow]] = await pool.query(
    `SELECT AVG(contact_total) AS avg_cents FROM (
       SELECT contact_id, SUM(amount_cents) AS contact_total FROM purchases GROUP BY contact_id
     ) t`
  );

  // 6. Refund/cancellation rate
  const [[cancelRow]] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(status = 'cancelled') AS cancelled FROM invoices"
  );
  const totalInvoices = cancelRow.total || 0;
  const cancelledInvoices = cancelRow.cancelled || 0;

  res.json({
    monthOverMonthGrowth: {
      thisMonth,
      lastMonth,
      growthPercent: momGrowthPct,
    },
    quoteToSaleConversion: {
      totalQuotes,
      convertedQuotes,
      conversionRate: totalQuotes > 0 ? convertedQuotes / totalQuotes : null,
    },
    revenueByCategory,
    daysSalesOutstanding: dsoRow.avg_days === null ? null : Number(dsoRow.avg_days),
    customerLifetimeValue: toDollars(ltvRow.avg_cents),
    cancellationRate: {
      totalInvoices,
      cancelledInvoices,
      rate: totalInvoices > 0 ? cancelledInvoices / totalInvoices : null,
    },
  });
});

module.exports = router;

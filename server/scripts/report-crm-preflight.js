require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// READ-ONLY. Phase 0 of the sales CRM update (docs/reference/sales-crm-update-requirements.md).
// Before any CRM table or backfill exists, this prints COUNTS ONLY about the data the backfill will read: never a name, an email, a
// school, a quote number or an amount. It writes nothing. Run it on cPanel (production is not reachable from the dev machine):
//
//   node scripts/report-crm-preflight.js
//
// A check that cannot run (a column is missing in this database) prints "skipped" and the reason; the rest still run.
// The "qualifying paid purchase" test here is the DRAFT of decision D3. Phase 1 turns it into lib/crm-classification.js with tests; if the
// two ever disagree, that file is the authority and this script is out of date.

// D3 (draft): paid, a real amount, and not a trial of any kind. A NULL amount (manual entry) is NOT counted; it goes to review.
const FROM_PURCHASES = 'FROM purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id';
const TRIAL_LIKE = '(COALESCE(lp.is_trial, 0) = 1 OR p.trial_lesson_limit IS NOT NULL OR p.trial_expiration_date IS NOT NULL)';
const QUALIFYING = `p.payment_status = 'paid' AND p.amount_cents > 0 AND NOT ${TRIAL_LIKE}`;

async function main() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });

  // One number.
  const one = async (label, sql, note) => {
    try {
      const [[row]] = await conn.query(sql);
      const n = Object.values(row)[0];
      console.log(`  ${String(n).padStart(6)}  ${label}${note ? '  (' + note + ')' : ''}`);
    } catch (err) {
      console.log(`  skipped  ${label}: ${err.code || err.message}`);
    }
  };
  // A small table of "bucket: count" for a column that holds a handful of fixed values (status, payment method...). Never used on a
  // column that can hold free text.
  const buckets = async (label, sql) => {
    try {
      const [rows] = await conn.query(sql);
      console.log(`  ${label}: ` + (rows.length ? rows.map(r => `${r.k === null ? '(none)' : r.k} = ${r.n}`).join(', ') : 'none'));
    } catch (err) {
      console.log(`  skipped  ${label}: ${err.code || err.message}`);
    }
  };
  const head = t => console.log(`\n${t}`);

  try {
    console.log('\nCRM preflight (read-only, counts only)\n');

    head('1. Size');
    for (const t of ['newsletter_contacts', 'quote_requests', 'purchases', 'invoices', 'admin_users', 'schools', 'districts', 'support_requests', 'public_demo_invitations']) {
      await one(t, `SELECT COUNT(*) FROM ${t}`);
    }

    head('1b. Test and internal rows (the 2026-09-05 go-live reset cleared purchases and quotes, but contacts were kept)');
    await one('contacts with an @example.com address (QA and demo)', `SELECT COUNT(*) FROM newsletter_contacts WHERE LOWER(TRIM(email)) LIKE '%@example.com'`, 'the backfill should skip these');
    await one('quotes from an @example.com address', `SELECT COUNT(*) FROM quote_requests WHERE LOWER(TRIM(email)) LIKE '%@example.com'`);
    await one('purchases owned by an @example.com contact', `SELECT COUNT(*) FROM purchases p JOIN newsletter_contacts c ON c.id = p.contact_id WHERE LOWER(TRIM(c.email)) LIKE '%@example.com'`);

    head('2. Contacts: duplicate and untidy emails');
    await one('contacts whose email differs only by case or spaces from another contact (extra rows)',
      `SELECT COALESCE(SUM(n - 1), 0) FROM (SELECT COUNT(*) AS n FROM newsletter_contacts GROUP BY LOWER(TRIM(email)) HAVING n > 1) d`,
      'the unique index already stops exact duplicates; this is the normalized check');
    await one('emails with leading or trailing spaces', `SELECT COUNT(*) FROM newsletter_contacts WHERE email <> TRIM(email)`);
    await one('emails not already lowercase', `SELECT COUNT(*) FROM newsletter_contacts WHERE BINARY email <> LOWER(email)`);
    await buckets('subscription status (must be untouched by the CRM)', `SELECT status AS k, COUNT(*) AS n FROM newsletter_contacts GROUP BY status ORDER BY n DESC`);
    await one('contacts with a purchase but in no group', `SELECT COUNT(*) FROM newsletter_contacts c WHERE EXISTS (SELECT 1 FROM purchases p WHERE p.contact_id = c.id) AND NOT EXISTS (SELECT 1 FROM contact_group_members m WHERE m.contact_id = c.id)`);

    head('3. Quotes');
    await buckets('status', `SELECT status AS k, COUNT(*) AS n FROM quote_requests GROUP BY status ORDER BY n DESC`);
    await buckets('origin', `SELECT origin AS k, COUNT(*) AS n FROM quote_requests GROUP BY origin ORDER BY n DESC`);
    await one('quotes with a send date', `SELECT COUNT(*) FROM quote_requests WHERE quote_sent_at IS NOT NULL`);
    await one('quotes accepted', `SELECT COUNT(*) FROM quote_requests WHERE accepted_at IS NOT NULL`);
    await one('quotes with no quote number (inbound, never priced)', `SELECT COUNT(*) FROM quote_requests WHERE quote_number IS NULL`);
    await one('quotes that match exactly one contact by normalized email', `SELECT COUNT(*) FROM quote_requests q WHERE (SELECT COUNT(*) FROM newsletter_contacts c WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(q.email))) = 1`);
    await one('quotes that match NO contact', `SELECT COUNT(*) FROM quote_requests q WHERE NOT EXISTS (SELECT 1 FROM newsletter_contacts c WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(q.email)))`, 'these go to the exceptions report');
    await one('quotes that match MORE THAN ONE contact', `SELECT COUNT(*) FROM quote_requests q WHERE (SELECT COUNT(*) FROM newsletter_contacts c WHERE LOWER(TRIM(c.email)) = LOWER(TRIM(q.email))) > 1`, 'ambiguous: reviewed, never auto-linked');
    await one('quotes from a group demo', `SELECT COUNT(*) FROM quote_requests WHERE demo_invitation_id > 0`);

    head('4. purchases.quote_id (before any foreign key)');
    await one('purchases that carry a quote_id', `SELECT COUNT(*) FROM purchases WHERE quote_id IS NOT NULL`);
    await one('of those, quote_id points at no quote (orphans)', `SELECT COUNT(*) FROM purchases p WHERE p.quote_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM quote_requests q WHERE q.id = p.quote_id)`, 'must be 0, or fixed, before a foreign key');
    await one('quotes that have more than one purchase', `SELECT COUNT(*) FROM (SELECT quote_id FROM purchases WHERE quote_id IS NOT NULL GROUP BY quote_id HAVING COUNT(*) > 1) d`, 'card clicks make extra pending purchases; no unique key');
    await one('quotes whose purchases are all still pending and number more than one', `SELECT COUNT(*) FROM (SELECT quote_id FROM purchases WHERE quote_id IS NOT NULL GROUP BY quote_id HAVING COUNT(*) > 1 AND SUM(payment_status = 'paid') = 0) d`);

    head('5. Purchases against the draft Customer rule (D3)');
    await buckets('payment_status', `SELECT payment_status AS k, COUNT(*) AS n FROM purchases GROUP BY payment_status ORDER BY n DESC`);
    await buckets('payment_method', `SELECT payment_method AS k, COUNT(*) AS n FROM purchases GROUP BY payment_method ORDER BY n DESC`);
    await buckets('product_type', `SELECT product_type AS k, COUNT(*) AS n FROM purchases GROUP BY product_type ORDER BY n DESC`);
    await one('QUALIFYING (paid, amount > 0, not a trial)', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${QUALIFYING}`);
    await one('paid with a NULL amount (manual entries)', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE p.payment_status = 'paid' AND p.amount_cents IS NULL AND NOT ${TRIAL_LIKE}`, 'review list: you confirm each before it counts');
    await one('paid with a zero amount, not a trial', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE p.payment_status = 'paid' AND p.amount_cents = 0 AND NOT ${TRIAL_LIKE}`, 'never a Customer on its own');
    await one('trial-like purchases (any of: trial product, lesson limit, trial end date)', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${TRIAL_LIKE}`);
    await one('trial-like purchases marked paid', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${TRIAL_LIKE} AND p.payment_status = 'paid'`, 'the column default is paid; these must not become Customers');
    await one('trial-like purchases marked paid WITH an amount > 0', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${TRIAL_LIKE} AND p.payment_status = 'paid' AND p.amount_cents > 0`, 'a paid trial: look at these by hand');
    await one('trial purchases with a trial product but no lesson limit and no end date', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE COALESCE(lp.is_trial, 0) = 1 AND p.trial_lesson_limit IS NULL AND p.trial_expiration_date IS NULL`, 'the trial-detection gap found in the code');
    await one('pending purchases', `SELECT COUNT(*) FROM purchases WHERE payment_status <> 'paid'`);
    await one('purchases tied to an invoice that is paid while the purchase is not', `SELECT COUNT(*) FROM purchases p JOIN invoices i ON i.id = p.invoice_id WHERE i.status = 'paid' AND p.payment_status <> 'paid'`, 'payment drift');
    await one('purchases tied to an invoice that is unpaid or cancelled while the purchase is paid', `SELECT COUNT(*) FROM purchases p JOIN invoices i ON i.id = p.invoice_id WHERE i.status <> 'paid' AND p.payment_status = 'paid'`, 'payment drift the other way');
    await buckets('invoice status', `SELECT status AS k, COUNT(*) AS n FROM invoices GROUP BY status ORDER BY n DESC`);
    await one('invoices with no purchase attached', `SELECT COUNT(*) FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM purchases p WHERE p.invoice_id = i.id)`);

    head('6. Account links for qualifying purchases (D4)');
    await one('qualifying purchases with a school_id', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${QUALIFYING} AND p.school_id IS NOT NULL`);
    await one('qualifying purchases with NO school_id', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${QUALIFYING} AND p.school_id IS NULL`, 'the organization stays "unresolved, needs review"');
    await one('...of those, a school_domain that matches a school (explicit collation)', `SELECT COUNT(*) ${FROM_PURCHASES} WHERE ${QUALIFYING} AND p.school_id IS NULL AND p.school_domain IS NOT NULL AND EXISTS (SELECT 1 FROM schools s WHERE CONVERT(s.domain USING utf8mb4) COLLATE utf8mb4_general_ci = p.school_domain COLLATE utf8mb4_general_ci)`, 'schools and districts are latin1, everything else utf8mb4');
    await one('schools with no district', `SELECT COUNT(*) FROM schools WHERE district_id IS NULL`);

    head('7. Projected classification (a first look, not the final backfill)');
    await one('contacts that would be CUSTOMER (a qualifying purchase of their own)', `SELECT COUNT(DISTINCT c.id) FROM newsletter_contacts c JOIN purchases p ON p.contact_id = c.id LEFT JOIN license_products lp ON lp.id = p.license_product_id WHERE ${QUALIFYING}`);
    await one('contacts that would be PROSPECT (a quote request, no qualifying purchase)',
      `SELECT COUNT(*) FROM newsletter_contacts c
        WHERE EXISTS (SELECT 1 FROM quote_requests q WHERE LOWER(TRIM(q.email)) = LOWER(TRIM(c.email)))
          AND NOT EXISTS (SELECT 1 FROM purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id WHERE p.contact_id = c.id AND ${QUALIFYING})`);
    await one('contacts that would stay SUSPECT',
      `SELECT COUNT(*) FROM newsletter_contacts c
        WHERE NOT EXISTS (SELECT 1 FROM quote_requests q WHERE LOWER(TRIM(q.email)) = LOWER(TRIM(c.email)))
          AND NOT EXISTS (SELECT 1 FROM purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id WHERE p.contact_id = c.id AND ${QUALIFYING})`);
    await one('contacts with only trial, zero-amount, NULL-amount or pending purchases (not Customer; check by hand)',
      `SELECT COUNT(*) FROM newsletter_contacts c
        WHERE EXISTS (SELECT 1 FROM purchases p WHERE p.contact_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM purchases p LEFT JOIN license_products lp ON lp.id = p.license_product_id WHERE p.contact_id = c.id AND ${QUALIFYING})`);

    head('8. Staff and owners');
    await one('admin accounts', `SELECT COUNT(*) FROM admin_users`, 'all become CRM Admin in Phase 1');
    await one('admin accounts without an email', `SELECT COUNT(*) FROM admin_users WHERE email IS NULL OR email = ''`);
    await one('site users flagged FNE staff (Community only; grants no CRM access)', `SELECT COUNT(*) FROM site_users WHERE is_fne_staff = 1`);
    await one('support tickets with an assigned admin', `SELECT COUNT(*) FROM support_requests WHERE assigned_admin_id IS NOT NULL`);

    head('9. Demo hand-off');
    await buckets('demo invitation status', `SELECT status AS k, COUNT(*) AS n FROM public_demo_invitations GROUP BY status ORDER BY n DESC`);
    await one('tickets from a group demo', `SELECT COUNT(*) FROM support_requests WHERE demo_invitation_id > 0`);

    console.log('\nNothing was changed. Paste this output into the requirements doc (it holds no names, emails or amounts).\n');
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

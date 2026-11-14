require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// Sales CRM update, phase 1 backfill (docs/reference/sales-crm-update-requirements.md, decisions D2, D4, D5 and section 1b).
// DRY RUN BY DEFAULT: it prints what it would do and writes nothing. Add --apply to write. Safe to run again: every step skips what already exists.
// The output is counts and ids only (never a name, an email or an amount), so it can be pasted into the requirements doc.
//
//   node scripts/backfill-crm-core.js            read-only report
//   node scripts/backfill-crm-core.js --apply    write
//
// Run scripts/alter-create-crm-core.js first. Steps:
//   1. Link each quote to its contact by normalized email (LOWER(TRIM())), only when exactly one contact matches. None or several: listed, never guessed.
//   2. Accounts for real districts and schools (demo districts and schools, and anything on example.com, are skipped), school under its district.
//   3. For each quote with no deal yet: find or create its account, then ONE deal per quote. Stage and state come only from evidence the quote already holds:
//        status new                         -> New Inquiry, open
//        status contacted, a send date      -> Proposal / Quote Sent, open;  contacted with no send date -> Qualified, open
//        status converted                   -> Won (payment is shown separately, a won deal is not a paid one)
//        status closed                      -> Inactive, "closed before the CRM existed", at the stage the evidence shows; the owner decides won or lost
//      The value is the quote's amount. Owner, expected close date and anything else unknown stay empty.
//   4. People on accounts: a purchase's buyer joins the account of the purchase's school; a quote's contact joins the quote's account.
//   5. Suspect / Prospect / Customer for every contact that has a purchase or a quote (lib/crm-classification.js). Everyone else stays Suspect.
// Quotes from example.com addresses (QA) are skipped everywhere.

const mysql = require('mysql2/promise');
const { isDemoDistrictName, isDemoSchoolDomain } = require('../lib/sales-demo');
const { reconcileAll, isTestAddress, sqlNow } = require('../lib/crm-classification');

const APPLY = process.argv.includes('--apply');
const norm = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  const exceptions = [];
  const log = (label, n, note) => console.log(`  ${String(n).padStart(5)}  ${label}${note ? '  (' + note + ')' : ''}`);

  try {
    console.log(`\nCRM backfill, ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing is written)'}\n`);
    const [[have]] = await db.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'crm_accounts'", [process.env.DB_NAME]);
    if (!Number(have.n)) { console.error('The CRM tables are not there. Run scripts/alter-create-crm-core.js first.'); process.exit(1); }

    // ---- 1. quote -> contact -------------------------------------------------------------------------------------------------------
    console.log('1. Quotes to contacts');
    const [quotes] = await db.query('SELECT * FROM quote_requests ORDER BY id');
    const [contacts] = await db.query('SELECT id, email FROM newsletter_contacts');
    const byEmail = new Map();
    for (const c of contacts) { const k = norm(c.email); byEmail.set(k, (byEmail.get(k) || []).concat(c.id)); }
    let linked = 0, already = 0, skippedTest = 0;
    for (const q of quotes) {
      if (isTestAddress(q.email)) { skippedTest++; continue; }
      if (q.contact_id) { already++; continue; }
      const hits = byEmail.get(norm(q.email)) || [];
      if (hits.length === 1) {
        if (APPLY) await db.query('UPDATE quote_requests SET contact_id = ? WHERE id = ? AND contact_id IS NULL', [hits[0], q.id]);
        q.contact_id = hits[0];
        linked++;
      } else {
        exceptions.push(`quote #${q.id}: ${hits.length ? 'matches several contacts' : 'matches no contact'}; link it by hand`);
      }
    }
    log('quotes linked to a contact', linked); log('already linked', already); log('skipped (test address)', skippedTest);

    // ---- 2. accounts from real districts and schools -------------------------------------------------------------------------------
    console.log('\n2. Accounts for real districts and schools');
    const [districts] = await db.query('SELECT id, name FROM districts ORDER BY id');
    const [schools] = await db.query('SELECT id, domain, district_id, display_name FROM schools ORDER BY id');
    const [haveAccts] = await db.query('SELECT id, school_id, district_id FROM crm_accounts');
    const acctByDistrict = new Map(haveAccts.filter(a => a.district_id).map(a => [a.district_id, a.id]));
    const acctBySchool = new Map(haveAccts.filter(a => a.school_id).map(a => [a.school_id, a.id]));
    let newDistrictAccts = 0, newSchoolAccts = 0, skippedDemo = 0;
    for (const d of districts) {
      if (isDemoDistrictName(d.name) || /demo/i.test(d.name)) { skippedDemo++; continue; }
      if (acctByDistrict.has(d.id)) continue;
      if (APPLY) {
        const [r] = await db.query("INSERT INTO crm_accounts (name, account_type, district_id, source) VALUES (?, 'district', ?, 'Backfill from districts')", [d.name, d.id]);
        acctByDistrict.set(d.id, r.insertId);
      } else acctByDistrict.set(d.id, -1); // a dry run has no id, but later steps must see that the account would exist
      newDistrictAccts++;
    }
    for (const s of schools) {
      if (isDemoSchoolDomain(s.domain) || /example\.com$/i.test(s.domain)) { skippedDemo++; continue; }
      if (acctBySchool.has(s.id)) continue;
      if (APPLY) {
        const [r] = await db.query(
          "INSERT INTO crm_accounts (name, account_type, website_domain, school_id, parent_account_id, source) VALUES (?, 'school', ?, ?, ?, 'Backfill from schools')",
          [s.display_name || s.domain, s.domain, s.id, s.district_id ? (acctByDistrict.get(s.district_id) || null) : null]);
        acctBySchool.set(s.id, r.insertId);
      } else acctBySchool.set(s.id, -1);
      newSchoolAccts++;
    }
    log('district accounts created', newDistrictAccts); log('school accounts created', newSchoolAccts); log('demo or example.com rows skipped', skippedDemo);

    // ---- 3. one deal per quote -----------------------------------------------------------------------------------------------------
    console.log('\n3. Deals from quotes');
    const [stages] = await db.query('SELECT id, stage_key FROM crm_pipeline_stages');
    const stageId = Object.fromEntries(stages.map(s => [s.stage_key, s.id]));
    for (const k of ['new_inquiry', 'qualified', 'proposal_sent', 'won']) if (!stageId[k]) { console.error(`The stage "${k}" is missing. Run scripts/alter-create-crm-core.js.`); process.exit(1); }
    const schoolByDomain = new Map(schools.map(s => [norm(s.domain), s.id]));
    const [liveAccts] = await db.query('SELECT id, name FROM crm_accounts WHERE archived_at IS NULL');
    const acctByName = new Map(liveAccts.map(a => [norm(a.name), a.id]));
    let dealsMade = 0, acctsFromQuotes = 0, dealsExisting = 0;
    const quoteAccount = new Map(); // quote id -> account id (for step 4)
    for (const q of quotes) {
      if (isTestAddress(q.email)) continue;
      if (q.opportunity_id) { dealsExisting++; continue; }

      // Find the account: by the quote's school domain, then by the organization name, else make a prospect account from the organization name.
      let accountId = null;
      const schoolId = q.quoted_school_domain ? schoolByDomain.get(norm(q.quoted_school_domain)) : null;
      if (schoolId && acctBySchool.has(schoolId)) accountId = acctBySchool.get(schoolId);
      if (!accountId && q.school && acctByName.has(norm(q.school))) accountId = acctByName.get(norm(q.school));
      if (!accountId) {
        const name = String(q.school || '').trim();
        if (!name) { exceptions.push(`quote #${q.id}: no organization on the quote; add the account and deal by hand`); continue; }
        if (APPLY) {
          const [r] = await db.query("INSERT INTO crm_accounts (name, account_type, source) VALUES (?, 'school', 'Backfill from quotes')", [name.slice(0, 255)]);
          accountId = r.insertId;
          acctByName.set(norm(name), accountId);
        } else {
          accountId = -1; // a dry run has no id, but a second quote from the same organization must not be counted as another new account
          acctByName.set(norm(name), accountId);
        }
        acctsFromQuotes++;
      }

      // Stage and state from the evidence the quote already holds.
      let stageKey = 'new_inquiry', state = 'open', closedAt = null, why = 'Backfilled from legacy quote';
      const sent = !!q.quote_sent_at;
      if (q.status === 'contacted') stageKey = sent ? 'proposal_sent' : 'qualified';
      else if (q.status === 'converted') { stageKey = 'won'; state = 'won'; closedAt = q.accepted_at || q.created_at; }
      else if (q.status === 'closed') { stageKey = sent ? 'proposal_sent' : 'new_inquiry'; state = 'inactive'; closedAt = q.quote_sent_at || q.created_at; why = 'Backfilled: the legacy quote was marked closed before the CRM existed. Decide won or lost.'; }
      else if (sent) stageKey = 'proposal_sent';
      const label = (q.quoted_product_name || 'Quote').slice(0, 120);
      const name = `${String(q.school || 'Quote').slice(0, 100)} - ${label}${q.quote_number ? ` (${q.quote_number})` : ''}`.slice(0, 255);
      const enteredAt = q.accepted_at || q.quote_sent_at || q.created_at || sqlNow();

      if (APPLY) {
        await db.beginTransaction();
        try {
          const [r] = await db.query(
            `INSERT INTO crm_opportunities (account_id, name, stage_id, state, stage_entered_at, primary_contact_id, opp_type, amount_cents, source, product_focus, closed_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'new_business', ?, ?, ?, ?, ?)`,
            [accountId, name, stageId[stageKey], state, enteredAt, q.contact_id || null,
             q.quoted_amount_cents === null || q.quoted_amount_cents === undefined ? null : q.quoted_amount_cents,
             q.origin === 'admin' ? 'Sales outreach' : 'Quote request', q.quoted_product_name || null, closedAt, q.created_at]);
          // Compare-and-set: if two runs overlap, only one links the quote and the other rolls back.
          const [u] = await db.query('UPDATE quote_requests SET opportunity_id = ? WHERE id = ? AND opportunity_id IS NULL', [r.insertId, q.id]);
          if (!u.affectedRows) { await db.rollback(); continue; }
          await db.query('INSERT INTO crm_opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id, from_state, to_state, reason, created_at) VALUES (?, NULL, ?, NULL, ?, ?, ?)',
            [r.insertId, stageId[stageKey], state, why, sqlNow()]);
          if (q.contact_id) await db.query('INSERT INTO crm_opportunity_contacts (opportunity_id, contact_id, role) VALUES (?, ?, ?)', [r.insertId, q.contact_id, 'other']);
          await db.commit();
        } catch (err) { await db.rollback(); throw err; }
      }
      quoteAccount.set(q.id, accountId);
      dealsMade++;
    }
    log('deals created', dealsMade); log('accounts created from quotes', acctsFromQuotes); log('quotes that already have a deal', dealsExisting);

    // Accepted quotes with no purchase pointing at them (only 3 purchases carry a quote_id; the owner decides whether a purchase is missing).
    const [noPurchase] = await db.query(
      `SELECT q.id FROM quote_requests q WHERE q.accepted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.quote_id = q.id) ORDER BY q.id`);
    for (const r of noPurchase) exceptions.push(`quote #${r.id}: accepted, but no purchase points at it (a purchase may be missing, or the link was never set)`);

    // ---- 4. people on accounts -----------------------------------------------------------------------------------------------------
    console.log('\n4. People on accounts');
    let members = 0;
    const addMember = async (accountId, contactId, title) => {
      const [dup] = await db.query('SELECT id FROM crm_account_contacts WHERE account_id = ? AND contact_id = ?', [accountId, contactId]);
      if (dup[0]) return;
      if (APPLY) await db.query('INSERT INTO crm_account_contacts (account_id, contact_id, title) VALUES (?, ?, ?)', [accountId, contactId, title]);
      members++;
    };
    const [buyers] = await db.query(
      `SELECT DISTINCT p.contact_id, p.school_id FROM purchases p JOIN newsletter_contacts c ON c.id = p.contact_id
       WHERE p.school_id IS NOT NULL AND NOT (LOWER(TRIM(c.email)) LIKE '%@example.com')`);
    for (const b of buyers) if (acctBySchool.has(b.school_id)) await addMember(acctBySchool.get(b.school_id), b.contact_id, 'Purchaser');
    for (const q of quotes) {
      if (isTestAddress(q.email) || !q.contact_id) continue;
      const acct = q.opportunity_id ? (await db.query('SELECT account_id FROM crm_opportunities WHERE id = ?', [q.opportunity_id]))[0][0]?.account_id : quoteAccount.get(q.id);
      if (acct) await addMember(acct, q.contact_id, null);
    }
    log('people added to accounts', members);

    // ---- 5. Suspect / Prospect / Customer ------------------------------------------------------------------------------------------
    console.log('\n5. Suspect / Prospect / Customer');
    // In a dry run the quote links above were not written, so this step reports from what is stored now; run the real thing for the full picture.
    const summary = await reconcileAll(db, { dryRun: !APPLY });
    log('contacts examined (anyone with a purchase or a quote, and current Customers)', summary.examined);
    log('become Customer', summary.toCustomer); log('become Prospect', summary.toProspect);
    log('Customers with no qualifying purchase left (flagged for review)', summary.needsReview.length);

    console.log('\nNeeds your decision (ids only):');
    if (!exceptions.length) console.log('  none');
    for (const e of exceptions) console.log('  ' + e);
    console.log(APPLY ? '\nDone.\n' : '\nNothing was written. Add --apply to write.\n');
  } finally {
    await db.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

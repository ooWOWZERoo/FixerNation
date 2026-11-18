// Sales CRM punch list G19 (PRD section 17): the "How labels are decided" section of Hub Settings. READ ONLY, by the owner's choice (2026-11-17): the rules are written out in plain
// words with today's live counts and links to the matching lists; they are NOT editable here. The one Customer rule feeds reports, renewals and refunds, and stays in
// lib/crm-classification.js where a test guards it.
//
//  - Counts are the same numbers the lists and the Overview use (test addresses left out). A count a server cannot work out yet is null, never zero.
//  - Nothing here names a person or a school; counts and links only. No score, no hot, warm or cold.
const cls = require('./crm-classification');
const rel = require('./crm-account-relationship');

const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));
async function optional(fn) { try { return await fn(); } catch (err) { if (isMissing(err)) return null; throw err; } }

// The rules, in the words staff read. Written once here so the page and the tests share them.
const RULES = {
  contacts: [
    { label: 'Suspect', text: 'The starting point for everyone. A newsletter signup, an import or a name added by hand is not proof of buying interest.' },
    { label: 'Prospect', text: 'Someone asked for a quote, or a teammate moved them up and wrote why.' },
    { label: 'Customer', text: 'Someone owns at least one paid purchase of more than $0 that is not a trial, or a CRM Admin set it by hand with evidence. An accepted quote, an invoice or a purchase order alone is never enough, and a purchase with no amount recorded waits for a person to confirm it.' },
    { label: 'Moving', text: 'A label only moves forward on its own. If a Customer’s purchase later stops qualifying (a refund, for example), the label is left as it is and the person is flagged for review. A label set by hand is never changed by the nightly check.' },
  ],
  accounts: [
    { label: 'Customer', text: 'A paid, non-trial purchase is placed on the school, or on a school in the district.' },
    { label: 'Prospect', text: 'Not a Customer, and it has an open deal, or a person there is a Prospect or a Customer. A lost or set-aside deal alone does not count.' },
    { label: 'Suspect', text: 'Anything else.' },
    { label: 'Needs review', text: 'Separate from the label: someone there owns a paid purchase that names no school, so it cannot be placed on any account. It clears when the school is set on the purchase.' },
  ],
  never: 'The label is not the newsletter subscription, not a deal stage and not a score. There is no hot, warm or cold.',
};

async function overview(conn, today) {
  const contacts = await cls.classificationCounts(conn);
  const handSet = await optional(async () => Number((await conn.query(`SELECT COUNT(*) AS n FROM newsletter_contacts c WHERE c.classification_locked = 1 AND NOT (${cls.TEST_ADDRESS_SQL.replace(/\bemail\b/, 'c.email')})`))[0][0].n));
  const toConfirm = await optional(async () => (await cls.listPurchasesNeedingReview(conn)).length);
  // A Customer nobody can explain: the label says Customer, it was not set by hand, and no purchase qualifies (a refund or a removed purchase). Same test as the Reconciliation report.
  const unexplained = await optional(async () => Number((await conn.query(
    `SELECT COUNT(*) AS n FROM newsletter_contacts c WHERE c.crm_classification = 'customer' AND c.classification_locked = 0 AND NOT (${cls.TEST_ADDRESS_SQL.replace(/\bemail\b/, 'c.email')})
       AND NOT EXISTS (SELECT 1 ${cls.PURCHASES_FROM} WHERE p.contact_id = c.id AND ${cls.QUALIFYING_SQL})`))[0][0].n));
  const accounts = await optional(async () => rel.relationshipCounts(await rel.accountRelationships(conn, today)));
  return {
    rules: RULES,
    counts: {
      contacts: { ...contacts, handSet, purchasesToConfirm: toConfirm, customersWithoutQualifyingPurchase: unexplained },
      accounts: accounts ? { suspect: accounts.suspect, prospect: accounts.prospect, customer: accounts.customer, needsReview: accounts.review } : null,
    },
    links: {
      suspects: 'admin-crm-contacts.html?classification=suspect', prospects: 'admin-crm-contacts.html?classification=prospect', customers: 'admin-crm-contacts.html?classification=customer',
      handSet: 'admin-crm-contacts.html?classification=customer&locked=true', purchasesToConfirm: 'admin-crm-overview.html', reconciliation: 'admin-crm-reports.html',
      accountCustomers: 'admin-crm-accounts.html?relationship=customer', accountProspects: 'admin-crm-accounts.html?relationship=prospect', accountSuspects: 'admin-crm-accounts.html?relationship=suspect', accountsNeedReview: 'admin-crm-accounts.html?relationship=review',
    },
  };
}

module.exports = { overview, RULES };

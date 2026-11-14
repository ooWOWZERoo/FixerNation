require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM update, phase 1 (docs/reference/sales-crm-update-requirements.md): the sales data foundation. Idempotent; safe to re-run. Run it BEFORE restarting
// the Node app (the new routes read these tables and columns). Everything here is additive: no existing column, status or row is changed or removed, and the
// feature stays dark until the setting crm_v2_enabled is 'true' (Sales CRM routes answer 404 until then).
//
//   node scripts/alter-create-crm-core.js
//
// Creates:  crm_pipeline_stages, crm_loss_reasons, crm_accounts, crm_account_contacts, crm_opportunities, crm_opportunity_contacts,
//           crm_opportunity_stage_history, crm_classification_events   (stages and loss reasons are seeded; existing rows are never overwritten)
// Adds:     admin_users.crm_role                     existing admins all become 'admin', so nothing changes for anyone until the owner lowers a role
//           newsletter_contacts.crm_classification   'suspect' | 'prospect' | 'customer' (default suspect); the subscription status column is not touched
//           newsletter_contacts.classification_updated_at, classification_locked, assigned_admin_id, last_contacted_at, crm_source
//           quote_requests.contact_id, opportunity_id (nullable links; legacy quotes keep working with both empty)
//
// All ids are INT UNSIGNED to match the tables they point at. schools and districts are latin1 tables: the links to them are integer columns, which is fine.

const STAGES = [
  ['new_inquiry', 'New Inquiry', 10, 5],
  ['qualified', 'Qualified', 20, 15],
  ['discovery', 'Discovery', 30, 25],
  ['demo_evaluation', 'Demo / Evaluation', 40, 40],
  ['proposal_sent', 'Proposal / Quote Sent', 50, 55],
  ['procurement', 'Procurement / Review', 60, 70],
  ['verbal_commitment', 'Verbal Commitment', 70, 85],
  ['won', 'Won', 80, 100],
];
const LOSS_REASONS = [
  ['no_budget', 'No budget', 10],
  ['chose_competitor', 'Chose a competitor', 20],
  ['no_decision', 'No decision made', 30],
  ['timing', 'Timing: not this year', 40],
  ['not_a_fit', 'Not a fit', 50],
  ['no_response', 'No response', 60],
  ['other', 'Other', 90],
];

const TABLES = [
  ['crm_pipeline_stages', `CREATE TABLE crm_pipeline_stages (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    stage_key VARCHAR(32) NOT NULL,
    label VARCHAR(64) NOT NULL,
    sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    default_probability TINYINT UNSIGNED NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_stage_key (stage_key),
    KEY idx_crm_stage_sort (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_loss_reasons', `CREATE TABLE crm_loss_reasons (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reason_key VARCHAR(32) NOT NULL,
    label VARCHAR(96) NOT NULL,
    sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_crm_loss_reason_key (reason_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_accounts', `CREATE TABLE crm_accounts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    account_type VARCHAR(16) NOT NULL DEFAULT 'school',
    website_domain VARCHAR(255) NULL,
    state VARCHAR(64) NULL,
    assigned_admin_id INT UNSIGNED NULL,
    source VARCHAR(128) NULL,
    parent_account_id INT UNSIGNED NULL,
    school_id INT UNSIGNED NULL,
    district_id INT UNSIGNED NULL,
    description TEXT NULL,
    archived_at DATETIME NULL,
    created_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_account_school (school_id),
    UNIQUE KEY uq_crm_account_district (district_id),
    KEY idx_crm_account_owner (assigned_admin_id),
    KEY idx_crm_account_parent (parent_account_id),
    KEY idx_crm_account_name (name),
    CONSTRAINT fk_crm_account_owner FOREIGN KEY (assigned_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_account_parent FOREIGN KEY (parent_account_id) REFERENCES crm_accounts (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_account_school FOREIGN KEY (school_id) REFERENCES schools (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_account_district FOREIGN KEY (district_id) REFERENCES districts (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_account_contacts', `CREATE TABLE crm_account_contacts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_id INT UNSIGNED NOT NULL,
    contact_id INT UNSIGNED NOT NULL,
    title VARCHAR(128) NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    is_champion TINYINT(1) NOT NULL DEFAULT 0,
    is_decision_maker TINYINT(1) NOT NULL DEFAULT 0,
    is_procurement TINYINT(1) NOT NULL DEFAULT 0,
    is_finance TINYINT(1) NOT NULL DEFAULT 0,
    started_on DATE NULL,
    ended_on DATE NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_account_contact (account_id, contact_id),
    KEY idx_crm_account_contacts_contact (contact_id),
    CONSTRAINT fk_crm_ac_account FOREIGN KEY (account_id) REFERENCES crm_accounts (id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_ac_contact FOREIGN KEY (contact_id) REFERENCES newsletter_contacts (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_opportunities', `CREATE TABLE crm_opportunities (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    account_id INT UNSIGNED NOT NULL,
    name VARCHAR(255) NOT NULL,
    owner_admin_id INT UNSIGNED NULL,
    stage_id INT UNSIGNED NOT NULL,
    state VARCHAR(12) NOT NULL DEFAULT 'open',
    stage_entered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    primary_contact_id INT UNSIGNED NULL,
    opp_type VARCHAR(16) NOT NULL DEFAULT 'new_business',
    amount_cents INT UNSIGNED NULL,
    source VARCHAR(128) NULL,
    product_focus VARCHAR(255) NULL,
    expected_close_date DATE NULL,
    target_implementation_date DATE NULL,
    probability_override TINYINT UNSIGNED NULL,
    next_step VARCHAR(255) NULL,
    next_step_due_at DATETIME NULL,
    loss_reason_id INT UNSIGNED NULL,
    competitor VARCHAR(128) NULL,
    reengage_on DATE NULL,
    closed_at DATETIME NULL,
    renewal_of_purchase_id INT UNSIGNED NULL,
    created_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_crm_opp_owner_state (owner_admin_id, state, stage_id, expected_close_date),
    KEY idx_crm_opp_stage_updated (stage_id, updated_at),
    KEY idx_crm_opp_next_step (next_step_due_at, state),
    KEY idx_crm_opp_account_state (account_id, state),
    KEY idx_crm_opp_primary_contact (primary_contact_id),
    CONSTRAINT fk_crm_opp_account FOREIGN KEY (account_id) REFERENCES crm_accounts (id) ON DELETE RESTRICT,
    CONSTRAINT fk_crm_opp_owner FOREIGN KEY (owner_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_opp_stage FOREIGN KEY (stage_id) REFERENCES crm_pipeline_stages (id) ON DELETE RESTRICT,
    CONSTRAINT fk_crm_opp_contact FOREIGN KEY (primary_contact_id) REFERENCES newsletter_contacts (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_opp_loss FOREIGN KEY (loss_reason_id) REFERENCES crm_loss_reasons (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_opp_renewal FOREIGN KEY (renewal_of_purchase_id) REFERENCES purchases (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_opportunity_contacts', `CREATE TABLE crm_opportunity_contacts (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id INT UNSIGNED NOT NULL,
    contact_id INT UNSIGNED NOT NULL,
    role VARCHAR(24) NOT NULL DEFAULT 'other',
    influence VARCHAR(12) NULL,
    stance VARCHAR(12) NULL,
    notes VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_opp_contact (opportunity_id, contact_id),
    KEY idx_crm_opp_contacts_contact (contact_id),
    CONSTRAINT fk_crm_oc_opp FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_oc_contact FOREIGN KEY (contact_id) REFERENCES newsletter_contacts (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_opportunity_stage_history', `CREATE TABLE crm_opportunity_stage_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id INT UNSIGNED NOT NULL,
    from_stage_id INT UNSIGNED NULL,
    to_stage_id INT UNSIGNED NOT NULL,
    from_state VARCHAR(12) NULL,
    to_state VARCHAR(12) NOT NULL,
    actor_admin_id INT UNSIGNED NULL,
    reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crm_stage_history_opp (opportunity_id, created_at),
    CONSTRAINT fk_crm_sh_opp FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_sh_actor FOREIGN KEY (actor_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_classification_events', `CREATE TABLE crm_classification_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    contact_id INT UNSIGNED NOT NULL,
    from_classification VARCHAR(12) NULL,
    to_classification VARCHAR(12) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    source_ref VARCHAR(64) NULL,
    actor_admin_id INT UNSIGNED NULL,
    reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_crm_class_events_contact (contact_id, created_at),
    KEY idx_crm_class_events_ref (event_type, source_ref),
    CONSTRAINT fk_crm_ce_contact FOREIGN KEY (contact_id) REFERENCES newsletter_contacts (id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_ce_actor FOREIGN KEY (actor_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
];

// [table, column, definition, optional extra statement run after the column exists (index / foreign key)]
const COLUMNS = [
  ['admin_users', 'crm_role', "VARCHAR(12) NOT NULL DEFAULT 'admin'", null],
  ['newsletter_contacts', 'crm_classification', "VARCHAR(12) NOT NULL DEFAULT 'suspect'", 'ADD INDEX idx_contacts_crm_classification (crm_classification)'],
  ['newsletter_contacts', 'classification_updated_at', 'DATETIME NULL', null],
  ['newsletter_contacts', 'classification_locked', 'TINYINT(1) NOT NULL DEFAULT 0', null],
  ['newsletter_contacts', 'assigned_admin_id', 'INT UNSIGNED NULL', 'ADD INDEX idx_contacts_assigned_admin (assigned_admin_id), ADD CONSTRAINT fk_contacts_assigned_admin FOREIGN KEY (assigned_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL'],
  ['newsletter_contacts', 'last_contacted_at', 'DATETIME NULL', null],
  ['newsletter_contacts', 'crm_source', 'VARCHAR(64) NULL', null],
  ['quote_requests', 'contact_id', 'INT UNSIGNED NULL', 'ADD INDEX idx_quote_requests_contact (contact_id), ADD CONSTRAINT fk_quote_requests_contact FOREIGN KEY (contact_id) REFERENCES newsletter_contacts (id) ON DELETE SET NULL'],
  ['quote_requests', 'opportunity_id', 'INT UNSIGNED NULL', 'ADD INDEX idx_quote_requests_opportunity (opportunity_id), ADD CONSTRAINT fk_quote_requests_opportunity FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE SET NULL'],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const hasTable = async t => (await db.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, t]))[0].length > 0;
  const hasColumn = async (t, c) => (await db.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, t, c]))[0].length > 0;

  // The tables this builds on must exist; stop early with a clear message rather than half-apply.
  for (const t of ['admin_users', 'newsletter_contacts', 'quote_requests', 'purchases', 'schools', 'districts']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Nothing was changed.`); process.exit(1); }
  }

  for (const [name, ddl] of TABLES) {
    if (await hasTable(name)) { console.log(`Skipped: ${name} already exists.`); continue; }
    await db.query(ddl);
    console.log(`Created ${name}.`);
  }

  for (const [table, column, def, extra] of COLUMNS) {
    if (await hasColumn(table, column)) { console.log(`Skipped: ${table}.${column} already exists.`); continue; }
    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      console.log(`Added ${table}.${column}.`);
      if (extra) await db.query(`ALTER TABLE ${table} ${extra}`);
    } catch (err) {
      if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_FK_DUP_NAME') throw err;
      console.log(`Skipped: ${table}.${column} already exists.`);
    }
  }

  // Seeds: only when the key is missing, so a stage or reason the owner edited later is never overwritten.
  let seeded = 0;
  for (const [key, label, sort, prob] of STAGES) {
    const [r] = await db.query('INSERT IGNORE INTO crm_pipeline_stages (stage_key, label, sort_order, default_probability) VALUES (?, ?, ?, ?)', [key, label, sort, prob]);
    seeded += r.affectedRows;
  }
  for (const [key, label, sort] of LOSS_REASONS) {
    const [r] = await db.query('INSERT IGNORE INTO crm_loss_reasons (reason_key, label, sort_order) VALUES (?, ?, ?)', [key, label, sort]);
    seeded += r.affectedRows;
  }
  console.log(`Seeded ${seeded} stage and loss-reason row(s) (0 on a re-run).`);
  console.log('Done. The Sales CRM stays off until the setting crm_v2_enabled is set to true.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

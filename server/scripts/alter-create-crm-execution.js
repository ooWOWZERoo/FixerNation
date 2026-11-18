require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM update, phase 3 "Sales execution" (docs/reference/sales-crm-update-requirements.md): tasks, notes, files, meetings, procurement checklists and the
// Needs Attention memory. Idempotent; safe to re-run. Run it AFTER scripts/alter-create-crm-core.js and BEFORE restarting the Node app (the new routes read
// these tables). Everything is additive: no existing column or row is changed, and the new routes answer 404 until the setting crm_v2_enabled is 'true'.
//
//   node scripts/alter-create-crm-execution.js
//
// Creates: crm_tasks, crm_notes, crm_attachments, crm_appointments, crm_procurement_templates, crm_opportunity_checklist_items,
//          crm_attention_states (what staff snoozed or dismissed), crm_attention_events (what the daily job has already seen, so it never fires twice)
// Seeds:   one starter procurement checklist, only when no template exists yet (an edited or deleted one is never put back).
//
// A task, note, file or meeting belongs to ONE subject: a deal (opportunity_id, and its account_id is filled in too so the account timeline can find it),
// an account (account_id) or a contact (contact_id). The routes refuse a row with none of the three, so nothing is orphaned.
// All ids are INT UNSIGNED to match the tables they point at. Dates are stored in UTC.

const SUBJECT_COLUMNS = `
    opportunity_id INT UNSIGNED NULL,
    account_id INT UNSIGNED NULL,
    contact_id INT UNSIGNED NULL,`;
const SUBJECT_KEYS = (t, dateCol) => `
    KEY idx_${t}_opp (opportunity_id, ${dateCol}),
    KEY idx_${t}_account (account_id, ${dateCol}),
    KEY idx_${t}_contact (contact_id, ${dateCol}),
    CONSTRAINT fk_${t}_opp FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE,
    CONSTRAINT fk_${t}_account FOREIGN KEY (account_id) REFERENCES crm_accounts (id) ON DELETE CASCADE,
    CONSTRAINT fk_${t}_contact FOREIGN KEY (contact_id) REFERENCES newsletter_contacts (id) ON DELETE CASCADE`;

const TABLES = [
  ['crm_tasks', `CREATE TABLE crm_tasks (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,${SUBJECT_COLUMNS}
    title VARCHAR(255) NOT NULL,
    details VARCHAR(1000) NULL,
    due_on DATE NULL,
    state VARCHAR(8) NOT NULL DEFAULT 'open',
    assigned_admin_id INT UNSIGNED NULL,
    created_by_admin_id INT UNSIGNED NULL,
    completed_at DATETIME NULL,
    completed_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_crm_tasks_assignee (assigned_admin_id, state, due_on),
    KEY idx_crm_tasks_due (state, due_on),${SUBJECT_KEYS('crm_tasks', 'state')},
    CONSTRAINT fk_crm_tasks_assignee FOREIGN KEY (assigned_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_tasks_creator FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_tasks_completer FOREIGN KEY (completed_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_notes', `CREATE TABLE crm_notes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,${SUBJECT_COLUMNS}
    kind VARCHAR(8) NOT NULL DEFAULT 'note',
    body TEXT NOT NULL,
    created_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,${SUBJECT_KEYS('crm_notes', 'created_at')},
    CONSTRAINT fk_crm_notes_author FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_attachments', `CREATE TABLE crm_attachments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,${SUBJECT_COLUMNS}
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(64) NOT NULL,
    kind VARCHAR(8) NOT NULL,
    mime VARCHAR(100) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    uploaded_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_attachments_stored (stored_name),${SUBJECT_KEYS('crm_attachments', 'created_at')},
    CONSTRAINT fk_crm_attachments_uploader FOREIGN KEY (uploaded_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_appointments', `CREATE TABLE crm_appointments (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,${SUBJECT_COLUMNS}
    title VARCHAR(255) NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    location VARCHAR(255) NULL,
    details VARCHAR(2000) NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'scheduled',
    uid VARCHAR(64) NOT NULL,
    sequence_no INT UNSIGNED NOT NULL DEFAULT 0,
    attendees_json TEXT NULL,
    organizer_admin_id INT UNSIGNED NULL,
    invite_sent_at DATETIME NULL,
    invite_sequence INT UNSIGNED NULL,
    created_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_appointments_uid (uid),
    KEY idx_crm_appointments_when (status, starts_at),
    KEY idx_crm_appointments_organizer (organizer_admin_id, starts_at),${SUBJECT_KEYS('crm_appointments', 'starts_at')},
    CONSTRAINT fk_crm_appointments_organizer FOREIGN KEY (organizer_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_appointments_creator FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_procurement_templates', `CREATE TABLE crm_procurement_templates (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    items_json TEXT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_procurement_template_name (name),
    CONSTRAINT fk_crm_pt_creator FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_opportunity_checklist_items', `CREATE TABLE crm_opportunity_checklist_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    opportunity_id INT UNSIGNED NOT NULL,
    template_id INT UNSIGNED NULL,
    label VARCHAR(255) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'open',
    due_on DATE NULL,
    note VARCHAR(255) NULL,
    sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    completed_at DATETIME NULL,
    completed_by_admin_id INT UNSIGNED NULL,
    created_by_admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_crm_checklist_opp (opportunity_id, status, sort_order),
    KEY idx_crm_checklist_due (status, due_on),
    CONSTRAINT fk_crm_checklist_opp FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities (id) ON DELETE CASCADE,
    CONSTRAINT fk_crm_checklist_template FOREIGN KEY (template_id) REFERENCES crm_procurement_templates (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_checklist_completer FOREIGN KEY (completed_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL,
    CONSTRAINT fk_crm_checklist_creator FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_attention_states', `CREATE TABLE crm_attention_states (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_key VARCHAR(32) NOT NULL,
    subject_type VARCHAR(16) NOT NULL,
    subject_id INT UNSIGNED NOT NULL,
    state VARCHAR(10) NOT NULL,
    snooze_until DATETIME NULL,
    fingerprint VARCHAR(40) NOT NULL DEFAULT '',
    reason VARCHAR(255) NULL,
    admin_id INT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_attention_state (rule_key, subject_type, subject_id),
    KEY idx_crm_attention_state_until (state, snooze_until),
    CONSTRAINT fk_crm_attention_state_admin FOREIGN KEY (admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
  ['crm_attention_events', `CREATE TABLE crm_attention_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    rule_key VARCHAR(32) NOT NULL,
    subject_type VARCHAR(16) NOT NULL,
    subject_id INT UNSIGNED NOT NULL,
    fingerprint VARCHAR(40) NOT NULL DEFAULT '',
    owner_admin_id INT UNSIGNED NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    emailed_at DATETIME NULL,
    UNIQUE KEY uq_crm_attention_event (rule_key, subject_type, subject_id, fingerprint),
    KEY idx_crm_attention_event_owner (owner_admin_id, first_seen_at),
    CONSTRAINT fk_crm_attention_event_owner FOREIGN KEY (owner_admin_id) REFERENCES admin_users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
];

const STARTER_TEMPLATE = {
  name: 'Standard school or district purchase',
  description: 'The usual steps between "yes" and "paid" for a school or district. Edit or replace it under Hub Settings.',
  items: [
    'Send our W-9 and vendor details',
    'Vendor registration done (district portal or form)',
    'Data privacy agreement reviewed and signed',
    'Security or accessibility questionnaire answered',
    'Quote reviewed by their finance office',
    'Certificate of insurance (COI) sent',
    'Board or committee approval received',
    'Contract or master agreement signed',
    'Purchase order received',
    'Invoice sent',
    'Licenses turned on and the admin told',
  ],
};

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

  // These must exist (phase 1 made the CRM tables): stop early with a clear message rather than half-apply.
  for (const t of ['admin_users', 'newsletter_contacts', 'crm_accounts', 'crm_opportunities']) {
    if (!(await hasTable(t))) { console.error(`Stopped: ${t} does not exist here. Run scripts/alter-create-crm-core.js first. Nothing was changed.`); process.exit(1); }
  }

  for (const [name, ddl] of TABLES) {
    if (await hasTable(name)) { console.log(`Skipped: ${name} already exists.`); continue; }
    await db.query(ddl);
    console.log(`Created ${name}.`);
  }

  // Seed the starter checklist once. "Once" means: while the table has no rows at all, so a template the owner renamed or removed is never brought back.
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM crm_procurement_templates');
  if (Number(n) === 0) {
    await db.query('INSERT INTO crm_procurement_templates (name, description, items_json) VALUES (?, ?, ?)',
      [STARTER_TEMPLATE.name, STARTER_TEMPLATE.description, JSON.stringify(STARTER_TEMPLATE.items.map(label => ({ label })))]);
    console.log('Seeded the starter procurement checklist.');
  } else {
    console.log('Skipped: procurement templates already exist.');
  }
  console.log('Done. The new Customer Hub routes stay off until the setting crm_v2_enabled is true (it already is, if the Hub is on).');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

// Territory requests + approval workflow, plus making county mandatory on
// every NEW territory assignment (a whole-state assignment can no longer be
// created going forward — see the guard in findOrCreateTerritory() in
// server/lib/territories.js). This script does not touch the pre-existing
// state-scope (county='') rows alter-add-affiliate-territories.js seeded
// into `territories` — those rows are legacy reference data, harmless to
// leave in place. It only checks whether any of them is ACTIVELY ASSIGNED
// to an affiliate today and, if so, reports it clearly rather than touching
// it — same "surface it for manual admin action" convention used by that
// script's own backfill step.
//
// Idempotent, per the alter-*.js convention.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await pool.getConnection();
  try {
    if (!(await tableExists(conn, 'affiliate_territories'))) {
      console.error('Missing table: affiliate_territories. Run scripts/alter-add-affiliate-territories.js first.');
      process.exitCode = 1;
      return;
    }

    if (!(await tableExists(conn, 'territory_requests'))) {
      await conn.query(`
        CREATE TABLE territory_requests (
          id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          affiliate_id            INT UNSIGNED NOT NULL,
          request_type            VARCHAR(16) NOT NULL,
          requested_state          CHAR(2) NOT NULL,
          requested_county         VARCHAR(100) NOT NULL,
          previous_assignment_id   INT UNSIGNED NULL,
          status                  VARCHAR(16) NOT NULL DEFAULT 'pending',
          reviewed_by_admin_id     INT UNSIGNED NULL,
          reviewed_at              DATETIME NULL,
          rejection_reason         VARCHAR(500) NULL,
          created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_affiliate_status (affiliate_id, status),
          INDEX idx_status_created (status, created_at),
          FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
          FOREIGN KEY (previous_assignment_id) REFERENCES affiliate_territories(id) ON DELETE SET NULL,
          FOREIGN KEY (reviewed_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: territory_requests');
    } else {
      console.log('Skipped (already exists): territory_requests');
    }

    if (await columnExists(conn, 'affiliate_applications', 'requested_territory_state')) {
      console.log('Skipped (already exists): affiliate_applications.requested_territory_state');
    } else {
      await conn.query('ALTER TABLE affiliate_applications ADD COLUMN requested_territory_state CHAR(2) NULL AFTER requested_territory');
      console.log('Added column: affiliate_applications.requested_territory_state');
    }

    if (await columnExists(conn, 'affiliate_applications', 'requested_territory_county')) {
      console.log('Skipped (already exists): affiliate_applications.requested_territory_county');
    } else {
      await conn.query('ALTER TABLE affiliate_applications ADD COLUMN requested_territory_county VARCHAR(100) NULL AFTER requested_territory_state');
      console.log('Added column: affiliate_applications.requested_territory_county');
    }

    // Report-only: any active assignment still pointing at a legacy
    // state-scope (county='') territory row. Never touched automatically —
    // an admin reassigns it by hand through admin-affiliates.html if so.
    const [stateAssignments] = await conn.query(`
      SELECT at.id AS assignment_id, a.id AS affiliate_id, su.first_name, su.last_name, su.email, t.name AS territory_name
      FROM affiliate_territories at
      JOIN territories t ON t.id = at.territory_id
      JOIN affiliates a ON a.id = at.affiliate_id
      JOIN site_users su ON su.id = a.site_user_id
      WHERE at.status = 'active' AND t.scope = 'state'
    `);
    if (stateAssignments.length) {
      console.log('');
      console.log(`Found ${stateAssignments.length} ACTIVE whole-state assignment(s) — county is now mandatory for any`);
      console.log('NEW assignment, but these existing ones were left exactly as they are:');
      for (const row of stateAssignments) {
        const name = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
        console.log(`  affiliate id ${row.affiliate_id} (${name}): ${row.territory_name} [assignment id ${row.assignment_id}]`);
      }
      console.log('');
    } else {
      console.log('No active whole-state assignments found — nothing to flag.');
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

// Stage 3.5b of the sales-affiliate program — real territory records.
// Design and confirmed decisions: docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md.
//
// Replaces the free-text affiliates.territory column with `territories`
// (fixed to real US states/counties) and `affiliate_territories` (an
// assignment history, many-per-affiliate). Confirmed: the old column is
// dropped after backfill, not kept alongside the new tables.
//
// The backfill is deliberately conservative: it only auto-assigns a state
// territory when the old free-text value is an exact match (trimmed,
// case-insensitive) for a real state name or 2-letter code. Anything else —
// "Central Florida", "Tri-State", a typo — is NOT guessed at. It's reported
// clearly instead, so an admin can reassign it correctly through the new UI
// rather than the migration inventing a wrong answer in a money-adjacent
// table.
//
// Idempotent, per the alter-*.js convention.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');
const { US_STATES, matchStateLoose } = require('../lib/territories');

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
    if (!(await tableExists(conn, 'affiliates'))) {
      console.error('Missing table: affiliates. Run scripts/alter-add-affiliate-program.js first.');
      process.exitCode = 1;
      return;
    }

    if (!(await tableExists(conn, 'territories'))) {
      await conn.query(`
        CREATE TABLE territories (
          id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          scope      VARCHAR(16) NOT NULL,
          state      CHAR(2) NOT NULL,
          county     VARCHAR(100) NOT NULL DEFAULT '',
          name       VARCHAR(150) NOT NULL,
          status     VARCHAR(16) NOT NULL DEFAULT 'active',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_geo (state, county)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: territories');
    } else {
      console.log('Skipped (already exists): territories');
    }

    if (!(await tableExists(conn, 'affiliate_territories'))) {
      await conn.query(`
        CREATE TABLE affiliate_territories (
          id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          affiliate_id         INT UNSIGNED NOT NULL,
          territory_id         INT UNSIGNED NOT NULL,
          status               VARCHAR(16) NOT NULL DEFAULT 'active',
          assigned_by_admin_id INT UNSIGNED NULL,
          revoked_at           DATETIME NULL,
          revoked_by_admin_id  INT UNSIGNED NULL,
          notes                VARCHAR(500) NULL,
          created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_affiliate_status (affiliate_id, status),
          INDEX idx_territory_status (territory_id, status),
          FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
          FOREIGN KEY (territory_id) REFERENCES territories(id) ON DELETE CASCADE,
          FOREIGN KEY (assigned_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
          FOREIGN KEY (revoked_by_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log('Created table: affiliate_territories');
    } else {
      console.log('Skipped (already exists): affiliate_territories');
    }

    // Seed the 50 states + DC. Idempotent via INSERT IGNORE against the
    // UNIQUE(state, county) key — safe to re-run, and safe if an admin has
    // already created one of these rows some other way.
    const [seedResult] = await conn.query(
      `INSERT IGNORE INTO territories (scope, state, county, name) VALUES ${US_STATES.map(() => '(?, ?, ?, ?)').join(', ')}`,
      US_STATES.flatMap(([code, name]) => ['state', code, '', name])
    );
    console.log(seedResult.affectedRows
      ? `Seeded ${seedResult.affectedRows} state territory row(s).`
      : 'States already seeded — nothing to insert.');

    // Backfill, only if the old column is still here (idempotent: a second
    // run after the column is dropped skips this whole block cleanly).
    if (await columnExists(conn, 'affiliates', 'territory')) {
      const [affiliatesWithTerritory] = await conn.query(
        "SELECT id, territory FROM affiliates WHERE territory IS NOT NULL AND TRIM(territory) <> ''"
      );

      let matched = 0;
      const unmatched = [];
      for (const row of affiliatesWithTerritory) {
        const stateCode = matchStateLoose(row.territory);
        if (!stateCode) {
          unmatched.push(row);
          continue;
        }

        await conn.beginTransaction();
        try {
          const [[territory]] = await conn.query(
            'SELECT id FROM territories WHERE state = ? AND county = ? LIMIT 1',
            [stateCode, '']
          );
          // Same exclusivity rule as everywhere else: don't silently create a
          // conflict the app-layer check would otherwise have caught.
          const [[holder]] = await conn.query(
            `SELECT at.id FROM affiliate_territories at WHERE at.territory_id = ? AND at.status = 'active' LIMIT 1`,
            [territory.id]
          );
          if (holder) {
            await conn.rollback();
            unmatched.push({ ...row, reason: `${stateCode} is already held by another affiliate` });
            continue;
          }
          await conn.query(
            `INSERT INTO affiliate_territories (affiliate_id, territory_id, status, notes)
             VALUES (?, ?, 'active', ?)`,
            [row.id, territory.id, `Backfilled from the old free-text value "${row.territory}"`]
          );
          await conn.commit();
          matched++;
        } catch (err) {
          await conn.rollback();
          throw err;
        }
      }

      console.log(`Backfill: ${matched} matched a real state and were assigned; ${unmatched.length} did not.`);
      if (unmatched.length) {
        console.log('');
        console.log('The following affiliates had a territory value that is not a real US state,');
        console.log('or the matching state was already claimed by someone else. They were left');
        console.log('WITHOUT a territory — reassign them by hand in admin-affiliates.html:');
        for (const row of unmatched) {
          console.log(`  affiliate id ${row.id}: "${row.territory}"${row.reason ? ` (${row.reason})` : ''}`);
        }
        console.log('');
      }

      await conn.query('ALTER TABLE affiliates DROP COLUMN territory');
      console.log('Dropped column: affiliates.territory');
    } else {
      console.log('Skipped (already dropped): affiliates.territory');
    }

    console.log('Done.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

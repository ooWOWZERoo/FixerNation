// Tune Your Brain, Phase 1 — Architectural Foundation and Data Contracts.
// Builds the minimum additive schema the blueprint's Phase 1 calls for,
// beyond the PIN-student reward-linkage fix (alter-add-brain-games-student-support.js,
// shipped separately as the first work package):
//
//   1. feature_flags / feature_flag_schools — the smallest real flag
//      mechanism (name + optional per-school scope), since none existed
//      anywhere in this codebase (see docs/tune-your-brain/LEADERSHIP_DECISIONS_REQUIRED.md
//      D-item on feature flags / T16 in the traceability matrix).
//   2. skills / skill_prerequisites — seeded EMPTY on purpose (D5 Option 1):
//      Phase 4 owns actual seeding/standards mapping, this just gives Phase 1
//      a stable table to reference from day one so Phase 4 doesn't need its
//      own additive migration on top of this one.
//   3. learning_events — normalized session/event stream, deliberately
//      SEPARATE from analytics_sessions/analytics_events (which are
//      anonymous/pre-login/funnel-scoped and structurally wrong for
//      authenticated per-student event data). Never stores free-text —
//      reflections stay in student_reflections, gated by
//      server/lib/safety/gateway.js, per T18/T20 in the traceability matrix.
//
// Retention (D3): provisional default of 400 days (~13 months — a full
// school year plus a summer buffer) via the settings table
// (learning_events_retention_days), enforced by
// server/scripts/purge-learning-events.js. Provisional and admin-adjustable
// by design — flag with the user if a different number is wanted.
//
// Safe to re-run: each table is skipped if it already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, t) {
  const [r] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
    [process.env.DB_NAME, t]
  );
  return r.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  // 1. feature_flags
  if (await tableExists(conn, 'feature_flags')) {
    console.log('Skipped: feature_flags');
  } else {
    await conn.query(`CREATE TABLE feature_flags (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      flag_key VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(255) NULL,
      enabled_globally TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: feature_flags');
  }

  // 2. feature_flag_schools (per-school opt-in, independent of enabled_globally)
  if (await tableExists(conn, 'feature_flag_schools')) {
    console.log('Skipped: feature_flag_schools');
  } else {
    await conn.query(`CREATE TABLE feature_flag_schools (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      flag_id INT UNSIGNED NOT NULL,
      school_id INT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_flag_school (flag_id, school_id),
      FOREIGN KEY (flag_id) REFERENCES feature_flags(id) ON DELETE CASCADE,
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: feature_flag_schools');
  }

  // Seed the one flag Phase 5+ will actually gate on.
  const [[existingFlag]] = await conn.query('SELECT id FROM feature_flags WHERE flag_key=?', ['tune_your_brain_pilot_enabled']);
  if (!existingFlag) {
    await conn.query(
      'INSERT INTO feature_flags (flag_key, description, enabled_globally) VALUES (?, ?, 0)',
      ['tune_your_brain_pilot_enabled', 'Gates the new Tune Your Brain experience shells/engines while in pilot. Off by default.']
    );
    console.log('Seeded feature flag: tune_your_brain_pilot_enabled (disabled)');
  } else {
    console.log('Skipped: tune_your_brain_pilot_enabled already seeded');
  }

  // 3. skills — empty by design, Phase 4 seeds real content.
  if (await tableExists(conn, 'skills')) {
    console.log('Skipped: skills');
  } else {
    await conn.query(`CREATE TABLE skills (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      skill_key VARCHAR(64) NOT NULL UNIQUE,
      label VARCHAR(150) NOT NULL,
      domain VARCHAR(50) NOT NULL,
      definition TEXT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: skills (empty — Phase 4 seeds real content)');
  }

  // 4. skill_prerequisites
  if (await tableExists(conn, 'skill_prerequisites')) {
    console.log('Skipped: skill_prerequisites');
  } else {
    await conn.query(`CREATE TABLE skill_prerequisites (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      skill_id INT UNSIGNED NOT NULL,
      prerequisite_skill_id INT UNSIGNED NOT NULL,
      UNIQUE KEY uniq_skill_prereq (skill_id, prerequisite_skill_id),
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (prerequisite_skill_id) REFERENCES skills(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: skill_prerequisites');
  }

  // 5. learning_events — normalized session/event stream. NEVER free text;
  // metadata_json is for small structured facts only (e.g. {"difficulty":"hard"}).
  if (await tableExists(conn, 'learning_events')) {
    console.log('Skipped: learning_events');
  } else {
    await conn.query(`CREATE TABLE learning_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id INT UNSIGNED NULL,
      student_id INT UNSIGNED NULL,
      school_id INT UNSIGNED NULL,
      session_token VARCHAR(64) NULL,
      event_type VARCHAR(50) NOT NULL,
      game_id INT UNSIGNED NULL,
      skill_id INT UNSIGNED NULL,
      content_version VARCHAR(50) NULL,
      metadata_json TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_student (student_id),
      INDEX idx_school_created (school_id, created_at),
      INDEX idx_event_type (event_type),
      INDEX idx_session (session_token),
      FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE,
      FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES brain_games(id) ON DELETE SET NULL,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    console.log('Created: learning_events');
  }

  // D3 — provisional retention default, admin-adjustable via the settings
  // table (no schema change needed to change the number later).
  const [[existingSetting]] = await conn.query("SELECT setting_value FROM settings WHERE setting_key='learning_events_retention_days'");
  if (!existingSetting) {
    await conn.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES ('learning_events_retention_days', '400')"
    );
    console.log('Seeded setting: learning_events_retention_days = 400 (provisional, see D3)');
  } else {
    console.log('Skipped: learning_events_retention_days already set');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });

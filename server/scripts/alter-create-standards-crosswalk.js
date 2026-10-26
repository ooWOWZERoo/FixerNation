require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Creates the state-standards / Portrait-of-a-Graduate crosswalk tables
// (docs/standards-crosswalk/DESIGN.md). New tables only -- nothing existing is altered.
// Idempotent: each table is created only if it isn't already there, so re-running is safe.
// db/schema.sql carries the same definitions for fresh installs.
//
// Order matters (foreign keys): coverage and frameworks first, then items (FK to
// frameworks), then alignments (FK to items) -- Object.entries keeps insertion order.
const TABLES = {
  standards_state_coverage: `CREATE TABLE IF NOT EXISTS standards_state_coverage (
  state_code CHAR(2) NOT NULL PRIMARY KEY, -- 50 states + DC
  sel_status ENUM('k12_standards','prek_only','guidance_only','none','unknown') NOT NULL DEFAULT 'unknown',
  pog_status ENUM('statewide','state_led_in_progress','district_led_only','none','unknown') NOT NULL DEFAULT 'unknown',
  sel_source_url VARCHAR(500) NULL,
  pog_source_url VARCHAR(500) NULL,
  source_accessed_on DATE NULL, -- the day a person/Claude actually looked at the source(s)
  notes VARCHAR(1000) NULL,
  review_status ENUM('draft','verified') NOT NULL DEFAULT 'draft',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  standards_frameworks: `CREATE TABLE IF NOT EXISTS standards_frameworks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  state_code CHAR(2) NOT NULL,
  framework_type ENUM('sel_standards','portrait_of_graduate') NOT NULL,
  name VARCHAR(255) NOT NULL,
  issuing_body VARCHAR(255) NOT NULL,
  official_url VARCHAR(500) NOT NULL,
  adopted_year SMALLINT UNSIGNED NULL,
  grade_span VARCHAR(32) NULL,
  source_accessed_on DATE NOT NULL,
  notes VARCHAR(1000) NULL,
  review_status ENUM('draft','verified') NOT NULL DEFAULT 'draft',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_state_type_name (state_code, framework_type, name),
  INDEX idx_state (state_code),
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  standards_items: `CREATE TABLE IF NOT EXISTS standards_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  framework_id INT UNSIGNED NOT NULL,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary VARCHAR(600) NULL, -- short paraphrase/excerpt only; the official_url is the source of truth
  grade_band VARCHAR(32) NULL,
  casel_competency ENUM('self_awareness','self_management','social_awareness','relationship_skills','responsible_decision_making') NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_framework_code (framework_id, code),
  FOREIGN KEY (framework_id) REFERENCES standards_frameworks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  standards_alignments: `CREATE TABLE IF NOT EXISTS standards_alignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id INT UNSIGNED NOT NULL,
  target_type ENUM('program','curriculum','brain_game') NOT NULL,
  target_id INT UNSIGNED NOT NULL DEFAULT 0, -- 0 for 'program' (FNE as a whole)
  strength ENUM('direct','supporting') NOT NULL,
  rationale VARCHAR(1000) NOT NULL,
  review_status ENUM('draft','verified') NOT NULL DEFAULT 'draft',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_item_target (item_id, target_type, target_id),
  FOREIGN KEY (item_id) REFERENCES standards_items(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  for (const [name, ddl] of Object.entries(TABLES)) {
    const [rows] = await connection.query(
      'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [process.env.DB_NAME, name]
    );
    if (rows.length) {
      console.log(`Skipped: ${name} already exists.`);
    } else {
      await connection.query(ddl);
      console.log(`Created ${name}.`);
    }
  }

  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

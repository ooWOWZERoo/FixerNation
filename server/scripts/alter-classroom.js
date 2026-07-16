require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function tableExists(conn, name) {
  const [r] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, name]
  );
  return r.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const tables = [
    ['classrooms', `
      CREATE TABLE classrooms (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name             VARCHAR(150) NOT NULL,
        teacher_site_user_id INT UNSIGNED NOT NULL,
        purchase_id      INT UNSIGNED NULL,
        join_code        CHAR(8) NOT NULL,
        grade_level      VARCHAR(60),
        subject          VARCHAR(100),
        academic_year    VARCHAR(20),
        archived_at      DATETIME NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_join_code (join_code),
        KEY idx_teacher (teacher_site_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['classroom_students', `
      CREATE TABLE classroom_students (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        classroom_id     INT UNSIGNED NOT NULL,
        display_name     VARCHAR(100) NOT NULL,
        username         VARCHAR(60) NOT NULL,
        password_hash    VARCHAR(255) NOT NULL,
        student_number   VARCHAR(50) NULL,
        is_active        TINYINT(1) NOT NULL DEFAULT 1,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_username (username),
        KEY idx_classroom (classroom_id),
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['classroom_assignments', `
      CREATE TABLE classroom_assignments (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        classroom_id     INT UNSIGNED NOT NULL,
        curriculum_id    INT UNSIGNED NOT NULL,
        assigned_by_id   INT UNSIGNED NOT NULL,
        sort_order       INT NOT NULL DEFAULT 0,
        due_date         DATE NULL,
        assigned_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_classroom_curriculum (classroom_id, curriculum_id),
        KEY idx_classroom (classroom_id),
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['classroom_game_assignments', `
      CREATE TABLE classroom_game_assignments (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        classroom_id     INT UNSIGNED NOT NULL,
        game_id          INT UNSIGNED NOT NULL,
        assigned_by_id   INT UNSIGNED NOT NULL,
        due_date         DATE NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_classroom (classroom_id),
        FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['student_lesson_progress', `
      CREATE TABLE student_lesson_progress (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id       INT UNSIGNED NOT NULL,
        curriculum_id    INT UNSIGNED NOT NULL,
        started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at     DATETIME NULL,
        last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_curriculum (student_id, curriculum_id),
        KEY idx_student (student_id),
        FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['student_quiz_responses', `
      CREATE TABLE student_quiz_responses (
        id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id            INT UNSIGNED NOT NULL,
        curriculum_id         INT UNSIGNED NOT NULL,
        question_id           INT UNSIGNED NOT NULL,
        selected_option_index INT NOT NULL,
        is_correct            TINYINT(1) NOT NULL,
        submitted_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_student_question (student_id, question_id),
        KEY idx_student_curriculum (student_id, curriculum_id),
        FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['student_reflections', `
      CREATE TABLE student_reflections (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id       INT UNSIGNED NOT NULL,
        curriculum_id    INT UNSIGNED NOT NULL,
        prompt_key       VARCHAR(60) NOT NULL,
        response_text    TEXT NOT NULL,
        submitted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        teacher_seen_at  DATETIME NULL,
        KEY idx_student_curriculum (student_id, curriculum_id),
        KEY idx_curriculum (curriculum_id),
        FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['student_goals', `
      CREATE TABLE student_goals (
        id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id       INT UNSIGNED NOT NULL,
        goal_text        TEXT NOT NULL,
        target_date      DATE NULL,
        is_achieved      TINYINT(1) NOT NULL DEFAULT 0,
        achieved_at      DATETIME NULL,
        created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_student (student_id),
        FOREIGN KEY (student_id) REFERENCES classroom_students(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
    ['student_game_completions', `
      CREATE TABLE student_game_completions (
        id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        student_id          INT UNSIGNED NOT NULL,
        game_assignment_id  INT UNSIGNED NOT NULL,
        raw_score           INT NULL,
        duration_ms         INT NULL,
        completed_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_student (student_id),
        KEY idx_assignment (game_assignment_id),
        FOREIGN KEY (student_id)         REFERENCES classroom_students(id)       ON DELETE CASCADE,
        FOREIGN KEY (game_assignment_id) REFERENCES classroom_game_assignments(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `],
  ];

  for (const [name, sql] of tables) {
    if (await tableExists(conn, name)) {
      console.log(`Skipped (already exists): ${name}`);
    } else {
      await conn.query(sql);
      console.log(`Created: ${name}`);
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });

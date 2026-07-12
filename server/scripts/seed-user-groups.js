require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const SYSTEM_GROUPS = [
  { name: 'Consumer',         systemKey: 'consumer' },
  { name: 'Service Providers', systemKey: 'service_provider' },
  { name: 'Brand Ambassadors', systemKey: 'brand_ambassador' },
  { name: 'Teachers',          systemKey: 'teachers' },
];

const ED_PRODUCT = {
  name: 'Registration — 2D Education Program',
  description: 'For all school-purchased tier plans, this price becomes $0 at checkout. Be sure to use your school email address.',
  bulletPoints: 'Be sure to complete each field on your registration form\nYou\'ll receive an onboarding welcome email when submitted\nSetup instructions included in your second email',
  footerNote: 'Valid for 12 months',
  seatCount: 1,
  priceCents: 14900,
  sortOrder: -1,
};

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // --- Add system_key column to contact_groups if missing ---
  try {
    await connection.query('ALTER TABLE contact_groups ADD COLUMN system_key VARCHAR(50) NULL');
    await connection.query('ALTER TABLE contact_groups ADD UNIQUE KEY idx_system_key (system_key)');
    console.log('Added system_key column to contact_groups');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate column')) {
      console.log('system_key column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Add auto_assign_group_id column to license_products if missing ---
  try {
    await connection.query('ALTER TABLE license_products ADD COLUMN auto_assign_group_id INT UNSIGNED NULL');
    console.log('Added auto_assign_group_id column to license_products');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log('auto_assign_group_id column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Add bullet_points column to license_products if missing ---
  try {
    await connection.query('ALTER TABLE license_products ADD COLUMN bullet_points TEXT NULL');
    console.log('Added bullet_points column to license_products');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log('bullet_points column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Add footer_note column to license_products if missing ---
  try {
    await connection.query('ALTER TABLE license_products ADD COLUMN footer_note VARCHAR(255) NULL');
    console.log('Added footer_note column to license_products');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log('footer_note column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Add policy column to membership_plans if missing ---
  try {
    await connection.query('ALTER TABLE membership_plans ADD COLUMN policy TEXT NULL');
    console.log('Added policy column to membership_plans');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log('policy column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Upsert 4 system groups ---
  for (const g of SYSTEM_GROUPS) {
    const [existing] = await connection.query('SELECT id FROM contact_groups WHERE system_key = ?', [g.systemKey]);
    if (existing.length) {
      console.log(`Group already exists by system_key: ${g.name} (${g.systemKey})`);
      continue;
    }
    const [byName] = await connection.query('SELECT id FROM contact_groups WHERE name = ?', [g.name]);
    if (byName.length) {
      await connection.query('UPDATE contact_groups SET system_key = ? WHERE id = ?', [g.systemKey, byName[0].id]);
      console.log(`Updated existing group "${g.name}" with system_key="${g.systemKey}"`);
    } else {
      await connection.query('INSERT INTO contact_groups (name, system_key) VALUES (?, ?)', [g.name, g.systemKey]);
      console.log(`Created group: ${g.name} (${g.systemKey})`);
    }
  }

  // --- Create "Registration — 2D Education Program" license product ---
  const [existingProd] = await connection.query('SELECT id FROM license_products WHERE name = ?', [ED_PRODUCT.name]);
  if (existingProd.length) {
    // Update the content fields on the existing product (idempotent)
    await connection.query(
      'UPDATE license_products SET description = ?, bullet_points = ?, footer_note = ? WHERE id = ?',
      [ED_PRODUCT.description, ED_PRODUCT.bulletPoints, ED_PRODUCT.footerNote, existingProd[0].id]
    );
    console.log(`Updated license product content: ${ED_PRODUCT.name}`);
  } else {
    await connection.query(
      'INSERT INTO license_products (name, description, bullet_points, footer_note, seat_count, price_cents, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [ED_PRODUCT.name, ED_PRODUCT.description, ED_PRODUCT.bulletPoints, ED_PRODUCT.footerNote, ED_PRODUCT.seatCount, ED_PRODUCT.priceCents, ED_PRODUCT.sortOrder]
    );
    console.log(`Created license product: ${ED_PRODUCT.name}`);
  }

  // --- Add morning_boost_unsubscribed_at to newsletter_contacts if missing ---
  try {
    await connection.query('ALTER TABLE newsletter_contacts ADD COLUMN morning_boost_unsubscribed_at DATETIME NULL');
    console.log('Added morning_boost_unsubscribed_at column to newsletter_contacts');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log('morning_boost_unsubscribed_at column already exists — skipping ALTER');
    } else {
      throw err;
    }
  }

  // --- Add Morning Boost email automation tables if missing ---
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS morning_boost_email_config (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        enabled TINYINT(1) NOT NULL DEFAULT 0,
        send_time TIME NOT NULL DEFAULT '07:00:00',
        send_timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
        from_name VARCHAR(255) NOT NULL DEFAULT 'Fixer Nation',
        from_email VARCHAR(255) NOT NULL DEFAULT '',
        reply_to VARCHAR(255) NULL,
        subject VARCHAR(255) NOT NULL DEFAULT 'Morning Boost — {{title}}',
        body TEXT NOT NULL DEFAULT '',
        body_format VARCHAR(8) NOT NULL DEFAULT 'html',
        cta_text VARCHAR(255) NOT NULL DEFAULT 'Read Today''s Morning Boost',
        cta_url_override VARCHAR(500) NULL,
        fallback_message TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        updated_by INT UNSIGNED NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('morning_boost_email_config table ready');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS morning_boost_email_groups (
        config_id INT UNSIGNED NOT NULL,
        group_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (config_id, group_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('morning_boost_email_groups table ready');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS morning_boost_sends (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        config_id INT UNSIGNED NULL,
        blog_post_id INT UNSIGNED NULL,
        boost_date DATE NOT NULL,
        scheduled_for DATETIME NOT NULL,
        sent_at DATETIME NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        subject VARCHAR(255) NULL,
        from_email VARCHAR(255) NULL,
        from_name VARCHAR(255) NULL,
        reply_to VARCHAR(255) NULL,
        cta_url VARCHAR(500) NULL,
        group_ids TEXT NULL,
        recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
        sent_count INT UNSIGNED NOT NULL DEFAULT 0,
        failed_count INT UNSIGNED NOT NULL DEFAULT 0,
        skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
        failure_reason TEXT NULL,
        is_resend TINYINT(1) NOT NULL DEFAULT 0,
        initiated_by INT UNSIGNED NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_boost_date (boost_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('morning_boost_sends table ready');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS morning_boost_send_recipients (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        send_id INT UNSIGNED NOT NULL,
        contact_id INT UNSIGNED NULL,
        email VARCHAR(255) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        error_message VARCHAR(500) NULL,
        sent_at DATETIME NULL,
        open_token VARCHAR(64) NULL UNIQUE,
        opened_at DATETIME NULL,
        click_token VARCHAR(64) NULL UNIQUE,
        clicked_at DATETIME NULL,
        INDEX idx_send (send_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('morning_boost_send_recipients table ready');
  } catch (err) {
    console.log('Morning Boost email tables already exist or error:', err.message);
  }

  // --- Add school_admin_notifications table if missing ---
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS school_admin_notifications (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        school_domain VARCHAR(255) NOT NULL,
        reason VARCHAR(64) NOT NULL,
        teacher_email VARCHAR(255) NOT NULL,
        admin_contact_id INT UNSIGNED NULL,
        sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_domain_reason_sent (school_domain, reason, sent_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('school_admin_notifications table ready');
  } catch (err) {
    console.log('school_admin_notifications table already exists or error:', err.message);
  }

  // --- Social platform tables ---
  const socialTables = [
    [`CREATE TABLE IF NOT EXISTS social_profiles (
        user_id INT UNSIGNED PRIMARY KEY,
        bio TEXT NULL,
        bio_consent TINYINT(1) NOT NULL DEFAULT 0,
        avatar_url VARCHAR(500) NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_profiles'],
    [`CREATE TABLE IF NOT EXISTS social_groups (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type ENUM('all_teachers','school','membership') NOT NULL,
        school_domain VARCHAR(255) NULL,
        description TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_type (type),
        INDEX idx_school_domain (school_domain)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_groups'],
    [`CREATE TABLE IF NOT EXISTS social_group_members (
        group_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id),
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_group_members'],
    [`CREATE TABLE IF NOT EXISTS social_posts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        group_id INT UNSIGNED NOT NULL,
        author_id INT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        attachments JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        INDEX idx_group_created (group_id, created_at),
        FOREIGN KEY (group_id) REFERENCES social_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_posts'],
    [`CREATE TABLE IF NOT EXISTS social_reactions (
        post_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        reaction VARCHAR(20) NOT NULL DEFAULT 'like',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (post_id, user_id),
        FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_reactions'],
    [`CREATE TABLE IF NOT EXISTS social_comments (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        post_id INT UNSIGNED NOT NULL,
        author_id INT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        INDEX idx_post (post_id),
        FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_comments'],
    [`CREATE TABLE IF NOT EXISTS social_messages (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        sender_id INT UNSIGNED NOT NULL,
        recipient_id INT UNSIGNED NOT NULL,
        content TEXT NOT NULL,
        attachments JSON NULL,
        read_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        INDEX idx_thread (sender_id, recipient_id, created_at),
        INDEX idx_recipient (recipient_id, read_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`, 'social_messages'],
  ];
  for (const [sql, label] of socialTables) {
    try {
      await connection.query(sql);
      console.log(`${label} table ready`);
    } catch (err) {
      console.log(`${label} table already exists or error:`, err.message);
    }
  }

  // --- Add is_public column to social_groups if missing ---
  try {
    await connection.query("ALTER TABLE social_groups ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1");
    console.log('Added is_public column to social_groups');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
      console.log('is_public column already exists — skipping');
    } else { throw err; }
  }

  // --- Extend social_groups.type ENUM to include 'custom' ---
  try {
    await connection.query("ALTER TABLE social_groups MODIFY COLUMN type ENUM('all_teachers','school','membership','custom') NOT NULL DEFAULT 'custom'");
    console.log('Extended social_groups.type ENUM with custom');
  } catch (err) {
    console.log('social_groups.type ENUM already updated or error:', err.message);
  }

  // --- Create curriculum_documents table if missing + migrate legacy lesson_document column ---
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS curriculum_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        curriculum_id INT NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('curriculum_documents table ready');
    // Migrate any data still in the legacy lesson_document column
    const [legacy] = await connection.query(
      "SELECT id, lesson_document, lesson_document_name FROM curricula WHERE lesson_document IS NOT NULL AND lesson_document != '' AND id NOT IN (SELECT DISTINCT curriculum_id FROM curriculum_documents)"
    ).catch(() => [[]]);
    if (legacy.length) {
      await connection.query(
        'INSERT INTO curriculum_documents (curriculum_id, file_path, file_name, sort_order) VALUES ' +
        legacy.map(() => '(?, ?, ?, 0)').join(', '),
        legacy.flatMap(r => [r.id, r.lesson_document, r.lesson_document_name || 'Lesson Plan'])
      );
      console.log(`Migrated ${legacy.length} legacy lesson document(s) into curriculum_documents`);
    }
  } catch (err) {
    console.log('curriculum_documents migration error:', err.message);
  }

  // --- Deactivate "Registration 2D Education Program" membership plan ---
  const [planResult] = await connection.query(
    "UPDATE membership_plans SET active = 0 WHERE name = 'Registration 2D Education Program' AND active = 1"
  );
  if (planResult.affectedRows) {
    console.log('Deactivated membership plan: Registration 2D Education Program');
  } else {
    console.log('Membership plan already inactive or not found — skipping');
  }

  console.log('\nDone.');
  await connection.end();
}

main().catch(err => {
  console.error('Seeding user groups failed:', err.message);
  process.exit(1);
});

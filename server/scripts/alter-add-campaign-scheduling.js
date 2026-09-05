// Adds: (1) multiple audience groups per campaign (join table, replacing the
// single audience_group_id column — kept in place, unused, for history),
// (2) scheduling a campaign for a future date/time, (3) recurring campaign
// series that spawn independently-tracked occurrences.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  // 1. Multiple audience groups
  if (await tableExists(conn, 'campaign_audience_groups')) {
    console.log('Skipped (already exists): campaign_audience_groups');
  } else {
    await conn.query(`
      CREATE TABLE campaign_audience_groups (
        campaign_id INT UNSIGNED NOT NULL,
        group_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (campaign_id, group_id),
        KEY group_id (group_id),
        CONSTRAINT campaign_audience_groups_ibfk_1 FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
        CONSTRAINT campaign_audience_groups_ibfk_2 FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: campaign_audience_groups');

    const [backfillResult] = await conn.query(
      `INSERT INTO campaign_audience_groups (campaign_id, group_id)
       SELECT id, audience_group_id FROM campaigns WHERE audience_group_id IS NOT NULL`
    );
    console.log(`Backfilled ${backfillResult.affectedRows} existing single-group campaigns into campaign_audience_groups`);
  }

  // 2. Scheduling
  if (await columnExists(conn, 'campaigns', 'scheduled_for')) {
    console.log('Skipped (already exists): campaigns.scheduled_for');
  } else {
    await conn.query('ALTER TABLE campaigns ADD COLUMN scheduled_for DATETIME NULL AFTER status');
    console.log('Added column: campaigns.scheduled_for');
  }

  // 3. Recurring series
  if (await tableExists(conn, 'campaign_series')) {
    console.log('Skipped (already exists): campaign_series');
  } else {
    await conn.query(`
      CREATE TABLE campaign_series (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        subject VARCHAR(255) NOT NULL,
        from_name VARCHAR(255) NOT NULL DEFAULT 'Fixer Nation',
        from_email VARCHAR(255) NOT NULL DEFAULT '',
        audience_status VARCHAR(32) NOT NULL DEFAULT 'Subscribed',
        audience_source VARCHAR(128) NOT NULL DEFAULT 'All',
        body MEDIUMTEXT,
        body_format VARCHAR(16) NOT NULL DEFAULT 'text',
        recurrence_type VARCHAR(16) NOT NULL,
        recurrence_day_of_week TINYINT UNSIGNED NULL,
        recurrence_day_of_month TINYINT UNSIGNED NULL,
        send_time TIME NOT NULL DEFAULT '09:00:00',
        send_timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        next_fire_at DATETIME NULL,
        last_fired_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_active_next_fire (is_active, next_fire_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: campaign_series');
  }

  if (await tableExists(conn, 'campaign_series_groups')) {
    console.log('Skipped (already exists): campaign_series_groups');
  } else {
    await conn.query(`
      CREATE TABLE campaign_series_groups (
        series_id INT UNSIGNED NOT NULL,
        group_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (series_id, group_id),
        KEY group_id (group_id),
        CONSTRAINT campaign_series_groups_ibfk_1 FOREIGN KEY (series_id) REFERENCES campaign_series(id) ON DELETE CASCADE,
        CONSTRAINT campaign_series_groups_ibfk_2 FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('Created table: campaign_series_groups');
  }

  if (await columnExists(conn, 'campaigns', 'series_id')) {
    console.log('Skipped (already exists): campaigns.series_id');
  } else {
    await conn.query('ALTER TABLE campaigns ADD COLUMN series_id INT UNSIGNED NULL AFTER audience_group_id');
    await conn.query('ALTER TABLE campaigns ADD CONSTRAINT campaigns_series_fk FOREIGN KEY (series_id) REFERENCES campaign_series(id) ON DELETE SET NULL');
    console.log('Added column + FK: campaigns.series_id');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

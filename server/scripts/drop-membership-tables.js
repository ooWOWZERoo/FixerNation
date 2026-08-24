// Removes the membership feature from the database entirely, per the user's
// explicit request (2026-08-23) — memberships don't belong on an education
// platform, and the consumer-facing product was already deleted in an
// earlier session. Run backup-membership-data.js FIRST and confirm the
// backup file looks right before running this — it is not reversible.
//
// Order matters: purchases.membership_plan_id's FK must be dropped before
// the column, and contact_memberships (which also FKs to membership_plans)
// must be dropped before membership_plans itself.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  return rows.length > 0;
}

(async () => {
  const conn = await pool.getConnection();
  try {
    if (await columnExists(conn, 'purchases', 'membership_plan_id')) {
      const [fkRows] = await conn.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'purchases' AND COLUMN_NAME = 'membership_plan_id'
           AND REFERENCED_TABLE_NAME = 'membership_plans'`,
        [process.env.DB_NAME]
      );
      for (const { CONSTRAINT_NAME } of fkRows) {
        await conn.query(`ALTER TABLE purchases DROP FOREIGN KEY ${CONSTRAINT_NAME}`);
        console.log(`Dropped FK: purchases.${CONSTRAINT_NAME}`);
      }
      await conn.query('ALTER TABLE purchases DROP COLUMN membership_plan_id');
      console.log('Dropped column: purchases.membership_plan_id');
    } else {
      console.log('purchases.membership_plan_id already gone, skipping');
    }

    if (await tableExists(conn, 'contact_memberships')) {
      await conn.query('DROP TABLE contact_memberships');
      console.log('Dropped table: contact_memberships');
    } else {
      console.log('contact_memberships already gone, skipping');
    }

    if (await tableExists(conn, 'membership_plans')) {
      await conn.query('DROP TABLE membership_plans');
      console.log('Dropped table: membership_plans');
    } else {
      console.log('membership_plans already gone, skipping');
    }

    const [delResult] = await conn.query(
      "DELETE FROM email_automations WHERE event_key IN ('membership_purchase_thank_you','membership_renewal_reminder','payment_failed','membership_trial_started')"
    );
    console.log(`Deleted ${delResult.affectedRows} membership-related email_automations row(s)`);

    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();

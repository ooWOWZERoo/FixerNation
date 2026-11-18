require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Sales CRM punch list G12 (ACT-03): three optional columns on crm_appointments. time_zone (the IANA zone the organizer set the meeting up in), join_url (an https link to the
// video call) and attendance_json (who came, marked by staff afterwards). Idempotent; safe to re-run. Run it BEFORE restarting the Node app: the meeting panel, the invitation
// and the calendar read them. Additive only: no row is changed.
//
//   node scripts/alter-add-crm-meeting-details.js

const COLUMNS = [
  ['time_zone', 'VARCHAR(64) NULL'],
  ['join_url', 'VARCHAR(500) NULL'],
  ['attendance_json', 'TEXT NULL'],
];

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  const schema = process.env.DB_NAME;
  const [[t]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?', [schema, 'crm_appointments']);
  if (!Number(t.n)) { console.error('Stopped: crm_appointments does not exist here (run scripts/alter-create-crm-execution.js first). Nothing was changed.'); process.exit(1); }
  for (const [name, ddl] of COLUMNS) {
    const [[c]] = await db.query('SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [schema, 'crm_appointments', name]);
    if (Number(c.n)) { console.log(`Skipped: crm_appointments.${name} already exists.`); continue; }
    try {
      await db.query(`ALTER TABLE crm_appointments ADD COLUMN ${name} ${ddl}`);
      console.log(`Added crm_appointments.${name}.`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') console.log(`Skipped: crm_appointments.${name} already exists.`);
      else throw err;
    }
  }
  console.log('Done.');
  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });

// Marks (or unmarks) one sign-in account as Fixer Nation staff, so it may join and see every Community group
// (docs/reference/community-group-privacy-requirements.md, rule A4). Dry run by default.
//
//   node scripts/set-fne-staff-account.js --email=johnfshaw@yahoo.com            DRY RUN: shows the account and what would change
//   node scripts/set-fne-staff-account.js --email=johnfshaw@yahoo.com --apply    marks it
//   node scripts/set-fne-staff-account.js --email=johnfshaw@yahoo.com --remove --apply   unmarks it
//
// Only an existing, verified account is marked, and only by running this on the server. Nothing in the website can set the flag.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--email='));
  const email = arg ? arg.slice('--email='.length).trim().toLowerCase() : '';
  if (!email || !email.includes('@')) throw new Error('Give an email, for example --email=name@example.com');
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    const [[user]] = await conn.query('SELECT id, email, first_name, last_name, email_verified, is_fne_staff FROM site_users WHERE LOWER(email) = ?', [email]);
    if (!user) throw new Error(`No sign-in account has the email ${email}.`);
    console.log(`Account ${user.id}: ${[user.first_name, user.last_name].filter(Boolean).join(' ')} <${user.email}>, ${Number(user.email_verified) ? 'verified' : 'NOT verified'}, staff flag ${Number(user.is_fne_staff) ? 'ON' : 'off'}.`);
    if (!remove && !Number(user.email_verified)) throw new Error('This account has not verified its email, so it will not be marked.');
    const want = remove ? 0 : 1;
    if (Number(user.is_fne_staff) === want) { console.log('Nothing to change.'); return; }
    console.log(`${apply ? 'Setting' : 'Would set'} the staff flag ${want ? 'ON' : 'off'}.`);
    if (apply) {
      await conn.query('UPDATE site_users SET is_fne_staff = ? WHERE id = ?', [want, user.id]);
      await conn.query(
        `INSERT INTO school_audit_log (actor_type, action, entity_type, entity_id, reason) VALUES ('system', ?, 'site_users', ?, 'set from the server with set-fne-staff-account.js')`,
        [want ? 'fne_staff_flag_set' : 'fne_staff_flag_removed', user.id]
      );
      console.log('Done.');
    } else {
      console.log('(dry run: nothing was changed; add --apply to do it)');
    }
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });

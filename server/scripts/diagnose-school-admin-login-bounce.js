// Read-only diagnostic for "login succeeds, dashboard flashes, bounces back
// to login" on school-admin-dashboard.html. requireSchoolAdmin (and
// requireSiteAuth) reject a token if payload.iat (real UTC epoch from the
// JWT) is earlier than session_invalidated_at — but session_invalidated_at
// comes back from mysql2 as a plain "YYYY-MM-DD HH:MM:SS" string
// (dateStrings:true, no offset), and new Date() on a string in that format
// parses it as LOCAL time, not UTC. If the DB's NOW() and the Node
// process's local clock disagree on what "local" means, a freshly-issued
// token can look like it predates a stale invalidation timestamp — this
// script surfaces that mismatch directly instead of guessing at it.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

async function main() {
  const conn = await pool.getConnection();
  try {
    const [[clocks]] = await conn.query('SELECT NOW() AS db_now, UTC_TIMESTAMP() AS db_utc_now');
    const nodeNow = new Date();
    console.log('DB NOW():        ', clocks.db_now);
    console.log('DB UTC_TIMESTAMP():', clocks.db_utc_now);
    console.log('Node local now:  ', nodeNow.toString());
    console.log('Node ISO (UTC):  ', nodeNow.toISOString());
    console.log('Node TZ:         ', Intl.DateTimeFormat().resolvedOptions().timeZone, `(UTC offset ${-nodeNow.getTimezoneOffset() / 60}h)`);
    console.log('If DB NOW() and DB UTC_TIMESTAMP() differ, the DB session is not running in UTC.');
    console.log('');

    const [rows] = await conn.query(
      `SELECT id, email, role, session_invalidated_at
       FROM site_users
       WHERE role IN ('school_license_admin', 'teacher', 'parent') AND session_invalidated_at IS NOT NULL
       ORDER BY session_invalidated_at DESC`
    );

    if (!rows.length) {
      console.log('No site_users currently have session_invalidated_at set.');
      return;
    }

    console.log(`${rows.length} account(s) with session_invalidated_at set:\n`);
    rows.forEach(r => {
      const parsedMs = new Date(r.session_invalidated_at).getTime();
      const appearsFuture = parsedMs > Date.now();
      console.log(
        `${appearsFuture ? '[SUSPECT — parses as future]' : '[looks OK]'} ${r.email} (${r.role}) ` +
        `session_invalidated_at="${r.session_invalidated_at}" -> parsed as ${new Date(parsedMs).toString()}`
      );
    });
    console.log('\nAny "[SUSPECT]" row will reject every login for that account until real wall-clock time catches up to the parsed (shifted) value — that is the bounce-back bug.');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });

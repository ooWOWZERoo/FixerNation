require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

// READ-ONLY. Phase 5 of the demo workspaces plan (docs/reference/shared-demo-workspaces-requirements.md, D7) retires the ORIGINAL single demo.
// Before anything is deleted, this shows whether anyone ever used it: counts only, never a name, an email or an address.
//
//   node scripts/check-original-demo-use.js
//
// "Original demo" means events and requests with no group (public_demo_events.invitation_id = 0, support_requests.demo_invitation_id = 0 and
// demo_window > 0). A count of zero everywhere means the original demo was only ever switched on for your own testing.

async function main() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    dateStrings: true,
  });
  const has = async (table, column) => {
    const [r] = await conn.query('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?', [process.env.DB_NAME, table, column]);
    return r.length > 0;
  };
  try {
    console.log('\nOriginal demo: was it ever used? (read-only)\n');

    const byInv = (await has('public_demo_events', 'invitation_id')) ? ' AND invitation_id = 0' : '';
    const [events] = await conn.query(
      `SELECT window_id, kind, COALESCE(detail, '') AS detail, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at
         FROM public_demo_events WHERE 1 = 1${byInv} GROUP BY window_id, kind, detail ORDER BY window_id, kind, detail`);
    if (!events.length) console.log('Events (access-code entries and sign-ins): none.');
    else {
      console.log('Events (window, kind, role, count, first, last; times are UTC):');
      for (const e of events) console.log(`  window ${e.window_id}  ${String(e.kind).padEnd(11)} ${String(e.detail).padEnd(9)} ${String(e.n).padStart(4)}  ${e.first_at}  ${e.last_at}`);
    }

    for (const [table, label] of [['support_requests', 'Support tickets'], ['quote_requests', 'Quote requests']]) {
      if (!(await has(table, 'demo_window'))) { console.log(`${label}: column not there yet.`); continue; }
      const grp = (await has(table, 'demo_invitation_id')) ? ' AND demo_invitation_id = 0' : '';
      const [[r]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE demo_window > 0${grp}`);
      console.log(`${label} from the original demo: ${r.n}`);
    }

    const [[acct]] = await conn.query('SELECT COUNT(*) AS n FROM site_users WHERE is_shared_demo = 1 AND demo_workspace_id IS NULL').catch(() => [[{ n: '?' }]]);
    console.log(`Original-demo logins that still exist: ${acct.n}`);

    const [settings] = await conn.query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('public_demo_enabled', 'public_demo_ends_at', 'public_demo_window_id')");
    console.log('Switch: ' + (settings.map(s => `${s.setting_key} = ${s.setting_value || '(empty)'}`).join(', ') || '(no settings)'));
    console.log('\nZero events, zero tickets and zero quotes means nobody outside your own testing used it.\n');
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { legacyFixtures } = require('../lib/public-demo-workspaces');

// Removes the ORIGINAL single shared demo from the database (phase 5 of docs/reference/shared-demo-workspaces-requirements.md, decision D7). Group demos now run
// in private workspaces; nothing reads the original demo any more, and its published password and PIN should not sit in the settings table.
//
//   node scripts/retire-original-demo.js
//       DRY RUN (default): does everything inside a transaction against the real schema, reports what it would remove, then ROLLS BACK.
//   node scripts/retire-original-demo.js --apply
//       Does it, in one transaction: if anything goes wrong nothing is removed.
//
// What it removes, and only this:
//   - the four original demo logins (demo-district@, demo-school@, demo-teacher@, demo-parent@public-demo.example.com), but only a row flagged is_shared_demo and
//     belonging to no workspace; any other row with such an address stops the script;
//   - the original demo classroom with its three fake students and all their work, its invitations, licence seats, administrator assignments, branding
//     and district frameworks, and the fake example.com accounts an invitation made in it (only when nothing else uses them);
//   - the original demo's purchase, school ("public-demo.example.com") and district ("FNE Demo District"), but only when the school is the district's only
//     school and the purchase belongs to the demo's own CRM contact;
//   - the settings public_demo_enabled, public_demo_ends_at, public_demo_access_code, public_demo_password, public_demo_pin, public_demo_code_version and
//     public_demo_window_id (the password and PIN were stored in the clear).
// It keeps what the workspaces share: the "[Public Demo] Demo License" product and the "public-demo@example.com" CRM contact. It never touches a workspace
// (workspace logins carry a two-digit number), a real school, district, teacher or student, and it leaves the old access-code entry counts in
// public_demo_events alone.
//
// Safe to run twice: once everything is gone it reports "nothing to remove".

const SETTINGS = ['public_demo_enabled', 'public_demo_ends_at', 'public_demo_access_code', 'public_demo_password', 'public_demo_pin', 'public_demo_code_version', 'public_demo_window_id'];
const isExampleDomain = (email) => /@([a-z0-9-]+\.)*example\.com$/i.test(String(email || '').trim());
const isMissingTable = (err) => err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR' || /no such (table|column)/i.test(String(err.message)));
const marks = (arr) => arr.map(() => '?').join(', ');

async function one(conn, sql, params) { const [rows] = await conn.query(sql, params); return rows[0] || null; }
async function many(conn, sql, params) { const [rows] = await conn.query(sql, params); return rows; }

function makeReport() {
  const lines = [];
  return { removed: (what) => lines.push(['remove', what]), note: (what) => lines.push(['note  ', what]), lines,
    print(prefix) { for (const [kind, what] of lines) console.log(`  ${prefix}${kind}  ${what}`); } };
}

// A table or column that is not on this install is simply nothing to remove.
async function del(conn, report, label, sql, params) {
  try {
    const [r] = await conn.query(sql, params);
    if (r && r.affectedRows) report.removed(`${r.affectedRows} ${label}`);
    return r && r.affectedRows ? r.affectedRows : 0;
  } catch (err) {
    if (isMissingTable(err)) return 0;
    throw err;
  }
}

async function retireOriginalDemo(conn, report = makeReport()) {
  const fx = legacyFixtures();
  const district = await one(conn, 'SELECT id FROM districts WHERE name = ?', [fx.districtName]);
  const school = await one(conn, 'SELECT id, district_id FROM schools WHERE domain = ?', [fx.domain]);
  const accountRows = [];
  for (const key of Object.keys(fx.accounts)) {
    const u = await one(conn, 'SELECT id, email, is_shared_demo, demo_workspace_id FROM site_users WHERE email = ?', [fx.accounts[key].email]);
    if (!u) continue;
    if (!u.is_shared_demo || (u.demo_workspace_id !== null && u.demo_workspace_id !== undefined)) {
      throw new Error(`${u.email} is not an original demo login (it is not flagged shared demo, or it belongs to a workspace). Refusing to remove it.`);
    }
    accountRows.push({ key, id: u.id, email: u.email });
  }
  if (!district && !school && !accountRows.length) {
    report.note('the original demo is already gone');
  } else {
    const ids = Object.fromEntries(accountRows.map(a => [a.key, a.id]));
    const mine = accountRows.map(a => a.id);

    if (school && district && school.district_id !== district.id) throw new Error('The original demo school is not in the original demo district. Refusing to remove it.');
    if (district) {
      const others = await many(conn, 'SELECT id FROM schools WHERE district_id = ? AND domain <> ?', [district.id, fx.domain]);
      if (others.length) throw new Error(`The district "${fx.districtName}" holds ${others.length} other school(s). Refusing to remove it.`);
    }
    const contact = await one(conn, 'SELECT id FROM newsletter_contacts WHERE email = ?', [fx.contactEmail]);
    const purchase = school && contact && await one(conn, "SELECT id FROM purchases WHERE contact_id = ? AND product_type = 'group_license' AND school_domain = ?", [contact.id, fx.domain]);
    const strayPurchase = school && await one(conn, "SELECT id FROM purchases WHERE school_domain = ? AND product_type = 'group_license' AND contact_id <> ?", [fx.domain, contact ? contact.id : 0]);
    if (strayPurchase) throw new Error(`A purchase (#${strayPurchase.id}) on ${fx.domain} does not belong to the demo's CRM contact. Refusing to remove it.`);

    // 1. Classrooms (with their students and everything they did).
    if (ids.teacher) await del(conn, report, 'classroom(s) with their students, lessons, parent links and work', 'DELETE FROM classrooms WHERE teacher_site_user_id = ?', [ids.teacher]);

    // 2. Invitations, licence seats and administrators on the demo purchase and district, and the fake accounts they made.
    const fake = [];
    if (purchase) {
      await del(conn, report, 'teacher invitation(s)', 'DELETE FROM school_invitations WHERE purchase_id = ?', [purchase.id]);
      const seats = await many(conn, 'SELECT id, registered_site_user_id FROM license_seats WHERE purchase_id = ?', [purchase.id]);
      seats.forEach(s => s.registered_site_user_id && !mine.includes(s.registered_site_user_id) && fake.push(s.registered_site_user_id));
      if (seats.length) await del(conn, report, 'licence seat(s)', `DELETE FROM license_seats WHERE id IN (${marks(seats)})`, seats.map(s => s.id));
      const admins = await many(conn, 'SELECT id, site_user_id FROM school_license_admins WHERE purchase_id = ?', [purchase.id]);
      admins.forEach(a => !mine.includes(a.site_user_id) && fake.push(a.site_user_id));
      if (admins.length) await del(conn, report, 'school administrator assignment(s)', `DELETE FROM school_license_admins WHERE id IN (${marks(admins)})`, admins.map(a => a.id));
    }
    if (district) {
      const dAdmins = await many(conn, 'SELECT id, site_user_id FROM district_license_admins WHERE district_id = ?', [district.id]);
      dAdmins.forEach(a => !mine.includes(a.site_user_id) && fake.push(a.site_user_id));
      if (dAdmins.length) await del(conn, report, 'district administrator assignment(s)', `DELETE FROM district_license_admins WHERE id IN (${marks(dAdmins)})`, dAdmins.map(a => a.id));
      await del(conn, report, 'district branding setting(s)', 'DELETE FROM district_branding WHERE district_id = ?', [district.id]);
      await del(conn, report, 'district framework(s)', 'DELETE FROM standards_frameworks WHERE district_id = ?', [district.id]);
    }
    if (school) await del(conn, report, 'school branding setting(s)', 'DELETE FROM school_branding WHERE school_id = ?', [school.id]);

    // 3. The logins' own leftovers, then the logins.
    if (mine.length) {
      for (const [label, table] of [['lesson favorite(s)', 'lesson_favorites'], ['game favorite(s)', 'game_favorites'], ['blog favorite(s)', 'blog_post_favorites'],
        ['lesson plan pick(s)', 'teacher_lesson_plans'], ['lesson plan swap record(s)', 'teacher_lesson_plan_swaps']]) {
        await del(conn, report, label, `DELETE FROM ${table} WHERE site_user_id IN (${marks(mine)})`, mine);
      }
      await del(conn, report, 'password-reset token(s)', `DELETE FROM site_user_tokens WHERE user_id IN (${marks(mine)})`, mine);
    }

    // 4. The purchase, school and district (in that order: each points at the one before).
    if (purchase) await del(conn, report, 'purchase (the original demo\'s group licence)', 'DELETE FROM purchases WHERE id = ?', [purchase.id]);
    if (school) await del(conn, report, 'school (public-demo.example.com)', 'DELETE FROM schools WHERE id = ?', [school.id]);
    if (district) await del(conn, report, 'district (FNE Demo District)', 'DELETE FROM districts WHERE id = ?', [district.id]);

    // 5. The four logins, and any fake example.com account an invitation made (only when nothing else uses it).
    if (mine.length) await del(conn, report, 'original demo login(s)', `DELETE FROM site_users WHERE id IN (${marks(mine)})`, mine);
    for (const id of [...new Set(fake)]) {
      const u = await one(conn, 'SELECT id, email, is_shared_demo, is_sales_demo FROM site_users WHERE id = ?', [id]);
      if (!u || u.is_shared_demo || u.is_sales_demo || !isExampleDomain(u.email)) continue;
      const refs = [
        ['SELECT 1 AS x FROM license_seats WHERE registered_site_user_id = ?'], ['SELECT 1 AS x FROM school_license_admins WHERE site_user_id = ?'],
        ['SELECT 1 AS x FROM district_license_admins WHERE site_user_id = ?'], ['SELECT 1 AS x FROM classrooms WHERE teacher_site_user_id = ?'],
        ['SELECT 1 AS x FROM parent_classroom_links WHERE site_user_id = ?'],
      ];
      let held = false;
      for (const [sql] of refs) { if (await one(conn, sql, [id])) { held = true; break; } }
      if (held) { report.note(`left fake account ${u.email} in place (something else still uses it)`); continue; }
      await del(conn, report, `fake account ${u.email}'s password-reset token(s)`, 'DELETE FROM site_user_tokens WHERE user_id = ?', [id]);
      await del(conn, report, `fake account (${u.email})`, 'DELETE FROM site_users WHERE id = ?', [id]);
    }
  }

  // 6. The settings, including the password and PIN that were stored in the clear.
  await del(conn, report, 'original-demo setting(s) (including the stored password and PIN)', `DELETE FROM settings WHERE setting_key IN (${marks(SETTINGS)})`, SETTINGS);
  return report;
}

async function main() {
  const mysql = require('mysql2/promise');
  const argv = process.argv.slice(2);
  const unknown = argv.filter(a => a !== '--apply');
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  const apply = argv.includes('--apply');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  try {
    console.log(`\n${apply ? 'APPLYING' : 'DRY RUN (nothing will be written)'} -- retire the original single shared demo\n`);
    await conn.beginTransaction();
    let report;
    try {
      report = await retireOriginalDemo(conn);
      if (apply) await conn.commit(); else await conn.rollback();
    } catch (err) {
      await conn.rollback();
      console.error('\nFAILED -- the transaction was rolled back, nothing was changed.');
      throw err;
    }
    report.print(apply ? '' : 'would ');
    console.log(apply ? '\nThe original demo is retired.\n' : '\nDry run complete: every statement ran against the real schema and was rolled back. Re-run with --apply to make it real.\n');
  } finally {
    await conn.end();
  }
}

if (require.main === module) main().catch(err => { console.error(err.message || err); process.exit(1); });

module.exports = { retireOriginalDemo, SETTINGS };

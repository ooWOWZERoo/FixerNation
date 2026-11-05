// The Morning Boost Recipients group (lib/morning-boost-group.js, docs/reference/morning-boost-recipient-group-requirements.md):
// who is in it, who is taken out, and that nothing happens on a dry run.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { syncMorningBoostGroup, syncMorningBoostForUser, GROUP_KEY } = require('../lib/morning-boost-group');

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, email_verified INTEGER DEFAULT 1, is_sales_demo INTEGER DEFAULT 0, created_at TEXT DEFAULT '2026-10-20 10:00:00');
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, school_domain TEXT, school_id INTEGER, payment_status TEXT, payment_method TEXT, license_status TEXT, expiration_date TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER, registered_at TEXT);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT '2026-10-20 10:00:00');
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT '2026-10-20 10:00:00');
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, source TEXT, status TEXT);
CREATE TABLE contact_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, system_key TEXT);
CREATE TABLE contact_group_members (contact_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (contact_id, group_id));
CREATE TABLE morning_boost_email_config (id INTEGER PRIMARY KEY AUTOINCREMENT, enabled INTEGER DEFAULT 0);
CREATE TABLE morning_boost_email_groups (config_id INTEGER, group_id INTEGER, PRIMARY KEY (config_id, group_id));
`);
const pool = {
  async query(sql, params = []) {
    const s = sql.trim();
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    const r = db.prepare(s).run(...params);
    return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
  },
};
const TODAY = '2026-11-05';
const ins = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
const reset = () => {
  for (const t of ['settings', 'site_users', 'purchases', 'schools', 'license_seats', 'school_license_admins', 'district_license_admins', 'newsletter_contacts', 'contact_groups', 'contact_group_members', 'morning_boost_email_config', 'morning_boost_email_groups']) db.exec(`DELETE FROM ${t}`);
  ins('INSERT INTO morning_boost_email_config (enabled) VALUES (0)');
};
const user = (email, extra = {}) => ins('INSERT INTO site_users (email, first_name, last_name, email_verified, is_sales_demo) VALUES (?, ?, ?, ?, ?)', email, 'T', email.split('@')[0], extra.verified ?? 1, extra.demo ?? 0);
const school = (o = {}) => {
  const district = o.district ?? null;
  const sid = ins('INSERT INTO schools (domain, district_id) VALUES (?, ?)', `s${Math.random()}.example.com`, district);
  return ins('INSERT INTO purchases (school_domain, school_id, payment_status, payment_method, license_status, expiration_date) VALUES (?, ?, ?, ?, ?, ?)',
    `s${sid}.example.com`, sid, o.pay ?? 'paid', o.method ?? 'card', o.status ?? 'active', o.expires ?? '2027-06-30');
};
const seat = (purchase, userId, registeredAt = '2026-10-20 09:00:00', status = 'registered') =>
  ins('INSERT INTO license_seats (purchase_id, status, registered_site_user_id, registered_at) VALUES (?, ?, ?, ?)', purchase, status, userId, registeredAt);
const members = () => db.prepare(`SELECT nc.email FROM contact_group_members m JOIN newsletter_contacts nc ON nc.id = m.contact_id JOIN contact_groups g ON g.id = m.group_id WHERE g.system_key = '${GROUP_KEY}' ORDER BY nc.email`).all().map((r) => r.email);
const sync = (o = {}) => syncMorningBoostGroup(pool, { apply: true, today: TODAY, ...o });

test('TEACHER: registered on or after the start date on an open license is added, with a CRM contact created', async () => {
  reset();
  seat(school(), user('a@school.test'));
  const r = await sync();
  assert.deepEqual(members(), ['a@school.test']);
  assert.equal(r.add, 1); assert.equal(r.contactsToCreate, 1); assert.equal(r.byRole.teacher, 1);
  const c = db.prepare("SELECT source, status FROM newsletter_contacts WHERE email = 'a@school.test'").get();
  assert.equal(c.source, 'School License'); assert.equal(c.status, 'Subscribed');
});

test('START DATE: someone registered before 15 October is not added; the date is the setting when one is set', async () => {
  reset();
  const p = school();
  seat(p, user('old@school.test'), '2026-10-14 23:59:59');
  seat(p, user('new@school.test'), '2026-10-15 00:00:00');
  await sync();
  assert.deepEqual(members(), ['new@school.test']);
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('morning_boost_group_start_date', '2026-01-01')").run();
  await sync();
  assert.deepEqual(members(), ['new@school.test', 'old@school.test']);
});

test('LICENSE OPEN: PO received counts even unpaid; PO not received, an expired status and a passed expiration date do not', async () => {
  reset();
  seat(school({ pay: 'pending', method: 'po', status: 'active' }), user('po-in@school.test'));
  seat(school({ pay: 'pending', method: 'po', status: 'pending' }), user('po-wait@school.test'));
  seat(school({ status: 'expired' }), user('expired@school.test'));
  seat(school({ expires: '2026-11-01' }), user('lapsed@school.test'));
  seat(school({ status: 'expiring_soon', expires: '2026-11-20' }), user('soon@school.test'));
  await sync();
  assert.deepEqual(members(), ['po-in@school.test', 'soon@school.test']);
});

test('SCHOOL ADMIN: needs a set-up (verified) account and an active assignment', async () => {
  reset();
  const p = school();
  const verified = user('admin@school.test');
  const waiting = user('waiting@school.test', { verified: 0 });
  const gone = user('gone@school.test');
  [verified, waiting, gone].forEach((u) => ins('INSERT INTO school_license_admins (site_user_id, purchase_id, is_active) VALUES (?, ?, ?)', u, p, u === gone ? 0 : 1));
  await sync();
  assert.deepEqual(members(), ['admin@school.test']);
  db.prepare('UPDATE site_users SET email_verified = 1 WHERE id = ?').run(waiting);
  await sync();
  assert.deepEqual(members(), ['admin@school.test', 'waiting@school.test']);
});

test('DISTRICT ADMIN: in while one school in the district has an open license, out when none does', async () => {
  reset();
  const open = school({ district: 5 });
  const da = user('district@school.test');
  ins('INSERT INTO district_license_admins (site_user_id, district_id) VALUES (?, 5)', da);
  await sync();
  assert.deepEqual(members(), ['district@school.test']);
  db.prepare("UPDATE purchases SET license_status = 'expired' WHERE id = ?").run(open);
  await sync();
  assert.deepEqual(members(), []);
});

test('TWO LICENSES: a teacher stays until both have ended; a renewal brings them back', async () => {
  reset();
  const a = school(), b = school();
  const u = user('two@school.test');
  seat(a, u); seat(b, u);
  await sync();
  db.prepare("UPDATE purchases SET license_status = 'expired' WHERE id = ?").run(a);
  await sync();
  assert.deepEqual(members(), ['two@school.test']);
  db.prepare("UPDATE purchases SET license_status = 'expired' WHERE id = ?").run(b);
  await sync();
  assert.deepEqual(members(), []);
  db.prepare("UPDATE purchases SET license_status = 'active' WHERE id = ?").run(b);
  await sync();
  assert.deepEqual(members(), ['two@school.test']);
});

test('ONE PERSON, SEVERAL ROLES: one membership, one contact', async () => {
  reset();
  const p = school({ district: 9 });
  const u = user('multi@school.test');
  seat(p, u);
  ins('INSERT INTO school_license_admins (site_user_id, purchase_id) VALUES (?, ?)', u, p);
  ins('INSERT INTO district_license_admins (site_user_id, district_id) VALUES (?, 9)', u);
  const r = await sync();
  assert.deepEqual(members(), ['multi@school.test']);
  assert.equal(r.eligible, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 1);
});

test('SALES DEMO accounts are never added', async () => {
  reset();
  seat(school(), user('demo@school.test', { demo: 1 }));
  await sync();
  assert.deepEqual(members(), []);
});

test('MANAGED GROUP: a hand-added member who does not qualify is removed; an existing contact is left as it is', async () => {
  reset();
  const u = user('real@school.test');
  seat(school(), u);
  ins("INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('Real', 'real@school.test', 'Homepage', 'Unsubscribed')");
  const stray = ins("INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('Stray', 'stray@school.test', 'Homepage', 'Subscribed')");
  await sync();
  const gid = db.prepare(`SELECT id FROM contact_groups WHERE system_key = '${GROUP_KEY}'`).get().id;
  db.prepare('INSERT INTO contact_group_members (contact_id, group_id) VALUES (?, ?)').run(stray, gid);
  const r = await sync();
  assert.equal(r.remove, 1);
  assert.deepEqual(members(), ['real@school.test']);
  const c = db.prepare("SELECT source, status FROM newsletter_contacts WHERE email = 'real@school.test'").get();
  assert.equal(c.source, 'Homepage'); assert.equal(c.status, 'Unsubscribed', 'the contact keeps its own status, so it is still never emailed');
});

test('GROUP: created when missing and switched on as a recipient group; running again changes nothing', async () => {
  reset();
  seat(school(), user('a@school.test'));
  const first = await sync();
  assert.equal(first.activated, true);
  const gid = db.prepare(`SELECT id FROM contact_groups WHERE system_key = '${GROUP_KEY}'`).get().id;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM morning_boost_email_groups WHERE group_id = ?').get(gid).n, 1);
  assert.equal(db.prepare('SELECT enabled FROM morning_boost_email_config').get().enabled, 0, 'the Morning Boost on/off switch is not touched');
  const again = await sync();
  assert.equal(again.add, 0); assert.equal(again.remove, 0); assert.equal(again.contactsToCreate, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_groups').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM morning_boost_email_groups').get().n, 1);
});

test('ANOTHER RECIPIENT GROUP already switched on is left alone', async () => {
  reset();
  const other = ins("INSERT INTO contact_groups (name, system_key) VALUES ('Teachers', 'teachers')");
  db.prepare('INSERT INTO morning_boost_email_groups (config_id, group_id) VALUES (1, ?)').run(other);
  seat(school(), user('a@school.test'));
  await sync();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM morning_boost_email_groups').get().n, 2);
});

test('DRY RUN: reports what it would do and changes nothing', async () => {
  reset();
  seat(school(), user('a@school.test'));
  const r = await syncMorningBoostGroup(pool, { apply: false, today: TODAY });
  assert.equal(r.applied, false); assert.equal(r.add, 1); assert.equal(r.contactsToCreate, 1); assert.deepEqual(r.addEmails, ['a@school.test']);
  for (const t of ['contact_groups', 'contact_group_members', 'newsletter_contacts', 'morning_boost_email_groups']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} untouched`);
  }
});

test('ONE PERSON run changes only that person', async () => {
  reset();
  const p = school();
  const a = user('a@school.test'), b = user('b@school.test');
  seat(p, a); seat(p, b);
  await syncMorningBoostForUser(pool, a);
  assert.deepEqual(members(), ['a@school.test']);
  db.prepare("UPDATE purchases SET license_status = 'expired'").run();
  await syncMorningBoostForUser(pool, b);
  assert.deepEqual(members(), ['a@school.test'], 'b was never in; a is not touched by a run for b');
  await syncMorningBoostForUser(pool, a);
  assert.deepEqual(members(), []);
});

test('NO MORNING BOOST CONFIG YET: the group is made but reported as not switched on', async () => {
  reset();
  db.exec('DELETE FROM morning_boost_email_config');
  seat(school(), user('a@school.test'));
  const r = await sync();
  assert.equal(r.activated, false);
  assert.deepEqual(members(), ['a@school.test']);
});

test('TEST ADDRESSES: example.com, its subdomains and the QA inbox domain are left out; the setting replaces the list', async () => {
  reset();
  const p = school();
  seat(p, user('qa@example.com'));
  seat(p, user('demo@maple.example.com'));
  seat(p, user('tester@fixernation.testinator.email'));
  seat(p, user('real@school.test'));
  const r = await sync();
  assert.deepEqual(members(), ['real@school.test']);
  assert.equal(r.excluded.length, 3);
  db.prepare("INSERT INTO settings (setting_key, setting_value) VALUES ('morning_boost_group_excluded_domains', 'school.test')").run();
  await sync();
  assert.deepEqual(members(), ['demo@maple.example.com', 'qa@example.com', 'tester@fixernation.testinator.email'], 'the setting replaces the default list; school.test is now left out, and the three are let in');
});

test('TEST ADDRESSES: a lookalike domain is not mistaken for a test domain', async () => {
  reset();
  seat(school(), user('a@notexample.com'));
  await sync();
  assert.deepEqual(members(), ['a@notexample.com']);
});

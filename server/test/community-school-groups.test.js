// Release 112: school Community groups are private, and who may delete groups (docs/reference/community-group-privacy-requirements.md).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');
process.env.UPLOADS_DIR = path.join(os.tmpdir(), 'fne-test-uploads');

const SERVER = path.join(__dirname, '..');
const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, first_name TEXT, last_name TEXT, is_sales_demo INTEGER DEFAULT 0, session_invalidated_at TEXT);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, name TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, license_status TEXT, expiration_date TEXT, school_domain TEXT, school_id INTEGER);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE license_seats (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER, status TEXT, registered_site_user_id INTEGER);
CREATE TABLE school_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, purchase_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE district_license_admins (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER, district_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE social_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, avatar_url TEXT, bio TEXT, bio_consent INTEGER DEFAULT 0);
CREATE TABLE social_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, type TEXT, description TEXT, school_domain TEXT, is_public INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE social_group_members (group_id INTEGER, user_id INTEGER, PRIMARY KEY (group_id, user_id));
CREATE TABLE social_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, author_id INTEGER, content TEXT, deleted_at TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER, purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT);
`);
const run = async (sql, rawParams = []) => {
  let i = 0;
  const params = [];
  const s = sql.trim().replace(/CURDATE\(\)/g, 'CURRENT_DATE').replace(/INSERT IGNORE INTO/gi, 'INSERT OR IGNORE INTO').replace(/\?/g, () => {
    const p = rawParams[i++];
    if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
    params.push(p);
    return '?';
  });
  if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
  const r = db.prepare(s).run(...params);
  return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
};
const noop = new Proxy({}, { get: () => async () => ({}) });
const stubs = {
  [path.join(SERVER, 'db/pool.js')]: { query: run },
  [path.join(SERVER, 'middleware/auth.js')]: { requireAuth: (req, res, next) => next(), getAuthUser: () => null },
  // sign in as a district admin by sending their district ids; no header = not a district admin
  [path.join(SERVER, 'middleware/districtAdminAuth.js')]: { requireDistrictAdmin: (req, res, next) => {
    const ids = String(req.headers['x-district-ids'] || '').split(',').filter(Boolean).map(Number);
    if (!ids.length) return res.status(403).json({ error: 'Access denied' });
    req.districtAdmin = { siteUserId: 900, email: 'da@school.test', districtIds: ids, districts: [] };
    next();
  } },
  [path.join(SERVER, 'lib/session-tokens.js')]: { verifySession: (kind, token) => ({ userId: Number(token), iat: Math.floor(Date.now() / 1000) }) },
  [path.join(SERVER, 'lib/safety/gateway.js')]: { screenContent: async () => ({ decision: 'allow' }), isPublishable: () => true },
  [path.join(SERVER, 'lib/safety/school-context.js')]: { resolveSchoolDomainForSocialGroup: async () => null, resolveSchoolDomainForTeacher: async () => null },
  [path.join(SERVER, 'lib/branding-editor.js')]: { logoUpload: () => (req, res, next) => next() },
  [path.join(SERVER, 'lib/school-admin-assignment.js')]: noop,
  [path.join(SERVER, 'lib/district-dashboard.js')]: { loadDashboard: async () => ({}) },
  [path.join(SERVER, 'lib/mailer.js')]: noop,
  [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1' },
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
  return origLoad.apply(this, arguments);
};

const express = require('express');
const cookieParser = require('cookie-parser');
const { ensureGroup } = require(path.join(SERVER, 'lib/social-groups.js'));
const { findStrangersInSchoolGroups, removeStrangersFromSchoolGroups } = require(path.join(SERVER, 'lib/community-groups.js'));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/social', require(path.join(SERVER, 'routes/social.js')));
app.use('/api/district-admin', require(path.join(SERVER, 'routes/district-admin.js')));
app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
let server, port;
test.before(async () => { server = app.listen(0); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { as = null, district = null, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (as) headers.Cookie = `fn_user_session=${as}`;
    if (district) headers['x-district-ids'] = String(district);
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (d) => b += d); res.on('end', () => resolve({ status: res.statusCode, json: b ? JSON.parse(b) : {} }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const FUTURE = '2999-01-01';
let n = 0;
const reset = () => { for (const t of ['site_users', 'newsletter_contacts', 'purchases', 'schools', 'license_seats', 'school_license_admins', 'district_license_admins', 'social_profiles', 'social_groups', 'social_group_members', 'social_posts', 'school_audit_log']) db.exec(`DELETE FROM ${t}`); };
// a school (domain, in a district) with a working license, and a private school group
function school(domain, districtId) {
  db.prepare('INSERT INTO schools (domain, district_id, display_name) VALUES (?, ?, ?)').run(domain, districtId, domain.toUpperCase());
  const pid = Number(db.prepare("INSERT INTO purchases (license_status, expiration_date, school_domain) VALUES ('active', ?, ?)").run(FUTURE, domain).lastInsertRowid);
  return { domain, pid };
}
async function schoolGroup(domain) { return ensureGroup('school', domain, domain); }
// a teacher with a seat at a school
function teacher(name, sc) {
  n += 1;
  const email = `${name.toLowerCase()}${n}@school.test`;
  const uid = Number(db.prepare('INSERT INTO site_users (email, first_name, last_name) VALUES (?, ?, ?)').run(email, name, 'T').lastInsertRowid);
  db.prepare('INSERT INTO newsletter_contacts (email, name) VALUES (?, ?)').run(email, name);
  db.prepare("INSERT INTO license_seats (purchase_id, status, registered_site_user_id) VALUES (?, 'registered', ?)").run(sc.pid, uid);
  db.prepare('INSERT INTO social_profiles (user_id) VALUES (?)').run(uid);
  return uid;
}
const join = (gid, uid) => db.prepare('INSERT OR IGNORE INTO social_group_members (group_id, user_id) VALUES (?, ?)').run(gid, uid);
const names = (r) => r.json.groups.map((g) => g.name).sort();

test('NEW SCHOOL GROUPS are created private', async () => {
  reset();
  const gid = await schoolGroup('a.test');
  assert.equal(db.prepare('SELECT is_public FROM social_groups WHERE id = ?').get(gid).is_public, 0);
});

test('BROWSE: a school group is listed only to people of that school; public custom groups are still listed to everyone', async () => {
  reset();
  const a = school('a.test', 1), b = school('b.test', 2);
  await schoolGroup('a.test'); await schoolGroup('b.test');
  db.prepare("INSERT INTO social_groups (name, type, is_public) VALUES ('Open Group', 'custom', 1)").run();
  const ta = teacher('Ann', a), tb = teacher('Bob', b);
  assert.deepEqual(names(await call('GET', '/api/social/groups/browse', { as: ta })), ['Open Group', 'a.test']);
  assert.deepEqual(names(await call('GET', '/api/social/groups/browse', { as: tb })), ['Open Group', 'b.test']);
});

test('BROWSE: a school group made public by mistake is still hidden from other schools', async () => {
  reset();
  const a = school('a.test', 1), b = school('b.test', 2);
  await schoolGroup('a.test');
  db.prepare("UPDATE social_groups SET is_public = 1 WHERE school_domain = 'a.test'").run();
  assert.deepEqual(names(await call('GET', '/api/social/groups/browse', { as: teacher('Bob', b) })), []);
  assert.deepEqual(names(await call('GET', '/api/social/groups/browse', { as: teacher('Ann', a) })), ['a.test']);
});

test('JOIN: someone from another school gets 404; someone from that school can (rejoin after leaving)', async () => {
  reset();
  const a = school('a.test', 1), b = school('b.test', 2);
  const gid = await schoolGroup('a.test');
  const ta = teacher('Ann', a), tb = teacher('Bob', b);
  assert.equal((await call('POST', `/api/social/groups/${gid}/join`, { as: tb, body: {} })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_group_members WHERE user_id = ?').get(tb).n, 0);
  assert.equal((await call('POST', `/api/social/groups/${gid}/join`, { as: ta, body: {} })).status, 200);
  await call('DELETE', `/api/social/groups/${gid}/leave`, { as: ta });
  assert.equal((await call('POST', `/api/social/groups/${gid}/join`, { as: ta, body: {} })).status, 200);
});

test('JOIN: a district administrator can join any school group in their district, not another district\'s', async () => {
  reset();
  const a = school('a.test', 1), b = school('b.test', 2);
  const ga = await schoolGroup('a.test'), gb = await schoolGroup('b.test');
  n += 1;
  const uid = Number(db.prepare('INSERT INTO site_users (email, first_name, last_name) VALUES (?, ?, ?)').run(`da${n}@school.test`, 'Dee', 'Admin').lastInsertRowid);
  db.prepare('INSERT INTO newsletter_contacts (email, name) VALUES (?, ?)').run(`da${n}@school.test`, 'Dee');
  db.prepare('INSERT INTO district_license_admins (site_user_id, district_id) VALUES (?, 1)').run(uid);
  assert.equal((await call('POST', `/api/social/groups/${ga}/join`, { as: uid, body: {} })).status, 200);
  assert.equal((await call('POST', `/api/social/groups/${gb}/join`, { as: uid, body: {} })).status, 404);
});

test('MY GROUPS shows a private school group the person is in', async () => {
  reset();
  const a = school('a.test', 1);
  const gid = await schoolGroup('a.test');
  const ta = teacher('Ann', a);
  join(gid, ta);
  assert.deepEqual(names(await call('GET', '/api/social/groups', { as: ta })), ['a.test']);
});

test('STAFF EDIT cannot make a school group public or All Teachers private; a custom group still can be changed', async () => {
  reset();
  const gid = await schoolGroup('a.test');
  const all = await ensureGroup('all_teachers', 'All Teachers', null);
  const custom = Number(db.prepare("INSERT INTO social_groups (name, type, is_public) VALUES ('Custom', 'custom', 1)").run().lastInsertRowid);
  await call('PUT', `/api/social/groups/${gid}`, { body: { name: 'A school', isPublic: true } });
  await call('PUT', `/api/social/groups/${all}`, { body: { name: 'All Teachers', isPublic: false } });
  await call('PUT', `/api/social/groups/${custom}`, { body: { name: 'Custom', isPublic: false } });
  const vis = (id) => db.prepare('SELECT is_public FROM social_groups WHERE id = ?').get(id).is_public;
  assert.equal(vis(gid), 0); assert.equal(vis(all), 1); assert.equal(vis(custom), 0);
  assert.equal(db.prepare('SELECT name FROM social_groups WHERE id = ?').get(gid).name, 'A school', 'names can still be edited');
});

test('DISTRICT ADMIN lists only the school groups of their own district', async () => {
  reset();
  school('a.test', 1); school('b.test', 2);
  await schoolGroup('a.test'); await schoolGroup('b.test');
  await ensureGroup('all_teachers', 'All Teachers', null);
  db.prepare("INSERT INTO social_groups (name, type) VALUES ('Custom', 'custom')").run();
  const r = await call('GET', '/api/district-admin/community-groups', { district: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.groups.map((g) => g.schoolDomain), ['a.test']);
  assert.equal(r.json.groups[0].schoolName, 'A.TEST');
});

test('DISTRICT ADMIN can delete their own district\'s school group (audited); another district\'s, All Teachers and custom groups are 404; a non-admin is refused', async () => {
  reset();
  school('a.test', 1); school('b.test', 2);
  const ga = await schoolGroup('a.test'), gb = await schoolGroup('b.test');
  const all = await ensureGroup('all_teachers', 'All Teachers', null);
  const custom = Number(db.prepare("INSERT INTO social_groups (name, type) VALUES ('Custom', 'custom')").run().lastInsertRowid);
  const exists = (id) => db.prepare('SELECT COUNT(*) AS n FROM social_groups WHERE id = ?').get(id).n === 1;
  assert.equal((await call('DELETE', `/api/district-admin/community-groups/${ga}`)).status, 403, 'not a district admin');
  assert.equal((await call('DELETE', `/api/district-admin/community-groups/${gb}`, { district: 1 })).status, 404);
  assert.equal((await call('DELETE', `/api/district-admin/community-groups/${all}`, { district: 1 })).status, 404);
  assert.equal((await call('DELETE', `/api/district-admin/community-groups/${custom}`, { district: 1 })).status, 404);
  assert.ok(exists(gb) && exists(all) && exists(custom) && exists(ga));
  assert.equal((await call('DELETE', `/api/district-admin/community-groups/${ga}`, { district: 1 })).status, 200);
  assert.equal(exists(ga), false);
  const log = db.prepare("SELECT action, school_domain FROM school_audit_log WHERE entity_id = ?").get(ga);
  assert.equal(log.action, 'community_group_deleted'); assert.equal(log.school_domain, 'a.test');
});

test('CLEANUP finds only the people in a school group who do not belong to it, and removes only them', async () => {
  reset();
  const a = school('a.test', 1), b = school('b.test', 2);
  const ga = await schoolGroup('a.test');
  const ann = teacher('Ann', a), bob = teacher('Bob', b);
  join(ga, ann); join(ga, bob);
  const found = await findStrangersInSchoolGroups({ query: run });
  assert.deepEqual(found.map((f) => f.userId), [bob]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM social_group_members').get().n, 2, 'a dry run changes nothing');
  assert.equal(await removeStrangersFromSchoolGroups({ query: run }), 1);
  assert.deepEqual(db.prepare('SELECT user_id FROM social_group_members').all().map((r) => r.user_id), [ann]);
});

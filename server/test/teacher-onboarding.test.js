// lib/teacher-onboarding.js: an invited teacher's grade levels are added to their own, and they land in the CRM and the
// Teachers group exactly once, whichever acceptance path calls it. Real SQL on node:sqlite.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { onboardInvitedTeacher, mergeAudiences, ensureContact } = require('../lib/teacher-onboarding');

const db = new DatabaseSync(':memory:');
db.exec(`
CREATE TABLE site_user_audiences (id INTEGER PRIMARY KEY AUTOINCREMENT, site_user_id INTEGER NOT NULL, audience TEXT NOT NULL, UNIQUE (site_user_id, audience));
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, source TEXT, status TEXT);
CREATE TABLE contact_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, system_key TEXT);
CREATE TABLE contact_group_members (contact_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (contact_id, group_id));
`);
const pool = {
  query: async (sql, params = []) => {
    const s = sql.trim();
    if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
    try {
      const r = db.prepare(s).run(...params);
      return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw Object.assign(new Error(e.message), { code: 'ER_DUP_ENTRY' });
      throw e;
    }
  },
};
const levelsOf = (id) => db.prepare('SELECT audience FROM site_user_audiences WHERE site_user_id = ? ORDER BY audience').all(id).map((r) => r.audience);
const reset = () => {
  db.exec('DELETE FROM site_user_audiences; DELETE FROM newsletter_contacts; DELETE FROM contact_groups; DELETE FROM contact_group_members;');
  db.exec("INSERT INTO contact_groups (id, name, system_key) VALUES (1, 'Teachers', 'teachers'), (2, 'Consumers', 'consumer')");
};

test('a new teacher gets the invite levels, a CRM contact and the Teachers group', async () => {
  reset();
  const r = await onboardInvitedTeacher({ db: pool, siteUserId: 7, email: 'New@School.edu', name: 'Nia New', audiences: 'Elementary School,Middle School' });
  assert.deepEqual(levelsOf(7), ['Elementary School', 'Middle School']);
  const c = db.prepare('SELECT * FROM newsletter_contacts').all();
  assert.equal(c.length, 1);
  assert.equal(c[0].email, 'new@school.edu');
  assert.equal(c[0].status, 'Subscribed');
  assert.equal(c[0].source, 'School Invite');
  assert.equal(r.grouped, true);
  assert.deepEqual(db.prepare('SELECT group_id FROM contact_group_members WHERE contact_id = ?').all(c[0].id).map((x) => x.group_id), [1]);
});

test('the invite levels are added to a teacher\'s existing levels, never replacing them', async () => {
  reset();
  db.exec("INSERT INTO site_user_audiences (site_user_id, audience) VALUES (7, 'High School'), (7, 'Middle School')");
  const r = await onboardInvitedTeacher({ db: pool, siteUserId: 7, email: 'a@school.edu', name: 'A', audiences: 'Middle School,Elementary School' });
  assert.deepEqual(levelsOf(7), ['Elementary School', 'High School', 'Middle School']);
  assert.deepEqual(r.addedLevels, ['Elementary School']);
});

test('running it twice changes nothing the second time', async () => {
  reset();
  const args = { db: pool, siteUserId: 9, email: 'b@school.edu', name: 'B', audiences: ['Higher Education'] };
  await onboardInvitedTeacher(args);
  const again = await onboardInvitedTeacher(args);
  assert.deepEqual(again.addedLevels, []);
  assert.equal(again.grouped, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM contact_group_members').get().n, 1);
  assert.deepEqual(levelsOf(9), ['Higher Education']);
});

test('an existing CRM contact keeps its status and source', async () => {
  reset();
  db.exec("INSERT INTO newsletter_contacts (name, email, source, status) VALUES ('Old Name', 'c@school.edu', 'Homepage', 'Unsubscribed')");
  await onboardInvitedTeacher({ db: pool, siteUserId: 3, email: 'c@school.edu', name: 'New Name', audiences: ['High School'] });
  const c = db.prepare("SELECT * FROM newsletter_contacts WHERE email = 'c@school.edu'").get();
  assert.equal(c.name, 'Old Name');
  assert.equal(c.status, 'Unsubscribed');
  assert.equal(c.source, 'Homepage');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 1);
});

test('an invite with no levels (an older invitation) still onboards, and unknown text adds nothing', async () => {
  reset();
  await onboardInvitedTeacher({ db: pool, siteUserId: 4, email: 'd@school.edu', name: 'D', audiences: null });
  await onboardInvitedTeacher({ db: pool, siteUserId: 5, email: 'e@school.edu', name: 'E', audiences: '5th grade' });
  assert.deepEqual(levelsOf(4), []);
  assert.deepEqual(levelsOf(5), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM newsletter_contacts').get().n, 2);
});

test('a database without the Teachers group does not break onboarding', async () => {
  reset();
  db.exec('DELETE FROM contact_groups');
  const r = await onboardInvitedTeacher({ db: pool, siteUserId: 6, email: 'f@school.edu', name: 'F', audiences: ['Middle School'] });
  assert.equal(r.grouped, false);
  assert.deepEqual(levelsOf(6), ['Middle School']);
});

test('helpers on their own: mergeAudiences ignores duplicates in its input; ensureContact is idempotent', async () => {
  reset();
  assert.deepEqual(await mergeAudiences(pool, 1, ['High School', 'High School']), ['High School']);
  const a = await ensureContact(pool, { email: 'g@x.edu', name: 'G' });
  const b = await ensureContact(pool, { email: 'g@x.edu', name: 'G' });
  assert.equal(a, b);
});

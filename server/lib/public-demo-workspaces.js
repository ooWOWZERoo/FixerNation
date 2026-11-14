// What one prospect-demo WORKSPACE is made of (docs/reference/shared-demo-workspaces-requirements.md, R4). Constants and pure functions only, no
// database or settings access, so the seed and reset scripts and the tests can all use it without opening a second connection pool.
//
// A "fixture set" describes one private copy of the demo: its district, school, classroom, students and logins. The seed and reset scripts take a
// fixture set, so they build workspace 07 and the original single shared demo with the same code:
//
//   workspaceFixtures(7)  -> "FNE Demo District 07", school w07.public-demo.example.com, demo-teacher-07@public-demo.example.com, student demo-student-07
//   legacyFixtures()      -> the original single demo ("FNE Demo District", public-demo.example.com, demo-teacher@public-demo.example.com, demo-student)
//
// The legacy set is kept only so scripts/retire-original-demo.js knows which rows to remove (phase 5); nothing seeds or serves it any more.

const F = require('./public-demo-fixtures');
const { workspaceDistrictName, workspaceSchoolDomain, workspaceTag, validWorkspaceNumber, MAX_DEMO_WORKSPACES } = require('./sales-demo');

const ROLE_KEYS = ['district', 'school', 'teacher', 'parent'];
const ROLE_NAMES = {
  district: { first: 'Demo', last: 'District Admin', role: 'district_admin' },
  school: { first: 'Demo', last: 'School Admin', role: 'school_license_admin' },
  teacher: { first: 'Demo', last: 'Teacher', role: 'teacher' },
  parent: { first: 'Demo', last: 'Parent', role: 'parent' },
};

// The original single demo (retired in phase 5), in the same shape as a workspace: the names scripts/retire-original-demo.js looks for.
function legacyFixtures() {
  return {
    number: null, label: 'the shared demo',
    districtName: F.PUBLIC_DEMO_DISTRICT_NAME, domain: F.DEMO_DOMAIN, schoolName: F.DEMO_SCHOOL_NAME,
    productName: F.DEMO_PRODUCT_NAME, contactEmail: F.DEMO_CONTACT_EMAIL, contactName: 'FNE Public Demo', source: F.DEMO_SOURCE,
    classroomName: F.DEMO_CLASSROOM_NAME, lessonCount: F.DEMO_LESSON_COUNT,
    accounts: F.ACCOUNTS, students: F.STUDENTS,
  };
}

// Workspace n (1..99). Every name carries the two-digit number, so the district, school, logins and students of one workspace can never be
// mistaken for another's. The $0 licence product and the CRM contact are shared by every workspace (a purchase differs by school domain).
function workspaceFixtures(n) {
  if (!validWorkspaceNumber(n)) throw new Error(`Demo workspace number must be a whole number from 1 to 99 (got ${n}).`);
  const tag = workspaceTag(n);
  const accounts = {};
  for (const key of ROLE_KEYS) accounts[key] = { email: `demo-${key}-${tag}@${F.DEMO_DOMAIN}`, ...ROLE_NAMES[key] };
  return {
    number: n, label: `demo workspace ${tag}`,
    districtName: workspaceDistrictName(n), domain: workspaceSchoolDomain(n), schoolName: `${F.DEMO_SCHOOL_NAME} ${tag}`,
    productName: F.DEMO_PRODUCT_NAME, contactEmail: F.DEMO_CONTACT_EMAIL, contactName: 'FNE Public Demo', source: F.DEMO_SOURCE,
    classroomName: F.DEMO_CLASSROOM_NAME, lessonCount: F.DEMO_LESSON_COUNT,
    accounts,
    students: [
      { username: `demo-student-${tag}`, name: 'Demo Student A', shared: true },
      { username: `demo-student-${tag}-b`, name: 'Demo Student B', shared: false },
      { username: `demo-student-${tag}-c`, name: 'Demo Student C', shared: false },
    ],
  };
}

// The logins of a workspace as the demo page and the admin page will show them: the user id each role types, and where it signs in.
function workspaceLogins(n) {
  const fx = workspaceFixtures(n);
  return [
    ...ROLE_KEYS.map((key) => ({ role: key, userId: fx.accounts[key].email, page: F.LOGIN_PAGES[key] })),
    { role: 'student', userId: fx.students[0].username, page: F.LOGIN_PAGES.student },
  ];
}

// Is this email or username one of a workspace's logins? Returns { number, role } or null (also null for the original single demo's logins).
const WORKSPACE_EMAIL_RE = new RegExp(`^demo-(${ROLE_KEYS.join('|')})-(\\d{2})@${F.DEMO_DOMAIN.replace(/\./g, '\\.')}$`);
const WORKSPACE_STUDENT_RE = /^demo-student-(\d{2})$/;
function workspaceLoginOf(identifier) {
  const v = String(identifier || '').trim().toLowerCase();
  let m = WORKSPACE_EMAIL_RE.exec(v);
  if (m && validWorkspaceNumber(Number(m[2]))) return { number: Number(m[2]), role: m[1] };
  m = WORKSPACE_STUDENT_RE.exec(v);
  if (m && validWorkspaceNumber(Number(m[1]))) return { number: Number(m[1]), role: 'student' };
  return null;
}

module.exports = { ROLE_KEYS, MAX_DEMO_WORKSPACES, legacyFixtures, workspaceFixtures, workspaceLogins, workspaceLoginOf };

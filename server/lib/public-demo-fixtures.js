// What the shared demo environment is made of (docs/reference/shared-demo-environment-requirements.md, R4). Constants only, with no database or
// settings access, so the seed, reset and switch scripts and the tests can all use it without opening a second connection pool.

const { PUBLIC_DEMO_DISTRICT_NAME, PUBLIC_DEMO_SCHOOL_DOMAIN, DEMO_SOURCE } = require('./sales-demo');

const DEMO_DOMAIN = PUBLIC_DEMO_SCHOOL_DOMAIN; // public-demo.example.com: under example.com, which can never receive mail

const DEMO_SCHOOL_NAME = 'FNE Demo School';
const DEMO_PRODUCT_NAME = '[Public Demo] Demo License';
const DEMO_CONTACT_EMAIL = 'public-demo@example.com'; // Unsubscribed, so no campaign or Morning Boost send ever targets it
const DEMO_CLASSROOM_NAME = 'Demo Classroom';
const DEMO_LESSON_COUNT = 3;

// One login per role, all sharing one published password. `role` is the same value the real assignment flow would give the account.
const ACCOUNTS = {
  district: { email: `demo-district@${DEMO_DOMAIN}`, first: 'Demo', last: 'District Admin', role: 'district_admin' },
  school: { email: `demo-school@${DEMO_DOMAIN}`, first: 'Demo', last: 'School Admin', role: 'school_license_admin' },
  teacher: { email: `demo-teacher@${DEMO_DOMAIN}`, first: 'Demo', last: 'Teacher', role: 'teacher' },
  parent: { email: `demo-parent@${DEMO_DOMAIN}`, first: 'Demo', last: 'Parent', role: 'parent' },
};

// The classroom's students. Only the first can be signed in to (shared PIN); the others fill the roster and have a random PIN nobody is told.
const STUDENTS = [
  { username: 'demo-student', name: 'Demo Student A', shared: true },
  { username: 'demo-student-2', name: 'Demo Student B', shared: false },
  { username: 'demo-student-3', name: 'Demo Student C', shared: false },
];

// The unlisted page a prospect opens (phase 4). The file is committed to a public repository, so its name is not a secret: the access code and the
// switch are the protection. PAGE_READY says the page is published (phase 4); the admin page keeps "Copy message for the district" off while it is false.
const PUBLIC_DEMO_PAGE_PATH = '/demo-welcome.html';
const PUBLIC_DEMO_PAGE_READY = true;

// Where each login signs in, for the admin page and the demo page.
const LOGIN_PAGES = {
  district: 'district-admin-login.html',
  school: 'school-admin-login.html',
  teacher: 'teacher-classrooms.html',
  parent: 'parent-portal.html',
  student: 'student-login.html',
};

module.exports = {
  PUBLIC_DEMO_PAGE_PATH, PUBLIC_DEMO_PAGE_READY, LOGIN_PAGES,
  PUBLIC_DEMO_DISTRICT_NAME, PUBLIC_DEMO_SCHOOL_DOMAIN, DEMO_SOURCE, DEMO_DOMAIN,
  DEMO_SCHOOL_NAME, DEMO_PRODUCT_NAME, DEMO_CONTACT_EMAIL, DEMO_CLASSROOM_NAME, DEMO_LESSON_COUNT, ACCOUNTS, STUDENTS,
};

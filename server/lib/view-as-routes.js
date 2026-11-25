// What a staff "view as" session may read (docs/reference/help-support-tools-requirements.md, section C).
//
// CLOSED BY DEFAULT: a view-as request may call only the GET routes written here, and every other route answers 403. A route added to the site
// later is therefore unreachable in a view until someone reads it and adds it here on purpose. Student rosters, student progress, reflections, quiz
// answers, goals, Brain Games results, parent links, student PINs, exports, downloads, file and video streams and anything that writes are never listed.
//
// Before adding a line, read the handler and check three things:
//   1. it answers with nothing a student wrote or that names a student (counts and classroom names are fine);
//   2. it does not write, even as housekeeping (server/test/view-as.test.js scans every handler listed here for INSERT, UPDATE and DELETE);
//   3. it needs no cookie other than the person's own (a view supplies the person's identity and removes the staff member's).
//
// Paths are relative to /api. `:x` stands for one path piece. The test file also fails if a pattern here matches a student-data word.

const ALLOWED_GET = [
  // who the person is and what they hold
  '/site-auth/me',
  '/site-auth/me/audiences',
  '/site-auth/profile',
  '/site-auth/my-purchases',
  '/support/context',
  '/support/mine',
  // the lesson library and the teacher's plans (the detail route /curricula/:id records usage against a license, so it is NOT listed)
  '/curricula',
  '/teacher/lesson-plans',
  '/teacher/lesson-plans/browse',
  // classrooms as names and counts, and which lessons are assigned (never /classrooms/:id, its students, progress or parent invitations)
  '/classrooms',
  '/classrooms/branding',
  '/classrooms/:id/assignments',
  // school administrator screens (not /invitations, which expires old rows as it reads, and not exports or the email checker)
  '/school-admin/me',
  '/school-admin/dashboard',
  '/school-admin/org',
  '/school-admin/teachers',
  '/school-admin/licenses',
  '/school-admin/reports',
  '/school-admin/audit',
  '/school-admin/classrooms',
  '/school-admin/branding',
  '/school-admin/branding/resolved',
  '/school-admin/safety-alert-recipients',
  // district administrator screens
  '/district-admin/me',
  '/district-admin/dashboard',
  '/district-admin/schools',
  '/district-admin/branding',
  '/district-admin/standards',
  '/district-admin/standards/targets',
  '/district-admin/repeat',
  // school and district program-use and evidence reports (school-level counts; small groups are merged by the report itself)
  '/program-report/school',
  '/program-report/district',
  '/graduate-evidence/school',
  '/graduate-evidence/district',
  // the same for everyone, signed in or not
  '/standards/overview',
  '/standards/states/:code',
  '/standards/districts/:id',
  '/license-products',
  '/license-products/:id',
  '/help-center',
  '/settings/site-logo',
  '/settings/favicon',
  // the view's own banner (handled before the list is checked; listed so the test sees the whole surface)
  '/view-as/status',
];

// The one write a view may make: ending itself.
const ALLOWED_WRITE = [{ method: 'POST', path: '/view-as/end' }];

function toRegExp(pattern) {
  return new RegExp('^' + pattern.split('/').map(seg => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '/?$');
}
const COMPILED = ALLOWED_GET.map(toRegExp);

function isAllowed(method, path) {
  if (ALLOWED_WRITE.some(w => w.method === method && w.path === path)) return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return COMPILED.some(re => re.test(path));
}

// Defence in depth: whatever a listed route returns, these keys are removed from the JSON before a view receives it. They are the fields that name a
// student, hold something a student wrote, or are a credential someone could use to join a class or sign in.
const SCRUB_KEYS = new Set([
  'join_code', 'joinCode', 'parent_code', 'parentCode',
  'pin', 'pin_hash', 'pinHash', 'password_hash', 'passwordHash', 'token', 'accept_token', 'reset_token', 'verification_token',
  'students', 'student', 'student_number', 'studentNumber', 'display_name', 'displayName',
  'reflections', 'reflection', 'answers', 'quiz_answers', 'goals',
]);

function scrub(value, depth = 0) {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SCRUB_KEYS.has(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

module.exports = { ALLOWED_GET, ALLOWED_WRITE, SCRUB_KEYS, isAllowed, scrub, toRegExp };

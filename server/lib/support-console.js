// Support console (Release 121): what staff see and do from Account Lookup beyond the account itself. Requirements and access
// matrix: docs/reference/support-console-requirements.md. Routes: routes/admin-support-console.js.
//
// Student names appear here (classroom lookup, parent view). Staff are allowed that (the privacy page says "authorized FNE staff"),
// every lookup is written to the audit log, and the admin page hides the names after the idle time set in Settings.
const { lockStatus } = require('./pin-lockout');

const TIMELINE_LIMIT = 100;
const stamp = (v) => (v ? String(v) : '');

// Everything we know about one person, newest first, as plain sentences (the page escapes them). No student names in here.
async function buildTimeline(pool, email) {
  const [[account]] = await pool.query(
    'SELECT id, first_name, last_name, email, role, email_verified, created_at, closed_at, closed_reason FROM site_users WHERE email = ?', [email]);
  const events = [];
  const add = (at, text) => { if (at) events.push({ at: stamp(at), text }); };

  if (account) {
    add(account.created_at, 'Account created');
    if (account.closed_at) add(account.closed_at, `Account closed (${account.closed_reason || 'no reason recorded'})`);
  }
  const [invitations] = await pool.query(
    `SELECT si.created_at, si.status, p.school_domain FROM school_invitations si JOIN purchases p ON p.id = si.purchase_id WHERE si.invited_email = ?`, [email]);
  for (const i of invitations) add(i.created_at, `Invited to ${i.school_domain || 'a school'} (${i.status})`);

  if (account) {
    const [seats] = await pool.query(
      `SELECT ls.registered_at, p.school_domain FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id
       WHERE ls.registered_site_user_id = ? AND ls.registered_at IS NOT NULL`, [account.id]);
    for (const s of seats) add(s.registered_at, `Claimed a license seat at ${s.school_domain || 'a school'}`);
    const [sla] = await pool.query(
      `SELECT a.created_at, a.is_active, p.school_domain FROM school_license_admins a JOIN purchases p ON p.id = a.purchase_id WHERE a.site_user_id = ?`, [account.id]);
    for (const a of sla) add(a.created_at, `Made school license administrator for ${a.school_domain || 'a school'}${a.is_active ? '' : ' (no longer active)'}`);
    const [dla] = await pool.query(
      `SELECT a.created_at, a.is_active, d.name FROM district_license_admins a JOIN districts d ON d.id = a.district_id WHERE a.site_user_id = ?`, [account.id]);
    for (const a of dla) add(a.created_at, `Made district administrator for ${a.name}${a.is_active ? '' : ' (no longer active)'}`);
  }
  const [requests] = await pool.query(
    'SELECT ref, status, created_at FROM support_requests WHERE requester_email = ? OR site_user_id = ?', [email, account ? account.id : 0]);
  // Reference and status only: the subject is typed by a person and could contain a student's name.
  for (const r of requests) add(r.created_at, `Support request ${r.ref} (${r.status})`);

  const [logs] = await pool.query(
    `SELECT action, reason, created_at FROM school_audit_log
     WHERE actor_email = ? OR (entity_type = 'site_user' AND entity_id = ?)`, [email, account ? account.id : 0]);
  for (const l of logs) add(l.created_at, `${String(l.action).replace(/_/g, ' ')}${l.reason ? ` (${l.reason})` : ''}`);

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { account: account || null, events: events.slice(0, TIMELINE_LIMIT) };
}

// Classrooms for a teacher email, a classroom join code, or a student username (whichever the search looks like).
async function findClassrooms(pool, query) {
  const q = String(query || '').trim();
  let rows = [];
  const base = `SELECT c.id, c.name, c.archived_at, u.first_name AS t_first, u.last_name AS t_last, u.email AS t_email
                FROM classrooms c JOIN site_users u ON u.id = c.teacher_site_user_id`;
  if (q.includes('@')) {
    [rows] = await pool.query(`${base} WHERE u.email = ? ORDER BY c.name LIMIT 30`, [q.toLowerCase()]);
  } else if (/^[A-Za-z0-9]{8}$/.test(q)) {
    [rows] = await pool.query(`${base} WHERE c.join_code = ? LIMIT 1`, [q.toUpperCase()]);
  }
  if (!rows.length && q) {
    [rows] = await pool.query(`${base} WHERE c.id IN (SELECT classroom_id FROM classroom_students WHERE username = ?) LIMIT 1`, [q.toLowerCase()]);
  }
  const out = [];
  for (const c of rows) {
    const [students] = await pool.query(
      'SELECT id, display_name, username, is_active FROM classroom_students WHERE classroom_id = ? ORDER BY display_name LIMIT 300', [c.id]);
    out.push({
      id: c.id, name: c.name, archived: !!c.archived_at,
      teacher: { name: `${c.t_first} ${c.t_last}`.trim(), email: c.t_email },
      students: students.map(s => {
        const st = lockStatus(s.username);
        return { id: s.id, displayName: s.display_name, username: s.username, active: !!s.is_active, locked: st.locked, lockedMinutes: st.minutes };
      }),
    });
  }
  return out;
}

// A parent's account, the children linked to it, and the invitations sent to their email.
async function parentView(pool, email) {
  const [[account]] = await pool.query('SELECT id, first_name, last_name, email, email_verified, closed_at FROM site_users WHERE email = ?', [email]);
  let children = [];
  if (account) {
    [children] = await pool.query(
      `SELECT pcl.id, c.name AS class_name, cs.display_name, u.first_name AS t_first, u.last_name AS t_last
       FROM parent_classroom_links pcl
       JOIN classrooms c ON c.id = pcl.classroom_id
       JOIN site_users u ON u.id = c.teacher_site_user_id
       LEFT JOIN classroom_students cs ON cs.id = pcl.student_id
       WHERE pcl.site_user_id = ? ORDER BY c.name, cs.display_name`, [account.id]);
  }
  const [invitations] = await pool.query(
    `SELECT psi.id, psi.status, psi.expires_at, psi.created_at, cs.display_name, c.name AS class_name
     FROM parent_student_invitations psi
     JOIN classroom_students cs ON cs.id = psi.student_id
     JOIN classrooms c ON c.id = psi.classroom_id
     WHERE psi.invited_email = ? ORDER BY psi.created_at DESC LIMIT 50`, [email]);
  const now = Date.now();
  return {
    account: account ? { id: account.id, name: `${account.first_name} ${account.last_name}`.trim(), email: account.email, verified: !!account.email_verified, closed: !!account.closed_at } : null,
    children: children.map(c => ({ id: c.id, student: c.display_name || '(whole class)', className: c.class_name, teacher: `${c.t_first} ${c.t_last}`.trim() })),
    invitations: invitations.map(i => ({
      id: i.id, student: i.display_name, className: i.class_name, status: i.status, expiresAt: i.expires_at, createdAt: i.created_at,
      expired: i.status === 'pending' && new Date(String(i.expires_at).replace(' ', 'T')).getTime() < now,
    })),
  };
}

module.exports = { buildTimeline, findClassrooms, parentView, TIMELINE_LIMIT };

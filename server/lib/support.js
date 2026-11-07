// Support requests (Release 115) -- shared pieces for routes/support.js (the person asking) and routes/admin-support.js (staff).
// Requirements and access matrix: docs/reference/support-requests-requirements.md
const crypto = require('crypto');
const pool = require('../db/pool');
const { audit } = require('./audit');
const { hasActiveLicense, hasActiveSchoolAdminAssignment, hasActiveDistrictAdminAssignment, isLinkedParent } = require('./access');

const CATEGORIES = {
  cant_sign_in: "I can't sign in",
  invitation_or_seat: 'An invitation or license seat',
  students_or_classroom: 'Students or my classroom',
  parents: 'Parents or a parent invitation',
  billing_or_license: 'A license, order or invoice',
  something_broke: 'Something is broken or confusing',
  other: 'Something else',
};
const STATUSES = ['new', 'open', 'waiting_on_user', 'resolved'];
const LIMITS = { name: 120, email: 255, subject: 200, message: 5000, pageUrl: 500, userAgent: 300 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L: a person reads this out over the phone

// Plain text only: a non-string (an object or an array from a hand-built request) becomes '' rather than being coerced.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function makeRef() {
  let s = '';
  for (let i = 0; i < 5; i++) s += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return 'SR-' + s;
}

// What we know about a signed-in person, worked out from the database -- never from what the form says.
async function resolveContext(siteUser) {
  const roles = [];
  const audiences = []; // the Help center's "for" ids that match these roles
  let schoolDomain = null;
  let districtId = null;
  if (await hasActiveDistrictAdminAssignment(siteUser.id)) {
    roles.push('District administrator'); audiences.push('district');
    const [[d]] = await pool.query('SELECT district_id FROM district_license_admins WHERE site_user_id = ? AND is_active = 1 ORDER BY id LIMIT 1', [siteUser.id]);
    if (d) districtId = d.district_id;
  }
  if (await hasActiveSchoolAdminAssignment(siteUser.id)) {
    roles.push('School license administrator'); audiences.push('school');
    const [[s]] = await pool.query(
      `SELECT p.school_domain FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id
       WHERE sla.site_user_id = ? AND sla.is_active = 1 ORDER BY sla.id LIMIT 1`, [siteUser.id]);
    if (s) schoolDomain = s.school_domain;
  }
  if (await hasActiveLicense(siteUser.id)) {
    roles.push('Teacher'); audiences.push('teacher');
    if (!schoolDomain) {
      const [[s]] = await pool.query(
        `SELECT p.school_domain FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id
         WHERE ls.registered_site_user_id = ? AND ls.status = 'registered' ORDER BY ls.id LIMIT 1`, [siteUser.id]);
      if (s) schoolDomain = s.school_domain;
    }
  }
  if (await isLinkedParent(siteUser.id)) { roles.push('Parent'); audiences.push('parent'); }
  if (!roles.length) roles.push('Signed-in account');
  return { roles: roles.join(', '), audiences, schoolDomain, districtId };
}

async function addMessage(requestId, { authorType, adminId = null, visibility = 'public', body }) {
  const [r] = await pool.query(
    'INSERT INTO support_request_messages (request_id, author_type, author_admin_id, visibility, body) VALUES (?, ?, ?, ?, ?)',
    [requestId, authorType, adminId, visibility, body]
  );
  return r.insertId;
}

// Creates the request and its first message. `who` is already checked: name and email come from the account when signed in.
async function createRequest({ who, category, subject, message, pageUrl, userAgent, siteUserId, context, clientSessionId }) {
  let ref;
  let requestId;
  for (let attempt = 0; attempt < 5 && !requestId; attempt++) {
    ref = makeRef();
    try {
      const [r] = await pool.query(
        `INSERT INTO support_requests
           (ref, status, category, subject, requester_name, requester_email, site_user_id, roles, school_domain, district_id, page_url, user_agent, client_session_id)
         VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ref, category, subject, who.name, who.email, siteUserId || null, context ? context.roles : null,
         context ? context.schoolDomain : null, context ? context.districtId : null, pageUrl || null, userAgent || null, clientSessionId || null]
      );
      requestId = r.insertId;
    } catch (err) {
      // A clash on the short code is rare; try another. Anything else is a real error.
      if (!(err.code === 'ER_DUP_ENTRY' || /UNIQUE/i.test(String(err.message)))) throw err;
    }
  }
  if (!requestId) throw new Error('Could not make a unique support reference');
  await addMessage(requestId, { authorType: 'requester', body: message });
  purgeOldRequests(); // fire and forget: old requests (2 years) are removed in the background
  return { id: requestId, ref };
}

// Support requests (and their messages) are kept 2 years, then deleted. Runs when a new request arrives, at most once an hour, and
// writes one audit row with the count (never any text). Never throws: a failed clean-up must not stop a request being saved.
const RETENTION_YEARS = 2;
let lastPurge = 0;
async function purgeOldRequests() {
  try {
    const now = Date.now();
    if (now - lastPurge < 60 * 60 * 1000) return 0;
    lastPurge = now;
    const cutoff = new Date(now - RETENTION_YEARS * 366 * 24 * 60 * 60 * 1000);
    const [[row]] = await pool.query('SELECT COUNT(*) AS n FROM support_requests WHERE created_at < ?', [cutoff]);
    const n = Number(row && row.n) || 0;
    if (!n) return 0;
    await pool.query('DELETE FROM support_request_messages WHERE request_id IN (SELECT id FROM support_requests WHERE created_at < ?)', [cutoff]);
    await pool.query('DELETE FROM support_requests WHERE created_at < ?', [cutoff]);
    await audit(pool, { actorType: 'system', action: 'support_retention_purge', entityType: 'support_request', newValue: { removed: n } });
    return n;
  } catch (err) {
    console.error('support: retention clean-up failed:', err.message);
    return 0;
  }
}
// Test hook: lets a test make the (at most hourly) clean-up run again.
function _resetPurgeClock() { lastPurge = 0; }

module.exports = { purgeOldRequests, _resetPurgeClock, RETENTION_YEARS, CATEGORIES, STATUSES, LIMITS, EMAIL_PATTERN, cleanText, makeRef, resolveContext, addMessage, createRequest };

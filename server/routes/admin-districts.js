// Internal Fixer Nation admin routes for managing districts (grouping
// schools for the branding fallback chain in server/lib/branding.js) and
// district administrators. Protected by requireAuth — district admins
// themselves cannot access these; they only self-serve their own district's
// branding via /api/district-admin/*.
//
// District-admin assign/resend-welcome/delete/update below is a near-exact
// mirror of admin-school-admins.js's equivalent routes for
// school_license_admins — same placeholder-account-creation pattern, same
// 7-day reset-token activation link, same syncRoleToAssignments call.
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createToken } = require('../lib/site-tokens');
const { sendDistrictAdminWelcomeEmail, sendSalesAlertEmail } = require('../lib/mailer');
const { syncRoleToAssignments } = require('../lib/school-admin-roles');
const { getSetting } = require('../lib/settings');
const crypto = require('crypto');
const { DEMO_DISTRICT_NAME, DEMO_SCHOOL_DOMAIN } = require('../lib/sales-demo');

const router = express.Router();

// ---------------------------------------------------------------------------
// District admin assignments (registered under /admins/* so these literal
// paths never collide with the /:id-shaped district routes below)
// ---------------------------------------------------------------------------

// POST /api/admin/districts/:districtId/admins/assign
router.post('/:districtId/admins/assign', requireAuth, async (req, res) => {
  const districtId = Number(req.params.districtId);
  const { email, firstName: bodyFirstName, lastName: bodyLastName, notes } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });
  // Guardrail: require a real name for every assignment -- see the matching
  // comment in lib/school-admin-assignment.js for why deriving one from the
  // email address was the actual root cause of garbage placeholder names.
  if (!bodyFirstName || !bodyFirstName.trim() || !bodyLastName || !bodyLastName.trim()) {
    return res.status(400).json({ error: 'First and last name are required' });
  }

  const [[district]] = await pool.query('SELECT id, name FROM districts WHERE id = ?', [districtId]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  const normalEmail = email.trim().toLowerCase();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let [userRows] = await conn.query('SELECT id, first_name, email_verified FROM site_users WHERE email = ?', [normalEmail]);
    let user = userRows[0];
    let isNewUser = false;

    if (!user) {
      const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
      const firstName = bodyFirstName.trim();
      const lastName = bodyLastName.trim();

      const [result] = await conn.query(
        "INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role) VALUES (?, ?, ?, ?, 0, 'district_admin')",
        [firstName, lastName, normalEmail, randomHash]
      );
      user = { id: result.insertId, first_name: firstName, email_verified: 0 };
      isNewUser = true;

      const [existingContact] = await conn.query('SELECT id FROM newsletter_contacts WHERE email = ?', [normalEmail]);
      if (!existingContact[0]) {
        await conn.query(
          "INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'District Admin Assignment', 'Subscribed')",
          [`${firstName} ${lastName}`.trim(), normalEmail]
        );
      }
    } else {
      await conn.query("UPDATE site_users SET role = 'district_admin' WHERE id = ?", [user.id]);
    }

    await conn.query(
      `INSERT INTO district_license_admins (site_user_id, district_id, is_active, created_by_admin_id, notes)
       VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE is_active = 1, notes = VALUES(notes), updated_at = NOW()`,
      [user.id, districtId, req.user.userId, notes || null]
    );

    await conn.commit();
    conn.release();

    const siteUrl = process.env.SITE_URL || '';
    // Only frame this as "set your password" when they genuinely don't have
    // a usable one yet — a brand-new account, or an existing account that
    // was never verified. An already-verified existing account (e.g.
    // already a school admin under this email) has a working password and
    // should be told to sign in, not to "set up" an account they already have.
    const needsSetup = isNewUser || !user.email_verified;
    try {
      const resetToken = await createToken(user.id, 'reset', 7 * 24 * 60 * 60 * 1000);
      const loginUrl = `${siteUrl}/district-admin-login.html`;
      const activateUrl = `${siteUrl}/reset-password.html?token=${resetToken}&next=/district-admin-dashboard.html`;
      await sendDistrictAdminWelcomeEmail({
        to: normalEmail,
        firstName: user.first_name,
        districtName: district.name,
        portalUrl: loginUrl,
        activateUrl,
        isNewUser: needsSetup,
      });
    } catch (e) {
      console.error('sendDistrictAdminWelcomeEmail failed:', e.message);
    }

    try {
      await sendSalesAlertEmail({
        to: await getSetting('contact_email_sales_alerts'),
        subject: `District Administrator assigned — ${district.name}`,
        fields: {
          District: district.name,
          Admin: `${user.first_name} <${normalEmail}>`,
          'New Account': isNewUser ? 'Yes' : 'No',
        },
        linkUrl: `${siteUrl}/admin-districts.html`,
        linkLabel: 'View Districts',
      });
    } catch (e) {
      console.error('sales alert (district admin assigned) failed:', e.message);
    }

    res.status(201).json({ ok: true, siteUserId: user.id, isNewUser, districtId, districtName: district.name });
  } catch (err) {
    await conn.rollback();
    conn.release();
    throw err;
  }
});

// POST /api/admin/districts/admins/:assignmentId/resend-welcome
router.post('/admins/:assignmentId/resend-welcome', requireAuth, async (req, res) => {
  const [[assignment]] = await pool.query(
    `SELECT dla.id, dla.site_user_id, d.name AS district_name
     FROM district_license_admins dla
     JOIN districts d ON d.id = dla.district_id
     WHERE dla.id = ?`,
    [req.params.assignmentId]
  );
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  const [[user]] = await pool.query('SELECT id, first_name, email, email_verified FROM site_users WHERE id = ?', [assignment.site_user_id]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const siteUrl = process.env.SITE_URL || '';
  const resetToken = await createToken(user.id, 'reset', 7 * 24 * 60 * 60 * 1000);
  const activateUrl = `${siteUrl}/reset-password.html?token=${resetToken}&next=/district-admin-dashboard.html`;

  try {
    await sendDistrictAdminWelcomeEmail({
      to: user.email,
      firstName: user.first_name,
      districtName: assignment.district_name,
      portalUrl: `${siteUrl}/district-admin-login.html`,
      activateUrl,
      isNewUser: !user.email_verified,
    });
  } catch (e) {
    return res.status(500).json({ error: `Failed to send email: ${e.message}` });
  }

  res.json({ ok: true });
});

// DELETE /api/admin/districts/admins/:assignmentId
router.delete('/admins/:assignmentId', requireAuth, async (req, res) => {
  const [[assignment]] = await pool.query('SELECT * FROM district_license_admins WHERE id = ?', [req.params.assignmentId]);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  await pool.query('UPDATE district_license_admins SET is_active = 0 WHERE id = ?', [assignment.id]);
  await syncRoleToAssignments(assignment.site_user_id);

  res.json({ ok: true });
});

// PUT /api/admin/districts/admins/:assignmentId
router.put('/admins/:assignmentId', requireAuth, async (req, res) => {
  const { isActive, notes } = req.body || {};
  const [[existing]] = await pool.query('SELECT site_user_id FROM district_license_admins WHERE id = ?', [req.params.assignmentId]);
  if (!existing) return res.status(404).json({ error: 'Assignment not found' });

  const updates = [];
  const params = [];
  if (isActive !== undefined) { updates.push('is_active = ?'); params.push(isActive ? 1 : 0); }
  if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.assignmentId);
  const [result] = await pool.query(`UPDATE district_license_admins SET ${updates.join(', ')} WHERE id = ?`, params);
  if (!result.affectedRows) return res.status(404).json({ error: 'Assignment not found' });

  if (isActive !== undefined) await syncRoleToAssignments(existing.site_user_id);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Districts + school assignment
// ---------------------------------------------------------------------------

// GET /api/admin/districts?q=&page=&limit=
router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 25)));
  const offset = (page - 1) * limit;

  let where = '';
  const params = [];
  if (q) { where = 'WHERE d.name LIKE ?'; params.push(`%${q}%`); }

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM districts d ${where}`, params);

  const [rows] = await pool.query(
    `SELECT d.id, d.name, d.created_at,
            (SELECT COUNT(*) FROM schools s WHERE s.district_id = d.id) AS school_count,
            (SELECT COUNT(*) FROM district_license_admins dla WHERE dla.district_id = d.id AND dla.is_active = 1) AS admin_count,
            db.branding_status
     FROM districts d
     LEFT JOIN district_branding db ON db.district_id = d.id
     ${where}
     ORDER BY d.name
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({ districts: rows, total: Number(total), page, limit });
});

// POST /api/admin/districts
router.post('/', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const [result] = await pool.query('INSERT INTO districts (name) VALUES (?)', [name]);
  res.status(201).json({ ok: true, id: result.insertId, name });
});

// GET /api/admin/districts/:id — detail: assigned schools + district admins
router.get('/:id', requireAuth, async (req, res) => {
  const districtId = Number(req.params.id);
  const [[district]] = await pool.query('SELECT id, name, created_at FROM districts WHERE id = ?', [districtId]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  const [schoolRows] = await pool.query('SELECT id, domain, display_name FROM schools WHERE district_id = ? ORDER BY domain', [districtId]);
  const schools = [];
  for (const sc of schoolRows) schools.push({ ...sc, linkage: await schoolLinkage(sc.id) });
  const [admins] = await pool.query(
    `SELECT dla.id, dla.is_active, dla.notes, dla.created_at,
            su.id AS site_user_id, su.first_name, su.last_name, su.email, su.email_verified
     FROM district_license_admins dla
     JOIN site_users su ON su.id = dla.site_user_id
     WHERE dla.district_id = ? AND dla.is_active = 1
     ORDER BY dla.created_at`,
    [districtId]
  );

  res.json({ ...district, schools, admins });
});

// PUT /api/admin/districts/:id — rename
router.put('/:id', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const [result] = await pool.query('UPDATE districts SET name = ? WHERE id = ?', [name, req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'District not found' });

  res.json({ ok: true });
});

// DELETE /api/admin/districts/:id — schools.district_id FK is ON DELETE SET
// NULL and district_branding/district_license_admins are ON DELETE CASCADE,
// so this is always safe; schools simply lose their district assignment.
router.delete('/:id', requireAuth, async (req, res) => {
  const [[{ school_count }]] = await pool.query(
    'SELECT COUNT(*) AS school_count FROM schools WHERE district_id = ?',
    [req.params.id]
  );
  const [result] = await pool.query('DELETE FROM districts WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'District not found' });

  res.json({ ok: true, unassignedSchoolCount: Number(school_count) });
});

// ---- schools <-> districts ------------------------------------------------------------
// What "a school" is made of, and what depends on it:
//   schools row (domain, district_id)  <- the link this endpoint changes
//   purchases.school_id                <- what the concierge flow and school branding key on
//   purchases.school_domain            <- what the district-admin portal also matches on
//   school_license_admins, license_seats  <- keyed by purchase_id, so they follow the purchase and
//                                         need no copying; the district admin sees them through the
//                                         purchase -> school -> district join
// So adding a school must (1) make sure the schools row exists, (2) point every one of that
// domain's purchases at it, and (3) tell the admin what got linked. All steps are idempotent.
const normalizeDomain = (d) => String(d || '').trim().replace(/^@/, '').toLowerCase();

async function schoolLinkage(schoolId) {
  const [[lic]] = await pool.query(`SELECT COUNT(*) AS n FROM purchases WHERE product_type = 'group_license' AND school_id = ?`, [schoolId]);
  const [[adm]] = await pool.query(
    `SELECT COUNT(DISTINCT sla.site_user_id) AS n FROM school_license_admins sla JOIN purchases p ON p.id = sla.purchase_id
     WHERE p.school_id = ? AND sla.is_active = 1`, [schoolId]);
  const [[tch]] = await pool.query(
    `SELECT COUNT(*) AS n FROM license_seats ls JOIN purchases p ON p.id = ls.purchase_id
     WHERE p.school_id = ? AND ls.status = 'registered'`, [schoolId]);
  return { licenses: Number(lic.n), schoolAdmins: Number(adm.n), teachers: Number(tch.n) };
}

// Domains that have group licenses but no schools row yet -- these could not be picked before.
async function unlinkedDomains(q) {
  const params = [];
  let where = '';
  if (q) { where = ' AND LOWER(TRIM(p.school_domain)) LIKE ?'; params.push('%' + q.toLowerCase() + '%'); }
  const [rows] = await pool.query(
    `SELECT LOWER(TRIM(p.school_domain)) AS domain, COUNT(*) AS licenses FROM purchases p
     WHERE p.product_type = 'group_license' AND p.school_domain IS NOT NULL AND TRIM(p.school_domain) <> ''
       AND NOT EXISTS (SELECT 1 FROM schools s WHERE LOWER(s.domain) = LOWER(TRIM(p.school_domain)))${where}
     GROUP BY LOWER(TRIM(p.school_domain)) ORDER BY domain LIMIT 200`, params);
  return rows.map(r => ({ domain: r.domain, licenses: Number(r.licenses) }));
}

// A school can be added before any license exists (allowUnlicensed). It then has nothing to link to:
// licenses, school admins and teacher seats all hang off purchases. It links itself later, because
// routes/newsletter.js createPurchase()/PUT purchase call findOrCreateSchoolId(domain), which finds
// THIS row by its exact (normalized, lower-case) domain. So the spelling has to be right, and we guard
// against typos: strict hostname shape, plus a warning when it is close to a domain we already know.
const isPlausibleDomain = (d) => d.length <= 255 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);

function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Known school domains (school records and licensed purchases) within 2 edits of `domain`.
async function similarDomains(domain) {
  const [rows] = await pool.query(
    `SELECT LOWER(TRIM(domain)) AS d FROM schools
     UNION SELECT LOWER(TRIM(school_domain)) AS d FROM purchases WHERE product_type = 'group_license' AND school_domain IS NOT NULL AND TRIM(school_domain) <> ''`);
  return [...new Set(rows.map(r => r.d))].filter(d => d && d !== domain && editDistance(domain, d, 2) <= 2).sort().slice(0, 5);
}

// Find the schools row for a domain, or create it. Returns { id, domain, created }.
async function findOrCreateSchool(domain) {
  const find = async () => { const [[r]] = await pool.query('SELECT id, domain FROM schools WHERE LOWER(domain) = ?', [domain]); return r; };
  const existing = await find();
  if (existing) return { ...existing, created: false };
  try { await pool.query('INSERT INTO schools (domain) VALUES (?)', [domain]); }
  catch (err) { if (err.code !== 'ER_DUP_ENTRY') throw err; } // lost a race with another request: fine, re-read below
  const row = await find();
  return { ...row, created: true };
}

// Point every purchase for this domain that has no school_id yet at the school. Returns how many.
async function linkPurchases(schoolId, domain) {
  const [r] = await pool.query(
    `UPDATE purchases SET school_id = ? WHERE school_id IS NULL AND school_domain IS NOT NULL AND LOWER(TRIM(school_domain)) = ?`,
    [schoolId, domain]);
  return r.affectedRows || 0;
}

// GET /api/admin/districts/:id/available-schools?q= — schools with no district yet, plus schools
// already in THIS district (so the UI can show both "add" and "remove" candidates), plus
// `unlinked`: licensed domains that have no school record yet (adding one creates it).
router.get('/:id/available-schools', requireAuth, async (req, res) => {
  const districtId = Number(req.params.id);
  const q = (req.query.q || '').trim();

  let where = '(s.district_id IS NULL OR s.district_id = ?)';
  const params = [districtId];
  if (q) { where += ' AND (s.domain LIKE ? OR s.display_name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }

  const [rows] = await pool.query(
    `SELECT s.id, s.domain, s.display_name, s.district_id FROM schools s WHERE ${where} ORDER BY s.domain LIMIT 200`,
    params
  );
  res.json({ schools: rows, unlinked: await unlinkedDomains(q) });
});

// PUT /api/admin/districts/:id/schools — { schoolId | domain, assign: true|false }
// `domain` (assign only) is for a licensed school that has no schools row yet.
router.put('/:id/schools', requireAuth, async (req, res) => {
  const districtId = Number(req.params.id);
  const body = req.body || {};
  const assign = body.assign === true || body.assign === 'true';

  const [[district]] = await pool.query('SELECT id, name FROM districts WHERE id = ?', [districtId]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  if (!assign) {
    const schoolId = Number(body.schoolId);
    if (!Number.isInteger(schoolId) || schoolId <= 0) return res.status(400).json({ error: 'schoolId is required' });
    await pool.query('UPDATE schools SET district_id = NULL WHERE id = ? AND district_id = ?', [schoolId, districtId]);
    return res.json({ ok: true });
  }

  let school;
  let created = false;
  if (body.schoolId != null && body.schoolId !== '') {
    const schoolId = Number(body.schoolId);
    if (!Number.isInteger(schoolId) || schoolId <= 0) return res.status(400).json({ error: 'schoolId is required' });
    [[school]] = await pool.query('SELECT id, domain FROM schools WHERE id = ?', [schoolId]);
    if (!school) return res.status(404).json({ error: 'School not found' });
  } else if (typeof body.domain === 'string' && body.domain.trim()) {
    const domain = normalizeDomain(body.domain);
    // Only a domain that really has licenses can become a school here, so a typo can't mint an empty school.
    const [[licensed]] = await pool.query(
      `SELECT COUNT(*) AS n FROM purchases WHERE product_type = 'group_license' AND LOWER(TRIM(school_domain)) = ?`, [domain]);
    if (!Number(licensed.n)) {
      // No license yet. Only an explicit "add it anyway" request gets past this, and only for a well-formed
      // domain that isn't suspiciously close to one we already know.
      if (body.allowUnlicensed !== true) return res.status(404).json({ error: 'No group license was found for that domain' });
      if (!isPlausibleDomain(domain)) return res.status(400).json({ error: 'Enter a domain like oak.example.edu, without http:// or an @.' });
      const [[known]] = await pool.query('SELECT id FROM schools WHERE LOWER(domain) = ?', [domain]);
      if (!known && body.confirmSimilar !== true) {
        const similar = await similarDomains(domain);
        if (similar.length) {
          return res.status(409).json({ error: `That domain looks close to one we already have: ${similar.join(', ')}. Check the spelling before you add it.`, needsConfirm: true, similar });
        }
      }
    }
    school = { id: null, domain };
  } else {
    return res.status(400).json({ error: 'schoolId or domain is required' });
  }

  // Keep demo and real data apart in BOTH directions. Sales-demo accounts are
  // admins of the demo district, so putting a real school in it would show that
  // school's teachers and students to every salesperson; putting the demo school
  // in a real district would show fake data to that customer's district admin.
  if ((district.name === DEMO_DISTRICT_NAME) !== (school.domain === DEMO_SCHOOL_DOMAIN)) {
    return res.status(409).json({ error: 'The sales demo district can only contain the demo school (and the demo school can only be in the demo district).' });
  }

  if (!school.id) {
    const made = await findOrCreateSchool(school.domain);
    school = { id: made.id, domain: made.domain };
    created = made.created;
  }

  const [result] = await pool.query(
    'UPDATE schools SET district_id = ? WHERE id = ? AND (district_id IS NULL OR district_id = ?)',
    [districtId, school.id, districtId]
  );
  if (!result.affectedRows) {
    // A school we just created is still unowned; the only way to get here is a school in another district.
    return res.status(409).json({ error: 'This school already belongs to a different district.' });
  }

  const newlyLinked = await linkPurchases(school.id, school.domain);
  res.json({ ok: true, school: { id: school.id, domain: school.domain }, createdSchoolRecord: created, newlyLinkedPurchases: newlyLinked, linkage: await schoolLinkage(school.id) });
});

module.exports = router;

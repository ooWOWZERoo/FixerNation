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
const { sendDistrictAdminWelcomeEmail } = require('../lib/mailer');
const { syncRoleToAssignments } = require('../lib/school-admin-roles');

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
      const randomHash = await bcrypt.hash(Math.random().toString(36), 12);
      const nameParts = normalEmail.split('@')[0].split('.');
      const firstName = (bodyFirstName || '').trim() || (nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : 'Administrator');
      const lastName = (bodyLastName || '').trim() || (nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : '');

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
    try {
      const resetToken = await createToken(user.id, 'reset', 7 * 24 * 60 * 60 * 1000);
      const portalUrl = `${siteUrl}/district-admin-dashboard.html`;
      const activateUrl = `${siteUrl}/reset-password.html?token=${resetToken}&next=/district-admin-dashboard.html`;
      await sendDistrictAdminWelcomeEmail({
        to: normalEmail,
        firstName: user.first_name,
        districtName: district.name,
        portalUrl,
        activateUrl,
        isNewUser: true,
      });
    } catch (e) {
      console.error('sendDistrictAdminWelcomeEmail failed:', e.message);
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
      portalUrl: `${siteUrl}/district-admin-dashboard.html`,
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

  const [schools] = await pool.query('SELECT id, domain, display_name FROM schools WHERE district_id = ? ORDER BY domain', [districtId]);
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

// GET /api/admin/districts/:id/available-schools?q= — schools with no
// district yet, plus schools already in THIS district (so the assignment UI
// can show both "add" and "remove" candidates in one list).
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
  res.json({ schools: rows });
});

// PUT /api/admin/districts/:id/schools — { schoolId, assign: true|false }
router.put('/:id/schools', requireAuth, async (req, res) => {
  const districtId = Number(req.params.id);
  const { schoolId, assign } = req.body || {};
  if (!schoolId) return res.status(400).json({ error: 'schoolId is required' });

  const [[district]] = await pool.query('SELECT id FROM districts WHERE id = ?', [districtId]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  if (assign) {
    const [result] = await pool.query(
      'UPDATE schools SET district_id = ? WHERE id = ? AND (district_id IS NULL OR district_id = ?)',
      [districtId, schoolId, districtId]
    );
    if (!result.affectedRows) return res.status(409).json({ error: 'This school already belongs to a different district.' });
  } else {
    await pool.query('UPDATE schools SET district_id = NULL WHERE id = ? AND district_id = ?', [schoolId, districtId]);
  }

  res.json({ ok: true });
});

module.exports = router;

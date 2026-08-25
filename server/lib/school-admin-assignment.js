// Shared core of "assign someone as a School License Administrator for a
// group_license purchase" — extracted so both the FNE-staff flow
// (routes/admin-school-admins.js) and the new district-admin self-service
// flow (routes/district-admin.js) create identical accounts/assignments and
// send the identical welcome email, rather than maintaining two copies of
// this transaction.
//
// created_by_admin_id has no FK constraint and no current UI consumer (grep
// confirms it's write-only today), but semantically it's meant to hold an
// admin_users.id, not a site_users.id — so a district-admin-initiated
// assignment passes null there and records who actually did it in `notes`
// instead, rather than writing a site_user id into a column that would read
// as an FNE-staff id if a future feature ever joins on it.
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { createToken } = require('./site-tokens');
const { sendSchoolAdminWelcomeEmail } = require('./mailer');

async function assignSchoolLicenseAdmin({ email, purchaseId, permissionLevel = 'primary', notes, createdByAdminId = null, firstName: bodyFirstName, lastName: bodyLastName }) {
  if (!['primary', 'secondary', 'read_only'].includes(permissionLevel)) {
    throw Object.assign(new Error('Invalid permission level'), { status: 400 });
  }
  const normalEmail = email.trim().toLowerCase();

  const [[purchase]] = await pool.query(
    "SELECT id, school_domain, payment_status FROM purchases WHERE id = ? AND product_type = 'group_license'",
    [purchaseId]
  );
  if (!purchase) throw Object.assign(new Error('Group license purchase not found'), { status: 404 });

  const conn = await pool.getConnection();
  let user;
  let isNewUser = false;
  try {
    await conn.beginTransaction();

    const [userRows] = await conn.query('SELECT id, first_name, email_verified FROM site_users WHERE email = ?', [normalEmail]);
    user = userRows[0];

    if (!user) {
      const randomHash = await bcrypt.hash(Math.random().toString(36), 12);
      const nameParts = normalEmail.split('@')[0].split('.');
      const firstName = (bodyFirstName || '').trim() || (nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : 'Administrator');
      const lastName = (bodyLastName || '').trim() || (nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : '');

      const [result] = await conn.query(
        "INSERT INTO site_users (first_name, last_name, email, password_hash, email_verified, role) VALUES (?, ?, ?, ?, 0, 'school_license_admin')",
        [firstName, lastName, normalEmail, randomHash]
      );
      user = { id: result.insertId, first_name: firstName, email_verified: 0 };
      isNewUser = true;

      const [existingContact] = await conn.query('SELECT id FROM newsletter_contacts WHERE email = ?', [normalEmail]);
      if (!existingContact[0]) {
        await conn.query(
          "INSERT INTO newsletter_contacts (name, email, source, status) VALUES (?, ?, 'School Admin Assignment', 'Subscribed')",
          [`${firstName} ${lastName}`.trim(), normalEmail]
        );
      }
    } else {
      await conn.query("UPDATE site_users SET role = 'school_license_admin' WHERE id = ?", [user.id]);
    }

    await conn.query(
      `INSERT INTO school_license_admins (site_user_id, purchase_id, permission_level, is_active, created_by_admin_id, notes)
       VALUES (?, ?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE permission_level = VALUES(permission_level), is_active = 1, notes = VALUES(notes), updated_at = NOW()`,
      [user.id, purchaseId, permissionLevel, createdByAdminId, notes || null]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const siteUrl = process.env.SITE_URL || '';
  try {
    const resetToken = await createToken(user.id, 'reset', 7 * 24 * 60 * 60 * 1000);
    const loginUrl = `${siteUrl}/school-admin-login.html`;
    const activateUrl = `${siteUrl}/reset-password.html?token=${resetToken}&next=/school-admin-dashboard.html`;
    // Only frame this as "set your password" when they genuinely don't have
    // a usable one yet — see the comment at the original call site (now
    // here) for why an already-verified existing account should be told to
    // sign in, not "set up" an account they already have.
    const needsSetup = isNewUser || !user.email_verified;
    await sendSchoolAdminWelcomeEmail({
      to: normalEmail,
      firstName: user.first_name,
      schoolDomain: purchase.school_domain,
      portalUrl: loginUrl,
      activateUrl: needsSetup ? activateUrl : loginUrl,
      isNewUser: needsSetup,
    });
  } catch (e) {
    console.error('sendSchoolAdminWelcomeEmail failed:', e.message);
  }

  return { user, isNewUser, purchase };
}

module.exports = { assignSchoolLicenseAdmin };

// The two things staff do to a contact's sign-in account from the contact card: send a password reset email, and delete the account. One copy, shared by the older
// routes (routes/site-auth.js) and the merged Contacts screen (routes/contact-screens.js). Each returns { status, body } and touches no req or res.
const pool = require('../db/pool');
const { sendPasswordResetEmail } = require('./mailer');
const { createToken } = require('./site-tokens');
const { audit } = require('./audit');

// Sends the customer the same password-reset email they'd get from self-service "Forgot Password", just started by an admin.
async function sendPasswordReset(siteUserId, admin) {
  const [rows] = await pool.query('SELECT id, first_name, email FROM site_users WHERE id = ?', [siteUserId]);
  const user = rows[0];
  if (!user) return { status: 404, body: { error: 'Site user not found' } };

  const resetToken = await createToken(user.id, 'reset', 60 * 60 * 1000);
  const resetUrl = `${process.env.SITE_URL || ''}/reset-password.html?token=${resetToken}`;
  await sendPasswordResetEmail({ to: user.email, firstName: user.first_name, resetUrl });
  await audit(pool, { actorType: 'admin', actorId: admin && admin.userId, action: 'admin_reset_email_sent', entityType: 'site_user', entityId: user.id });
  return { status: 200, body: { ok: true } };
}

// Deletes the account. Any license seat it had claimed is freed first so it can go to someone else, rather than leaving a "registered" seat with no account.
async function deleteSiteAccount(siteUserId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "UPDATE license_seats SET status = 'pending', registered_site_user_id = NULL, registered_at = NULL WHERE registered_site_user_id = ?",
      [siteUserId]
    );
    const [result] = await connection.query('DELETE FROM site_users WHERE id = ?', [siteUserId]);
    await connection.commit();
    if (result.affectedRows === 0) return { status: 404, body: { error: 'Site user not found' } };
    return { status: 200, body: { ok: true } };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { sendPasswordReset, deleteSiteAccount };

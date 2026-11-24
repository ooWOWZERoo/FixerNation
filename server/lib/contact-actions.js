// Contact actions that more than one screen needs: delete a contact, and resend a sign-in account's verification email. They used to live inside routes/newsletter.js;
// the older CRM page and the merged Contacts screen (routes/contact-screens.js) now share this one copy, so the rules cannot drift apart
// (docs/reference/contact-pages-merge-requirements.md). Each returns { status, body } for the route to send; none touches req or res.
const pool = require('../db/pool');
const { sendVerificationEmail } = require('./mailer');
const { createToken } = require('./site-tokens');
const { describeConsequences, consequencesText, hasRoles, closeAccount } = require('./account-closing');
const { dealCountForContact, workItemCountForContact } = require('./crm-ownership');
const { loadCrmRole, can } = require('./crm-permissions');
const { audit } = require('./audit');

// Delete a contact. Every rule the older page had stays:
//  - a person who owns a purchase or invoice is refused (purchases and invoices cascade-delete with a contact, and a purchase takes its license seats);
//  - a person on a sales deal is refused until they are taken off it;
//  - CRM notes, tasks, files or meetings on the person are refused unless a CRM Admin confirms erasing them with the person (confirmEraseCrmItems);
//  - a person with a sign-in account has it closed (confirmClose first when the account holds a seat or a role); a staff account is never closed here.
// `admin` is { userId, username } (req.user). `body` is the request body (confirmClose, confirmEraseCrmItems).
async function deleteContact(id, body, admin) {
  const b = body || {};
  const [[owned]] = await pool.query(
    'SELECT (SELECT COUNT(*) FROM purchases WHERE contact_id = ?) AS purchases, (SELECT COUNT(*) FROM invoices WHERE contact_id = ?) AS invoices',
    [id, id]
  );
  const nPurchases = Number(owned.purchases), nInvoices = Number(owned.invoices);
  if (nPurchases || nInvoices) {
    const parts = [];
    if (nPurchases) parts.push(`${nPurchases} purchase${nPurchases === 1 ? '' : 's'}`);
    if (nInvoices) parts.push(`${nInvoices} invoice${nInvoices === 1 ? '' : 's'}`);
    return { status: 409, body: {
      code: 'contact_owns_purchases', purchases: nPurchases, invoices: nInvoices,
      error: `This contact owns ${parts.join(' and ')}. Deleting it would erase them and every license seat on them. Remove or cancel those first.`,
    } };
  }
  // Sales CRM: a contact on a live deal (buying committee or primary contact) is taken off the deal first, never deleted out from under it.
  const nDeals = await dealCountForContact(pool, id);
  if (nDeals) {
    return { status: 409, body: {
      code: 'contact_on_deals', deals: nDeals,
      error: `This contact is on ${nDeals} sales deal${nDeals === 1 ? '' : 's'}. Take them off the deal${nDeals === 1 ? '' : 's'} first.`,
    } };
  }
  // Sales CRM phase 3: notes, tasks, files and meetings written on this contact would be deleted with it. By default that is refused (merge the person into another contact,
  // which moves them, or clear them first). Punch list S12: a CRM Admin who really needs the person gone (an erasure request) confirms with `confirmEraseCrmItems: true`,
  // and the items go with them: the database rows by the foreign keys, the stored files from disk here. Only items filed on THIS contact; anything on a deal or an
  // account that merely mentions them stays.
  const nWork = await workItemCountForContact(pool, id);
  let erasedFiles = [];
  if (nWork) {
    if (b.confirmEraseCrmItems !== true) {
      return { status: 409, body: {
        code: 'contact_has_crm_items', items: nWork,
        error: `This contact has CRM notes, tasks, files or meetings on record (${nWork} in all). Deleting the contact would erase them. Merge the contact into another one in the Customer Hub, or remove those first. A CRM Admin can erase them together with the person.`,
      } };
    }
    const role = await loadCrmRole(admin.userId);
    if (!can(role, 'erase')) return { status: 403, body: { code: 'erase_needs_crm_admin', error: 'Only a CRM Admin can erase a person together with their CRM notes, tasks, files and meetings.' } };
    const [files] = await pool.query('SELECT stored_name FROM crm_attachments WHERE contact_id = ?', [id]);
    erasedFiles = files.map(f => f.stored_name);
  }
  // The CRM is the record of who is on the platform: deleting a contact that has a sign-in account closes the account
  // (lib/account-closing.js, docs/reference/crm-record-of-truth-requirements.md rule B). Staff confirm first when the account holds a
  // seat or a role; a staff account (role admin, or marked is_fne_staff) is never closed this way.
  const [[contact]] = await pool.query('SELECT email FROM newsletter_contacts WHERE id = ?', [id]);
  if (!contact) return { status: 404, body: { error: 'Contact not found' } };
  const [[account]] = await pool.query(
    'SELECT id, first_name, last_name, role, is_fne_staff, closed_at FROM site_users WHERE LOWER(email) = LOWER(?)', [contact.email]);
  let closing = false;
  if (account && !account.closed_at) {
    if (account.role === 'admin' || Number(account.is_fne_staff)) {
      return { status: 409, body: { code: 'staff_account', error: 'This contact is a Fixer Nation staff account and cannot be removed here.' } };
    }
    const consequences = await describeConsequences(pool, account.id);
    if (hasRoles(consequences) && b.confirmClose !== true) {
      return { status: 409, body: { code: 'confirm_close', consequences, error: consequencesText([account.first_name, account.last_name].filter(Boolean).join(' '), consequences) } };
    }
    closing = true;
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (closing) await closeAccount(connection, account.id, { actorType: 'admin', actorId: admin && admin.userId, reason: 'crm_contact_deleted' });
    // Erased on purpose (the foreign keys would remove them too; naming them here makes the erasure explicit and does not depend on the keys being in force).
    if (nWork) for (const table of ['crm_notes', 'crm_tasks', 'crm_attachments', 'crm_appointments']) await connection.query(`DELETE FROM ${table} WHERE contact_id = ?`, [id]);
    await connection.query('DELETE FROM newsletter_contacts WHERE id = ?', [id]);
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  if (nWork) {
    const F = require('./crm-files');
    for (const name of erasedFiles) { const full = F.pathFor(name); if (full) { try { require('fs').unlinkSync(full); } catch { /* already gone */ } } }
    // Counts only: no name and no email goes into the log.
    await audit(pool, { actorType: 'admin', actorId: admin.userId, actorEmail: admin.username, action: 'crm_contact_erased_with_items', entityType: 'crm_contact', entityId: Number(id), newValue: { items: nWork, files: erasedFiles.length } });
  }
  return { status: 200, body: { ok: true, accountClosed: closing, erasedItems: nWork } };
}

// Ad-hoc admin-triggered resend of the site-account verification email, looked up by the contact's email. Unlike the public self-service
// /api/site-auth/resend-verification, this gives the admin a specific reason when it can't send (no account / already verified).
async function resendVerification(id) {
  const [contactRows] = await pool.query('SELECT email FROM newsletter_contacts WHERE id = ?', [id]);
  const contact = contactRows[0];
  if (!contact) return { status: 404, body: { error: 'Contact not found' } };

  const [userRows] = await pool.query('SELECT id, first_name, email_verified FROM site_users WHERE email = ?', [contact.email]);
  const user = userRows[0];
  if (!user) return { status: 404, body: { error: 'No account is registered for this email' } };
  if (user.email_verified) return { status: 400, body: { error: 'This account is already verified' } };

  const verifyToken = await createToken(user.id, 'verify', 24 * 60 * 60 * 1000);
  const verifyUrl = `${process.env.SITE_URL || ''}/api/site-auth/verify?token=${verifyToken}`;
  await sendVerificationEmail({ to: contact.email, firstName: user.first_name, verifyUrl });
  return { status: 200, body: { ok: true } };
}

module.exports = { deleteContact, resendVerification };

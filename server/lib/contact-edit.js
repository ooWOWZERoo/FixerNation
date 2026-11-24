// Change and create a contact (the full card: name, email, phone, company, address, ship-to, source, email-list status, notes, email groups). One copy, shared by the older
// CRM route (routes/newsletter.js, PUT /contacts/:id) and the merged Contacts screen (routes/contact-screens.js), so the rules cannot drift apart
// (docs/reference/contact-pages-merge-requirements.md, phase 3). Each returns { status, body } for the route to send; neither touches req or res.
const pool = require('../db/pool');
const { cleanParty } = require('./invoice-parties');
const { attachGroups, attachSiteUserInfo, setContactGroups, serialize } = require('./contact-records');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Full contact edit. Only fields present in the body are changed. Returns the saved contact, whether the sign-in account's email moved too, and the NAMES of what changed (never values).
async function updateContact(id, b) {
  b = b || {};
  const [existingRows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]);
  const existing = existingRows[0];
  if (!existing) return { status: 404, body: { error: 'Contact not found' } };

  const address = b.address || {};
  let shipTo = null;
  if (b.shipTo !== undefined) {
    try { shipTo = cleanParty(b.shipTo, 'ship'); }
    catch (err) { if (err.status) return { status: err.status, body: { error: err.message } }; throw err; }
  }
  const merged = {
    name: b.name !== undefined ? b.name : existing.name,
    email: b.email !== undefined ? b.email.trim() : existing.email,
    phone: b.phone !== undefined ? b.phone : existing.phone,
    company: b.company !== undefined ? b.company : existing.company,
    street: b.address !== undefined ? address.street || '' : existing.street,
    city: b.address !== undefined ? address.city || '' : existing.city,
    state: b.address !== undefined ? address.state || '' : existing.state,
    zip: b.address !== undefined ? address.zip || '' : existing.zip,
    source: b.source !== undefined ? b.source : existing.source,
    status: b.status !== undefined ? b.status : existing.status,
    notes: b.notes !== undefined ? b.notes : existing.notes,
  };

  // Changing the contact's email moves the sign-in account's email with it (rule E), so the two records cannot drift apart. Refused when
  // another account already uses the new address.
  let accountToMove = null;
  if (String(merged.email).toLowerCase() !== String(existing.email).toLowerCase()) {
    const [[acct]] = await pool.query('SELECT id, closed_at FROM site_users WHERE LOWER(email) = LOWER(?)', [existing.email]);
    if (acct && !acct.closed_at) {
      const [[taken]] = await pool.query('SELECT id FROM site_users WHERE LOWER(email) = LOWER(?) AND id <> ?', [merged.email, acct.id]);
      if (taken) {
        return { status: 409, body: { code: 'account_email_in_use', error: `${merged.email} is already the sign-in email of another account, so this contact's email cannot move there. Use a different address.` } };
      }
      accountToMove = acct;
    }
  }

  const changed = ['name', 'email', 'phone', 'company', 'street', 'city', 'state', 'zip', 'source', 'status', 'notes'].filter(k => String(merged[k] === null || merged[k] === undefined ? '' : merged[k]) !== String(existing[k] === null || existing[k] === undefined ? '' : existing[k]));
  if (shipTo) {
    const was = { name: existing.ship_to_name, company: existing.ship_to_company, street: existing.ship_to_street, city: existing.ship_to_city, state: existing.ship_to_state, zip: existing.ship_to_zip };
    if (Object.keys(was).some(k => String(was[k] || '') !== String(shipTo[k] || ''))) changed.push('shipTo');
  }
  let groupsBefore = null;
  if (b.groupIds !== undefined) {
    const [g] = await pool.query('SELECT group_id FROM contact_group_members WHERE contact_id = ? ORDER BY group_id', [id]);
    groupsBefore = g.map(r => Number(r.group_id));
    const after = [...new Set((Array.isArray(b.groupIds) ? b.groupIds : []).map(Number))].sort((x, y) => x - y);
    if (after.join(',') !== groupsBefore.join(',')) changed.push('groups');
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE newsletter_contacts SET name=?, email=?, phone=?, company=?, street=?, city=?, state=?, zip=?, source=?, status=?, notes=? WHERE id=?',
      [merged.name, merged.email, merged.phone, merged.company, merged.street, merged.city, merged.state, merged.zip, merged.source, merged.status, merged.notes, id]
    );
    if (shipTo) {
      await connection.query(
        'UPDATE newsletter_contacts SET ship_to_name=?, ship_to_company=?, ship_to_street=?, ship_to_city=?, ship_to_state=?, ship_to_zip=? WHERE id=?',
        [shipTo.name || null, shipTo.company || null, shipTo.street || null, shipTo.city || null, shipTo.state || null, shipTo.zip || null, id]
      );
    }
    if (accountToMove) {
      await connection.query('UPDATE site_users SET email = ? WHERE id = ?', [merged.email, accountToMove.id]);
      await connection.query('UPDATE license_seats SET invited_email = ? WHERE LOWER(invited_email) = LOWER(?)', [merged.email, existing.email]);
      await connection.query("UPDATE school_invitations SET invited_email = ? WHERE LOWER(invited_email) = LOWER(?) AND status NOT IN ('registered', 'revoked', 'expired')", [merged.email, existing.email]);
    }
    if (b.groupIds !== undefined) {
      await setContactGroups(connection, id, b.groupIds);
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    // The email column is unique. Say which contact already has the address instead of failing without a reason.
    if (err.code === 'ER_DUP_ENTRY') {
      const [[other]] = await pool.query('SELECT id, name FROM newsletter_contacts WHERE email = ? AND id <> ? LIMIT 1', [merged.email, id]);
      const who = other ? `${other.name || 'another contact'} (contact #${other.id})` : 'another contact';
      return { status: 409, body: { code: 'email_in_use', existingContactId: other ? other.id : null,
        error: `${merged.email} already belongs to ${who}. Edit or delete that contact instead, or use a different address.` } };
    }
    throw err;
  } finally {
    connection.release();
  }

  const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]);
  const [contact] = await attachSiteUserInfo(await attachGroups(rows));
  return { status: 200, body: { contact: serialize(contact), accountEmailUpdated: !!accountToMove, changed } };
}

// Add a person by hand with every field the older Add Contact form had. Returns { status, body } where body is { ok, id, contact } or an error with a code.
// The email-list status is whatever the caller says (the screen defaults it to Unsubscribed: no consent is recorded for a person typed in by staff).
async function createContact(b) {
  b = b || {};
  const email = typeof b.email === 'string' ? b.email.trim() : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return { status: 400, body: { error: 'A valid email address is required.' } };
  const address = b.address || {};
  const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  let shipTo = null;
  if (b.shipTo !== undefined) {
    try { shipTo = cleanParty(b.shipTo, 'ship'); }
    catch (err) { if (err.status) return { status: err.status, body: { error: err.message } }; throw err; }
  }
  const status = b.status === 'Subscribed' ? 'Subscribed' : 'Unsubscribed';
  let id;
  try {
    const [r] = await pool.query(
      'INSERT INTO newsletter_contacts (name, email, phone, company, street, city, state, zip, source, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [clip(b.name, 255), email, clip(b.phone, 32), clip(b.company, 255), clip(address.street, 255), clip(address.city, 128), clip(address.state, 64), clip(address.zip, 16),
        clip(b.source, 100) || 'Manual Entry', status, typeof b.notes === 'string' ? b.notes.trim() : '']
    );
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return { status: 409, body: { code: 'duplicate_email', error: 'A contact with this email already exists. Open it instead.' } };
    throw err;
  }
  if (Array.isArray(b.groupIds) && b.groupIds.length) await setContactGroups(pool, id, b.groupIds);
  if (shipTo) {
    await pool.query(
      'UPDATE newsletter_contacts SET ship_to_name=?, ship_to_company=?, ship_to_street=?, ship_to_city=?, ship_to_state=?, ship_to_zip=? WHERE id=?',
      [shipTo.name || null, shipTo.company || null, shipTo.street || null, shipTo.city || null, shipTo.state || null, shipTo.zip || null, id]
    );
  }
  const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [id]);
  const [contact] = await attachSiteUserInfo(await attachGroups(rows));
  return { status: 201, body: { ok: true, id, contact: serialize(contact) } };
}

module.exports = { updateContact, createContact, EMAIL_PATTERN };

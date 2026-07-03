const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { unsubscribeToken } = require('../lib/mailer');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function attachGroups(contacts) {
  if (contacts.length === 0) return contacts;
  const [rows] = await pool.query(
    `SELECT m.contact_id, g.id, g.name FROM contact_group_members m
     JOIN contact_groups g ON g.id = m.group_id
     WHERE m.contact_id IN (?)`,
    [contacts.map(c => c.id)]
  );
  const groupsByContact = {};
  rows.forEach(r => {
    (groupsByContact[r.contact_id] = groupsByContact[r.contact_id] || []).push({ id: r.id, name: r.name });
  });
  return contacts.map(c => ({ ...c, groups: groupsByContact[c.id] || [] }));
}

async function setContactGroups(connection, contactId, groupIds) {
  await connection.query('DELETE FROM contact_group_members WHERE contact_id = ?', [contactId]);
  if (Array.isArray(groupIds) && groupIds.length) {
    await connection.query(
      'INSERT INTO contact_group_members (contact_id, group_id) VALUES ' + groupIds.map(() => '(?, ?)').join(', '),
      groupIds.flatMap(gid => [contactId, gid])
    );
  }
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    address: { street: row.street || '', city: row.city || '', state: row.state || '', zip: row.zip || '' },
    signupDate: row.signup_date,
    source: row.source,
    status: row.status,
    groups: row.groups || [],
  };
}

// Public — used by both the homepage signup form and the admin's "Add Contact" button.
router.post('/contacts', async (req, res) => {
  const b = req.body || {};
  const email = (b.email || '').trim();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return res.status(400).json({ ok: false, reason: 'invalid' });
  }

  const address = b.address || {};
  const status = b.status === 'Unsubscribed' ? 'Unsubscribed' : 'Subscribed';
  try {
    const [result] = await pool.query(
      'INSERT INTO newsletter_contacts (name, email, street, city, state, zip, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [b.name || '', email, address.street || '', address.city || '', address.state || '', address.zip || '', b.source || 'Homepage', status]
    );
    if (Array.isArray(b.groupIds) && b.groupIds.length) {
      await setContactGroups(pool, result.insertId, b.groupIds);
    }
    const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [result.insertId]);
    const [contact] = await attachGroups(rows);
    res.status(201).json({ ok: true, contact: serialize(contact) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(200).json({ ok: false, reason: 'duplicate' });
    }
    throw err;
  }
});

router.get('/contacts', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM newsletter_contacts ORDER BY signup_date DESC');
  const contacts = (await attachGroups(rows)).map(serialize);
  res.json({ contacts });
});

// Full contact edit — name/email/address/source/status/group membership.
// Only fields present in the body are changed.
router.put('/contacts/:id', requireAuth, async (req, res) => {
  const [existingRows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Contact not found' });

  const b = req.body || {};
  const address = b.address || {};
  const merged = {
    name: b.name !== undefined ? b.name : existing.name,
    email: b.email !== undefined ? b.email.trim() : existing.email,
    street: b.address !== undefined ? address.street || '' : existing.street,
    city: b.address !== undefined ? address.city || '' : existing.city,
    state: b.address !== undefined ? address.state || '' : existing.state,
    zip: b.address !== undefined ? address.zip || '' : existing.zip,
    source: b.source !== undefined ? b.source : existing.source,
    status: b.status !== undefined ? b.status : existing.status,
  };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE newsletter_contacts SET name=?, email=?, street=?, city=?, state=?, zip=?, source=?, status=? WHERE id=?',
      [merged.name, merged.email, merged.street, merged.city, merged.state, merged.zip, merged.source, merged.status, req.params.id]
    );
    if (b.groupIds !== undefined) {
      await setContactGroups(connection, req.params.id, b.groupIds);
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const [rows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  const [contact] = await attachGroups(rows);
  res.json({ contact: serialize(contact) });
});

router.delete('/contacts/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM newsletter_contacts WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Contact not found' });
  res.json({ ok: true });
});

// --- Contact groups ---

router.get('/groups', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT id, name FROM contact_groups ORDER BY name');
  res.json({ groups: rows });
});

router.post('/groups', requireAuth, async (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  try {
    const [result] = await pool.query('INSERT INTO contact_groups (name) VALUES (?)', [name]);
    res.status(201).json({ group: { id: result.insertId, name } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A group with this name already exists' });
    }
    throw err;
  }
});

router.delete('/groups/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM contact_groups WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

// Public link clicked from inside a sent campaign email — no auth, verified by
// an HMAC token instead so a link can't be used to unsubscribe someone else.
router.get('/unsubscribe', async (req, res) => {
  const email = (req.query.email || '').trim();
  const token = req.query.token || '';
  res.set('Content-Type', 'text/html');

  if (!email || token !== unsubscribeToken(email)) {
    return res.status(400).send('<p style="font-family:sans-serif; padding:40px; text-align:center;">This unsubscribe link is invalid.</p>');
  }
  await pool.query('UPDATE newsletter_contacts SET status = ? WHERE email = ?', ['Unsubscribed', email]);
  res.send(`<p style="font-family:sans-serif; padding:40px; text-align:center;">${email} has been unsubscribed from Fixer Nation emails.</p>`);
});

// Bulk import — rows already parsed client-side from CSV.
router.post('/contacts/import', requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  const defaultSource = (req.body && req.body.defaultSource) || 'Bulk Import';

  const [existingRows] = await pool.query('SELECT email FROM newsletter_contacts');
  const existingEmails = new Set(existingRows.map(r => r.email.toLowerCase()));

  let imported = 0, skippedInvalid = 0, skippedDuplicate = 0;
  for (const row of rows) {
    const email = (row.email || '').trim();
    if (!email || !EMAIL_PATTERN.test(email)) { skippedInvalid++; continue; }
    if (existingEmails.has(email.toLowerCase())) { skippedDuplicate++; continue; }
    await pool.query(
      'INSERT INTO newsletter_contacts (name, email, street, city, state, zip, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [row.name || '', email, row.street || '', row.city || '', row.state || '', row.zip || '', row.source || defaultSource, 'Subscribed']
    );
    existingEmails.add(email.toLowerCase());
    imported++;
  }

  res.json({ imported, skippedInvalid, skippedDuplicate });
});

module.exports = router;

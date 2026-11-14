// Sales CRM: keep a contact's Suspect / Prospect / Customer label current after something changes (docs/reference/sales-crm-update-requirements.md, phase 1).
//
// These run AFTER the existing code has finished and committed its own work. They never throw, never block, and never change a response: a payment, a
// quote or an invoice behaves exactly as before whether the CRM is on, off, half set up or broken. If a call is missed, the nightly reconcile
// (scripts/reconcile-crm-classification.js) catches it. They do nothing while the setting crm_v2_enabled is not 'true'.
const pool = require('../db/pool');
const { isCrmEnabled } = require('./crm-permissions');
const cls = require('./crm-classification');

// A database that has not had the CRM alter script run yet is expected, not an error worth shouting about.
function quiet(err) {
  return err && (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR'
    || /no such (table|column)|has no column named/i.test(String(err.message)));
}

async function safely(fn) {
  try {
    if (!(await isCrmEnabled())) return;
    await fn();
  } catch (err) {
    if (!quiet(err)) console.error('crm hook failed:', err.message);
  }
}

function contactChanged(contactId) {
  return safely(async () => { if (contactId) await cls.reconcileContact(pool, Number(contactId)); });
}

function contactChangedByEmail(email) {
  return safely(async () => {
    if (typeof email !== 'string' || !email.trim()) return;
    const [[c]] = await pool.query('SELECT id FROM newsletter_contacts WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))', [email]);
    if (c) await cls.reconcileContact(pool, c.id);
  });
}

function purchaseChanged(purchaseId) {
  return safely(async () => {
    const [[p]] = await pool.query('SELECT contact_id FROM purchases WHERE id = ?', [purchaseId]);
    if (p) await cls.reconcileContact(pool, p.contact_id);
  });
}

// An invoice flipping paid or unpaid moves every purchase on it, so reconcile each owner once.
function invoiceChanged(invoiceId) {
  return safely(async () => {
    const [rows] = await pool.query('SELECT DISTINCT contact_id FROM purchases WHERE invoice_id = ?', [invoiceId]);
    for (const r of rows) await cls.reconcileContact(pool, r.contact_id);
  });
}

module.exports = { contactChanged, contactChangedByEmail, purchaseChanged, invoiceChanged };

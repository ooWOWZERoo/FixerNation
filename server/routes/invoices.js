const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { attachPurchaseDetails } = require('./newsletter');
const { sendInvoiceEmail } = require('../lib/mailer');
const { fireAutomation } = require('../lib/automations');

const router = express.Router();

function serialize(row, contact) {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    contactId: row.contact_id,
    buyer: contact ? { name: contact.name, email: contact.email, company: contact.company } : null,
    poNumber: row.po_number,
    paymentMethod: row.payment_method || null,
    poReceivedDate: row.po_received_date || null,
    total: Number(row.total_cents) / 100,
    status: row.status,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

// Shared by GET /:id and POST /:id/resend — both need the invoice, its buyer
// contact, and its line items rendered the same way.
async function fetchInvoiceWithLineItems(id) {
  const [rows] = await pool.query('SELECT * FROM invoices WHERE id = ?', [id]);
  const invoice = rows[0];
  if (!invoice) return null;

  const [contactRows] = await pool.query('SELECT * FROM newsletter_contacts WHERE id = ?', [invoice.contact_id]);
  const [purchaseRows] = await pool.query('SELECT * FROM purchases WHERE invoice_id = ? ORDER BY id', [invoice.id]);
  const lineItems = await attachPurchaseDetails(purchaseRows);

  return {
    ...serialize(invoice, contactRows[0]),
    buyer: contactRows[0] ? {
      name: contactRows[0].name,
      email: contactRows[0].email,
      company: contactRows[0].company,
      address: {
        street: contactRows[0].street || '',
        city: contactRows[0].city || '',
        state: contactRows[0].state || '',
        zip: contactRows[0].zip || '',
      },
    } : null,
    lineItems: lineItems.map(li => ({
      description: li.productType === 'book'
        ? `📗 ${li.bookTitle || 'Book'}`
        : `🏫 ${li.licenseProductName || (li.productType === 'single_license' ? 'Single Teacher License' : 'Group License')}${li.schoolDomain ? ` (${li.schoolDomain})` : ''}`,
      seatCount: li.seatCount,
      amount: li.amount,
    })),
  };
}

const VALID_STATUSES = ['paid', 'unpaid', 'cancelled'];

router.get('/', requireAuth, async (req, res) => {
  const status = req.query.status;
  const [rows] = status && VALID_STATUSES.includes(status)
    ? await pool.query('SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC', [status])
    : await pool.query('SELECT * FROM invoices ORDER BY created_at DESC');
  if (!rows.length) return res.json({ invoices: [] });

  const contactIds = [...new Set(rows.map(i => i.contact_id))];
  const [contactRows] = await pool.query('SELECT id, name, email, company FROM newsletter_contacts WHERE id IN (?)', [contactIds]);
  const contactById = Object.fromEntries(contactRows.map(c => [c.id, c]));

  const [itemCountRows] = await pool.query(
    'SELECT invoice_id, COUNT(*) AS count FROM purchases WHERE invoice_id IN (?) GROUP BY invoice_id',
    [rows.map(i => i.id)]
  );
  const itemCountByInvoice = Object.fromEntries(itemCountRows.map(r => [r.invoice_id, r.count]));

  res.json({
    invoices: rows.map(row => ({
      ...serialize(row, contactById[row.contact_id]),
      itemCount: itemCountByInvoice[row.id] || 0,
    })),
  });
});

router.get('/:id', requireAuth, async (req, res) => {
  const invoice = await fetchInvoiceWithLineItems(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice });
});

// Emails the invoice to its buyer's contact email — the invoice contents are
// embedded directly in the email body since there's no customer-facing page
// to link to (admin-invoice-print.html requires admin login).
router.post('/:id/resend', requireAuth, async (req, res) => {
  const invoice = await fetchInvoiceWithLineItems(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!invoice.buyer || !invoice.buyer.email) {
    return res.status(400).json({ error: 'No email on file for this invoice\'s contact' });
  }

  await sendInvoiceEmail({
    to: invoice.buyer.email,
    buyerName: invoice.buyer.company || invoice.buyer.name,
    invoiceNumber: invoice.invoiceNumber,
    poNumber: invoice.poNumber,
    total: invoice.total,
    status: invoice.status,
    lineItems: invoice.lineItems,
  });
  res.json({ ok: true });
});

// Marks the whole invoice paid/unpaid and cascades that status to every
// purchase it grouped — a partially-paid PO order (some line items paid,
// others not) isn't a state worth supporting, so this keeps them in sync
// rather than letting the CRM's per-purchase status drift from the invoice.
router.put('/:id', requireAuth, async (req, res) => {
  const status = req.body && req.body.status;
  if (status !== 'paid' && status !== 'unpaid' && status !== 'cancelled') {
    return res.status(400).json({ error: "status must be 'paid', 'unpaid', or 'cancelled'" });
  }

  const [rows] = await pool.query('SELECT id, status FROM invoices WHERE id = ?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
  const wasAlreadyPaid = rows[0].status === 'paid';

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE invoices SET status = ?, paid_at = ? WHERE id = ?',
      [status, status === 'paid' ? new Date() : null, req.params.id]
    );
    // Cancelling an invoice is just a record-keeping change — it doesn't touch
    // purchases.payment_status, since seats/access already granted to a school
    // shouldn't be silently revoked here. paid/unpaid still cascade as before.
    if (status !== 'cancelled') {
      // purchases.payment_status uses 'paid'|'pending' (not 'unpaid') — map accordingly.
      await connection.query('UPDATE purchases SET payment_status = ? WHERE invoice_id = ?', [status === 'paid' ? 'paid' : 'pending', req.params.id]);
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  // Only fire on a fresh transition to paid — flipping it paid→paid (e.g. a
  // duplicate submit) shouldn't re-send the confirmation.
  if (status === 'paid' && !wasAlreadyPaid) {
    try {
      const invoice = await fetchInvoiceWithLineItems(req.params.id);
      if (invoice.buyer && invoice.buyer.email) {
        await fireAutomation('invoice_paid', {
          to: invoice.buyer.email,
          mergeFields: { buyerName: invoice.buyer.company || invoice.buyer.name, invoiceNumber: invoice.invoiceNumber, total: '$' + invoice.total.toFixed(2) },
        });
      }
    } catch (err) {
      console.error('Invoice-paid automation failed:', err.message);
    }
  }

  res.json({ ok: true });
});

// Mark hard-copy PO as received — activates the associated school license.
// Separate from "Mark as Paid": PO receipt triggers access; payment tracks
// the financial obligation independently.
router.post('/:id/po-received', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, po_received_date, payment_method, status FROM invoices WHERE id = ?',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Invoice not found' });
  const inv = rows[0];
  if (inv.payment_method && inv.payment_method !== 'po') {
    return res.status(400).json({ error: 'This invoice is not a Purchase Order invoice' });
  }
  if (inv.po_received_date) {
    return res.status(400).json({ error: 'PO already marked as received' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      'UPDATE invoices SET po_received_date = NOW() WHERE id = ?',
      [req.params.id]
    );
    // Activate all purchases linked to this invoice and set effective_date if not already set
    await connection.query(
      `UPDATE purchases
       SET license_status = 'active',
           effective_date = COALESCE(effective_date, CURDATE())
       WHERE invoice_id = ?`,
      [req.params.id]
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  // Audit log — best-effort, don't fail the request on a log error
  pool.query(
    `INSERT INTO school_audit_log (actor_type, actor_id, action, entity_type, entity_id)
     VALUES ('admin', ?, 'po_received', 'invoice', ?)`,
    [req.session && req.session.userId ? req.session.userId : null, req.params.id]
  ).catch(e => console.error('audit log error:', e.message));

  res.json({ ok: true });
});

// Purchases carry ON DELETE SET NULL on invoice_id, so deleting an invoice
// un-groups its line items rather than deleting the underlying purchases —
// seats/licenses/book orders already granted stay intact.
router.delete('/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM invoices WHERE id = ?', [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ ok: true });
});

module.exports = router;

// The Procurement card on a deal (Sales CRM phase 4d): what is still open between "they said yes" and "the license works", read from the purchase and its
// invoice. Pure display: nothing here changes a purchase, an invoice or a license. The flags are plain facts; none is a score.
//
//   po_not_received  a purchase-order purchase has a PO number on file and the invoice has no "PO received" date yet
//   invoice_unpaid   the invoice is unpaid
//   license_pending  the license is still pending (it activates when the PO is marked received)
//   payment_pending  a card purchase waiting for the payment confirmation
function procurementFlags(p) {
  const flags = [];
  const method = String(p.payment_method || '');
  if (method === 'po' && p.po_number && !p.po_received_date) flags.push({ key: 'po_not_received', label: 'PO promised, not received', tone: 'warn' });
  if (p.invoice_status === 'unpaid') flags.push({ key: 'invoice_unpaid', label: 'Invoice unpaid', tone: 'warn' });
  if (p.license_status === 'pending') flags.push({ key: 'license_pending', label: 'License pending', tone: 'warn' });
  if (method === 'card' && p.payment_status === 'pending') flags.push({ key: 'payment_pending', label: 'Card payment not confirmed', tone: 'warn' });
  return flags;
}

async function procurementForDeal(db, dealId) {
  const [rows] = await db.query(
    `SELECT p.id, p.quote_id, p.payment_method, p.payment_status, p.po_number, p.license_status, p.amount_cents, p.invoice_id,
            i.invoice_number, i.status AS invoice_status, i.po_received_date, q.quote_number
     FROM purchases p JOIN quote_requests q ON q.id = p.quote_id LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE q.opportunity_id = ? ORDER BY p.id`, [dealId]);
  return rows.map(p => ({
    purchaseId: p.id, quoteId: p.quote_id, quoteNumber: p.quote_number || null, paymentMethod: p.payment_method, paymentStatus: p.payment_status,
    poNumber: p.po_number || null, poReceivedDate: p.po_received_date || null, licenseStatus: p.license_status || 'active',
    amountCents: p.amount_cents === null || p.amount_cents === undefined ? null : Number(p.amount_cents),
    invoiceId: p.invoice_id || null, invoiceNumber: p.invoice_number || null, invoiceStatus: p.invoice_status || null,
    flags: procurementFlags(p),
  }));
}

module.exports = { procurementFlags, procurementForDeal };

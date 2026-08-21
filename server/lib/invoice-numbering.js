// "INV-00001" style, generated after the row exists so it can incorporate the
// real auto-increment id — simplest scheme that's guaranteed unique.
async function generateInvoiceNumber(connection, invoiceId) {
  const invoiceNumber = `INV-${String(invoiceId).padStart(5, '0')}`;
  await connection.query('UPDATE invoices SET invoice_number = ? WHERE id = ?', [invoiceNumber, invoiceId]);
  return invoiceNumber;
}

module.exports = { generateInvoiceNumber };

// Which purchase belongs to a quote (Sales CRM phase 4a, docs/reference/sales-crm-update-requirements.md).
//
// Several purchases can share one quote_id: every click on the card button used to make a new pending purchase. "The newest one" is therefore
// the wrong answer once a buyer clicked twice and paid the first. The right one is the purchase that was actually paid, then the one that has
// an invoice (a PO acceptance), then the newest. Every place that needs "the purchase for this quote" calls this; a test fails if the old
// `ORDER BY id DESC LIMIT 1` pattern comes back in routes/.
//
// `db` is a pool or a transaction's connection. Returns the purchase id, or null.
const ORDER_SQL = "ORDER BY (payment_status = 'paid') DESC, (invoice_id IS NOT NULL) DESC, id DESC";

async function purchaseIdForQuote(db, quoteId) {
  const [[row]] = await db.query(`SELECT id FROM purchases WHERE quote_id = ? ${ORDER_SQL} LIMIT 1`, [quoteId]);
  return row ? row.id : null;
}

// The card purchase a buyer can still pay: made by an earlier click on the card button and not yet paid. Reused instead of making another.
async function openCardPurchaseIdForQuote(db, quoteId) {
  const [[row]] = await db.query(
    "SELECT id FROM purchases WHERE quote_id = ? AND payment_method = 'card' AND payment_status = 'pending' ORDER BY id DESC LIMIT 1",
    [quoteId]
  );
  return row ? row.id : null;
}

// Punch list S5. The open card purchase holds a snapshot of the quote's price, seats and product from the first click. If staff re-priced the quote since
// (before the buyer paid), the Stripe session charges the NEW price but the old purchase would be marked paid with the OLD amount and seat count. So an open
// purchase that no longer matches the quote is removed (it was never paid, has no invoice, and its seats are removed with it) and the caller makes a fresh one.
// Returns true if it removed one. Only ever touches a pending card purchase with no invoice and no Stripe invoice.
async function dropStaleOpenCardPurchase(db, quote, purchaseId) {
  const [[p]] = await db.query('SELECT id, amount_cents, seat_count, license_product_id FROM purchases WHERE id = ?', [purchaseId]);
  if (!p) return false;
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const same = num(p.amount_cents) === num(quote.quoted_amount_cents)
    && num(p.seat_count) === (num(quote.quoted_seat_count) || 1)
    && num(p.license_product_id) === num(quote.quoted_product_id);
  if (same) return false;
  const [[open]] = await db.query(
    "SELECT id FROM purchases WHERE id = ? AND payment_method = 'card' AND payment_status = 'pending' AND invoice_id IS NULL AND stripe_invoice_id IS NULL",
    [purchaseId]
  );
  if (!open) return false;
  await db.query('DELETE FROM license_seats WHERE purchase_id = ?', [purchaseId]); // the foreign key would do this; stated so it never depends on it
  const [r] = await db.query('DELETE FROM purchases WHERE id = ?', [purchaseId]);
  return r.affectedRows > 0;
}

module.exports = { purchaseIdForQuote, openCardPurchaseIdForQuote, dropStaleOpenCardPurchase, ORDER_SQL };

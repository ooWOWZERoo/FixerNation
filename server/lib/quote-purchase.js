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

module.exports = { purchaseIdForQuote, openCardPurchaseIdForQuote, ORDER_SQL };

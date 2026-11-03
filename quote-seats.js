// The quote builder's seat and price rules for the Annual tab (admin-quotes.html), kept in one file so the page and the tests
// use the same arithmetic. Loaded by the page with <script src="quote-seats.js?v=1">; also require()-able from Node.
// Rules: docs/reference/quote-added-seats-requirements.md
//   - Additional Seats are free: they raise the seat count and never change the price.
//   - Seats on the quote = the tier's seats + the added seats. That total is what the accepted license gets.
(function (root) {
  function whole(n) {
    var v = parseInt(n, 10);
    return isNaN(v) || v < 0 ? 0 : v;
  }

  // Seats the license will have.
  function totalSeats(tierSeats, addedSeats) {
    return whole(tierSeats) + whole(addedSeats);
  }

  // A quote built on the Add-On Seats tab stores the same number as its seat count and its added-seat count. An Annual quote's
  // seat count is always larger than its added seats, so this tells the two apart when a saved quote is reopened.
  function isAddonTabQuote(seatCount, addonSeats) {
    return whole(addonSeats) > 0 && whole(seatCount) === whole(addonSeats);
  }

  // Price for the Annual tab. `typedAmount` is the yearly price in the Dollar Amount box (blank or invalid means the catalog
  // price). Added seats never appear here.
  function annualPrice(opts) {
    var catalog = Number(opts.catalogPrice) || 0;
    var typed = parseFloat(opts.typedAmount);
    var base = !isNaN(typed) && typed >= 0 ? typed : catalog;
    var years = whole(opts.termYears) || 1;
    var disc = Number(opts.discountPct) || 0;
    var subtotal = base * years;
    var discountAmt = disc > 0 ? subtotal * (disc / 100) : 0;
    return {
      annualBase: base,
      subtotal: subtotal,
      discountAmt: discountAmt,
      total: subtotal - discountAmt,
      isCustom: Math.abs(base - catalog) > 0.005,
    };
  }

  var api = { totalSeats: totalSeats, isAddonTabQuote: isAddonTabQuote, annualPrice: annualPrice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.fnQuoteSeats = api;
})(typeof window !== 'undefined' ? window : this);

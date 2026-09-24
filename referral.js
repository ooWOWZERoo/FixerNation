/* Fixer Nation Education — affiliate referral capture.
   Loaded on every public page. When a visitor arrives on a link carrying
   ?ref=CODE, the code goes into the fn_ref cookie for 90 days. The server
   reads it back off any later /api request (server/lib/affiliate-attribution.js)
   and credits the sale, so nothing else on the page has to know this exists.

   Last-touch: a newer ?ref= link always replaces whatever was stored before.
   See docs/AFFILIATE_PROGRAM_SPIKE.md for the confirmed attribution rules. */
(function () {
  var COOKIE = 'fn_ref';
  var DAYS = 90;
  // Matches the shape the admin UI and the approve endpoint enforce, so a
  // typo'd or hand-crafted ?ref= never reaches the database as a lookup.
  var CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

  var params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch (e) {
    return;
  }

  var raw = params.get('ref');
  if (!raw) return;

  var code = raw.trim().toUpperCase();
  if (!CODE_RE.test(code)) return;

  var expires = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000).toUTCString();
  // SameSite=Lax so the cookie survives the return trip from Stripe Checkout
  // back onto the site. Secure only on https, or a local http page could
  // never set it at all.
  var cookie = COOKIE + '=' + encodeURIComponent(code) +
    '; expires=' + expires + '; path=/; SameSite=Lax';
  if (window.location.protocol === 'https:') cookie += '; Secure';

  document.cookie = cookie;
})();

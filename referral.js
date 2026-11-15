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

/* Campaign source ("how did you find us"), for the Customer Hub.
   A second, separate job in the same file, because this one already loads on every public page and never on a student page. When a visit carries a utm_ parameter,
   or arrives from a site that is not ours, the visit's source is saved in the fn_attr cookie for 30 days: one "first" touch (never replaced) and one "latest" touch
   (replaced by each newer visit). The server reads it back off a public form's own request (server/lib/attribution.js), so no form changes and nothing extra is sent.
   What goes in it: the source, the medium, the campaign name, the page the visit landed on (path only, no query string) and the time. Never an IP address, a name or
   an email address. It is advisory: it tells staff where to look, it never decides a price, access or a commission. */
(function () {
  var COOKIE = 'fn_attr';
  var DAYS = 30;
  var TEXT_RE = /^[A-Za-z0-9 _.\-+:\/]{1,100}$/;
  // Coming back from these is not a new visit: the payment page and the sign-in providers.
  var IGNORED_HOSTS = ['stripe.com', 'microsoftonline.com', 'live.com', 'accounts.google.com'];

  function clean(v, lower) {
    if (typeof v !== 'string') return null;
    var t = v.trim();
    if (!TEXT_RE.test(t)) return null;
    return lower ? t.toLowerCase() : t;
  }
  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return null; }
  }
  function endsWith(host, suffix) { return host === suffix || host.slice(-(suffix.length + 1)) === '.' + suffix; }

  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }

  var source = clean(params.get('utm_source'), true);
  var medium = clean(params.get('utm_medium'), true);
  var campaign = clean(params.get('utm_campaign'), false);

  if (!source) {
    var from = document.referrer ? hostOf(document.referrer) : null;
    var own = window.location.hostname.toLowerCase().replace(/^www\./, '');
    if (!from || !TEXT_RE.test(from) || endsWith(from, own) || endsWith(own, from)) return;
    for (var i = 0; i < IGNORED_HOSTS.length; i++) if (endsWith(from, IGNORED_HOSTS[i])) return;
    source = from;
    if (!medium) medium = 'referral';
  }

  var path = window.location.pathname;
  var touch = { s: source, t: Math.floor(Date.now() / 1000) };
  if (medium) touch.m = medium;
  if (campaign) touch.c = campaign;
  if (/^\/[A-Za-z0-9._~\-\/%]{0,254}$/.test(path)) touch.p = path;

  var first = touch;
  try {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    var old = m ? JSON.parse(decodeURIComponent(m[1])) : null;
    if (old && old.f && typeof old.f === 'object' && old.f.s) first = old.f;
  } catch (e) { /* an unreadable old cookie is simply replaced */ }

  var expires = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000).toUTCString();
  var cookie = COOKIE + '=' + encodeURIComponent(JSON.stringify({ f: first, l: touch })) +
    '; expires=' + expires + '; path=/; SameSite=Lax';
  if (window.location.protocol === 'https:') cookie += '; Secure';
  document.cookie = cookie;
})();

// In-process rate limiting. This host runs a single Node process, so a Map is
// enough; it resets on restart, which is acceptable for brute-force and spam
// deterrence (it is not a substitute for provider-level limits).
//
// Two tools:
//   limiter(...)         middleware that counts EVERY request (spam-prone public forms)
//   FailureTracker       counts only FAILED attempts and is cleared on success
//                        (logins: a legitimate user is never throttled by their own
//                        successful logins, and a whole classroom behind one school
//                        IP isn't locked out by each other's correct PINs)
//
// Client IP: LiteSpeed sits in front of Node, so req.ip is the proxy. The proxy
// APPENDS the real client address to X-Forwarded-For, which means the RIGHTMOST
// entry is the one our own proxy wrote; the left entries are client-supplied and
// trivially spoofable (the old affiliates.js throttle trusted the first entry).
// If no usable address can be resolved (header missing, or only a loopback
// address), IP-keyed limits are SKIPPED rather than applied to a shared proxy
// address -- otherwise one abusive visitor would exhaust the bucket for every
// visitor and lock the whole site out. Per-account limits don't depend on the IP.

const buckets = new Map(); // key -> array of timestamps (ms)
let warnedNoIp = false;

function isLoopback(ip) {
  return !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const candidate = xff.length ? xff[xff.length - 1] : (req.headers['x-real-ip'] || req.ip);
  if (isLoopback(candidate)) {
    if (!warnedNoIp) {
      warnedNoIp = true;
      console.warn('rate-limit: could not resolve a client IP (no usable X-Forwarded-For); IP-based limits are being skipped. Per-account limits still apply.');
    }
    return null;
  }
  return String(candidate);
}

function recent(key, windowMs, now) {
  const arr = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length) buckets.set(key, arr); else buckets.delete(key);
  return arr;
}

// Keep the Map from growing without bound on long uptimes.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    if (!arr.length || now - arr[arr.length - 1] > 6 * 60 * 60 * 1000) buckets.delete(k);
  }
}, 10 * 60 * 1000);
sweeper.unref();

function tooMany(res, retryAfterSec) {
  res.set('Retry-After', String(retryAfterSec));
  return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
}

// Middleware: at most `max` requests per `windowMs` per key. `key` returns a
// string, or null/undefined to skip this limiter for the request.
function limiter({ name, windowMs, max, key = clientIp }) {
  return (req, res, next) => {
    const k = key(req);
    if (!k) return next();
    const fullKey = `${name}:${k}`;
    const now = Date.now();
    const arr = recent(fullKey, windowMs, now);
    if (arr.length >= max) return tooMany(res, Math.ceil((arr[0] + windowMs - now) / 1000));
    arr.push(now);
    buckets.set(fullKey, arr);
    next();
  };
}

class FailureTracker {
  constructor({ name, windowMs, max }) {
    this.name = name; this.windowMs = windowMs; this.max = max;
  }
  _key(k) { return `${this.name}:${k}`; }
  // Seconds until a blocked key frees up, or 0 if it isn't blocked.
  blockedFor(k) {
    if (!k) return 0;
    const now = Date.now();
    const arr = recent(this._key(k), this.windowMs, now);
    return arr.length >= this.max ? Math.ceil((arr[0] + this.windowMs - now) / 1000) : 0;
  }
  fail(k) {
    if (!k) return;
    const key = this._key(k), now = Date.now();
    const arr = recent(key, this.windowMs, now);
    arr.push(now);
    buckets.set(key, arr);
  }
  clear(k) { if (k) buckets.delete(this._key(k)); }
}

// Convenience for login handlers: returns true (after sending a 429) if ANY of
// the given [tracker, key] pairs is currently blocked.
function rejectIfBlocked(res, pairs) {
  let worst = 0;
  for (const [tracker, k] of pairs) worst = Math.max(worst, tracker.blockedFor(k));
  if (worst > 0) { tooMany(res, worst); return true; }
  return false;
}

module.exports = { limiter, FailureTracker, rejectIfBlocked, clientIp };

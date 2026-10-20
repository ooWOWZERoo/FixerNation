// Same-site redirect targets only. A bare startsWith('/') check also accepts
// "//evil.com" and "/\evil.com", which browsers treat as protocol-relative
// absolute URLs -- an open redirect. This requires a single leading slash that
// is NOT followed by another slash or a backslash, and limits the rest to
// characters that can't break out of an HTML attribute or introduce a scheme/host.
const SAFE_LOCAL_PATH = /^\/(?![\/\\])[A-Za-z0-9\-._~\/%?=&#+,:@]*$/;

function safeLocalPath(p, fallback = '/index.html') {
  return typeof p === 'string' && p.length <= 500 && SAFE_LOCAL_PATH.test(p) ? p : fallback;
}

module.exports = { safeLocalPath, SAFE_LOCAL_PATH };

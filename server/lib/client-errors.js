// Error capture (Release 122): what the site records when something breaks, so staff can see it in the browser (Support Inbox, Errors tab)
// instead of reading stderr.log. Requirements and access matrix: docs/reference/error-capture-requirements.md.
//
// Privacy rules that must not erode: no IP address, no query string or # fragment (reset, invite and verify tokens live there), no
// request or response body, no cookie, no form value, no full email address, no student name or id. Text is cut short and anything that
// looks like an email address or a token is replaced before it is saved.
const pool = require('../db/pool');

const BROWSER_KINDS = ['js_error', 'promise_rejection', 'failed_request']; // the only kinds a browser may report
const ALL_KINDS = [...BROWSER_KINDS, 'server_error', 'email_failed'];
const RETENTION_DAYS = 30;
const LIMITS = { message: 300, source: 200, path: 200, agent: 300, session: 64, method: 8 };

const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_LIKE = /[A-Za-z0-9_-]{24,}/g;
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{24,}$/; // a whole path piece that is a token (no g flag: test() with g remembers its place)

// Plain text only (an object or array from a hand-built request becomes ''), with emails and long tokens taken out, cut to `max`.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').replace(EMAIL_LIKE, '[removed]').replace(TOKEN_LIKE, '[removed]').replace(/\s+/g, ' ').trim().slice(0, max);
}

// A path or URL down to its path only: no origin, no query, no fragment; numbers and token-like pieces become placeholders so
// /api/classrooms/42/students/7 and /api/classrooms/43/students/9 are the same error.
function normalizePath(value) {
  if (typeof value !== 'string') return '';
  let p = value.trim();
  p = p.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  p = p.split('#')[0].split('?')[0];
  p = p.split('/').map(seg => (/^\d+$/.test(seg) ? ':id' : TOKEN_SEGMENT.test(seg) ? ':token' : seg)).join('/');
  return p.replace(EMAIL_LIKE, '[removed]').slice(0, LIMITS.path);
}

// "file.js:12" from a script address and line, without the origin or query string.
function cleanSource(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/\?[^:]*/, '').slice(0, LIMITS.source);
}

let lastPurge = 0;
async function purgeOld() {
  const now = Date.now();
  if (now - lastPurge < 60 * 60 * 1000) return;
  lastPurge = now;
  await pool.query('DELETE FROM client_errors WHERE last_seen < ?', [new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000)]);
}

// Saves one report, or counts it again if the same thing already happened in the same browser session. Never throws: reporting an
// error must never cause one. Returns true if saved.
async function recordError(r) {
  try {
    if (!ALL_KINDS.includes(r.kind)) return false;
    const row = {
      kind: r.kind,
      pagePath: normalizePath(r.pagePath),
      apiPath: normalizePath(r.apiPath),
      method: typeof r.method === 'string' ? r.method.toUpperCase().replace(/[^A-Z]/g, '').slice(0, LIMITS.method) : '',
      status: Number.isInteger(r.status) && r.status >= 0 && r.status < 1000 ? r.status : 0,
      message: cleanText(r.message, LIMITS.message),
      source: r.kind === 'email_failed' ? cleanText(r.source, LIMITS.source) : cleanSource(r.source),
      userKind: ['visitor', 'signed_in', 'student', 'admin', 'server'].includes(r.userKind) ? r.userKind : 'visitor',
      siteUserId: r.userKind === 'signed_in' && Number.isInteger(r.siteUserId) ? r.siteUserId : null, // never kept for a student
      sessionId: typeof r.sessionId === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(r.sessionId) ? r.sessionId : '',
      userAgent: cleanText(r.userAgent, LIMITS.agent),
    };
    if (!row.message && !row.apiPath) return false;
    const [[same]] = await pool.query(
      `SELECT id FROM client_errors
       WHERE kind = ? AND page_path = ? AND api_path = ? AND method = ? AND http_status = ? AND message = ? AND source = ? AND client_session_id = ? AND user_kind = ?
       LIMIT 1`,
      [row.kind, row.pagePath, row.apiPath, row.method, row.status, row.message, row.source, row.sessionId, row.userKind]
    );
    if (same) {
      await pool.query('UPDATE client_errors SET occurrences = occurrences + 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [same.id]);
    } else {
      await pool.query(
        `INSERT INTO client_errors (kind, page_path, api_path, method, http_status, message, source, user_kind, site_user_id, client_session_id, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.kind, row.pagePath, row.apiPath, row.method, row.status, row.message, row.source, row.userKind, row.siteUserId, row.sessionId, row.userAgent]
      );
    }
    purgeOld().catch(() => {});
    return true;
  } catch (err) {
    console.error('client-errors: could not record:', err.message);
    return false;
  }
}

// A route crashed (called from the Express error handler). The message is the error's own text; emails and tokens are removed.
function recordServerError(req, err) {
  return recordError({
    kind: 'server_error', method: req && req.method, apiPath: req && req.originalUrl,
    message: `${err && err.code ? err.code + ': ' : ''}${err && err.message ? err.message : String(err)}`, userKind: 'server',
  });
}

// An email could not be sent (called from the mail transport). Saves the subject and the recipient's DOMAIN only, never the address.
function recordEmailFailure(mail, err) {
  const first = [].concat((mail && mail.to) || [])[0];
  const addr = typeof first === 'string' ? first : (first && first.address) || '';
  const domain = addr.includes('@') ? addr.slice(addr.lastIndexOf('@') + 1).replace(/[>"'\s].*$/, '') : '';
  return recordError({
    kind: 'email_failed', userKind: 'server',
    message: err && err.message ? err.message : String(err),
    apiPath: '', pagePath: '',
    source: `to @${domain || 'unknown'}; subject: ${mail && typeof mail.subject === 'string' ? mail.subject : ''}`,
  });
}

// Test hook: lets a test make the (at most hourly) purge run again.
function _resetPurgeClock() { lastPurge = 0; }

module.exports = { _resetPurgeClock, BROWSER_KINDS, ALL_KINDS, RETENTION_DAYS, cleanText, normalizePath, cleanSource, recordError, recordServerError, recordEmailFailure };

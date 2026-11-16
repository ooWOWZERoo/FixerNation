// Sales CRM files (phase 3): where the bytes live, what is allowed in, and how a name is made safe. No database access here.
//
// Files sit under <UPLOADS_DIR>/crm-private/ (so the nightly backup, which mirrors UPLOADS_DIR, covers them) under a random name with the neutral extension
// ".bin", never the name or type the uploader gave. That folder is NEVER a public URL: app.js answers 404 for /uploads/crm-private and .htaccess refuses it
// (a test checks both), and the only way to read a file is GET /api/crm/files/:id/download after the role and subject checks. CRM_FILES_DIR may point it
// somewhere else entirely (for example outside public_html), in which case the backup note in PROJECT.md applies.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES_PER_SUBJECT = 25;
// Type comes from the file's own first bytes (lib/upload-safety.js). No SVG, HTML, script or video. A Word or Excel file is a zip container: stored and served
// only as a download, never shown inline.
const ALLOWED_KINDS = new Set(['png', 'jpg', 'gif', 'webp', 'pdf', 'doc', 'docx']);
const STORED_NAME = /^[a-f0-9]{32}\.bin$/;

function baseDir() {
  const uploads = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
  return path.resolve(process.env.CRM_FILES_DIR || path.join(uploads, 'crm-private'));
}
function incomingDir() { return path.join(baseDir(), '.incoming'); }
function ensureDirs() { fs.mkdirSync(incomingDir(), { recursive: true }); }

// Punch list S9: is this request path (relative to /uploads, as the browser sent it) inside the private CRM folder? It is judged AFTER decoding, ignoring case, doubled
// or backslash separators and ".." steps, so "/%63rm-private/x", "/CRM-Private/x", "/crm-private%2fx" and "/a/../crm-private/x" are all caught. A path that will not decode
// is treated as private (refused), not passed on.
function isPrivatePath(rawPath) {
  let p;
  try { p = decodeURIComponent(String(rawPath || '')); } catch { return true; }
  if (p.includes('\0')) return true;
  p = path.posix.normalize(p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')).toLowerCase();
  return /^\/*crm-private(\/|$)/.test(p);
}

function newStoredName() { return `${crypto.randomBytes(16).toString('hex')}.bin`; }

// The absolute path of a stored file, or null if the name is not exactly what this code makes. A name from the database is checked too, so a bad row can
// never read outside the folder.
function pathFor(storedName) {
  if (typeof storedName !== 'string' || !STORED_NAME.test(storedName)) return null;
  const dir = baseDir();
  const full = path.join(dir, storedName);
  return path.dirname(full) === dir ? full : null;
}

// The uploader's filename is only a label. Drop any folder part, control and look-alike direction characters, characters that mean something to a shell or a
// file system, leading dots; collapse spaces; keep it short but keep the extension.
function safeOriginalName(name) {
  let n = String(name == null ? '' : name).normalize('NFC');
  n = n.split(/[\\/]/).pop();
  n = n.replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
  n = n.replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!n) return 'file';
  if (n.length > 120) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
    n = n.slice(0, 120 - ext.length) + ext;
  }
  return n;
}

// Content-Disposition for a download: an ASCII fallback plus the real name encoded per RFC 5987.
function attachmentHeader(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

// What the browser is told the bytes are. Word and Excel share the zip signature, so they go out as plain downloads rather than as a guessed document type.
function servedType(kind, mime) { return kind === 'doc' || kind === 'docx' ? 'application/octet-stream' : mime; }

module.exports = { isPrivatePath, MAX_BYTES, MAX_FILES_PER_SUBJECT, ALLOWED_KINDS, baseDir, incomingDir, ensureDirs, newStoredName, pathFor, safeOriginalName, attachmentHeader, servedType };

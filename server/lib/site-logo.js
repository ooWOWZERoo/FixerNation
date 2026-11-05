const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// The public header and footer show the Website Logo setting. A logo uploaded with a wide blank margin (a stacked mark on a
// big white canvas) prints its lettering far too small at header height, so the public endpoint serves a trimmed copy:
// the blank border cut off, capped at 480 px high. The original upload is never touched, and a failure of any kind falls
// back to the original address.
const memo = new Map();

function uploadsDir() { return process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'); }
function urlPrefix() { return process.env.UPLOADS_URL_PREFIX || '/uploads/'; }

// The file name of an upload, for an address that points straight into the uploads folder; null for anything else
// (other sites, sub-folders, "..", hidden files).
function uploadName(url) {
  if (!url || typeof url !== 'string') return null;
  const prefix = urlPrefix();
  const rel = url.startsWith(prefix) ? url.slice(prefix.length) : (url.startsWith(prefix.replace(/^\//, '')) ? url.slice(prefix.length - 1) : null);
  return rel && /^[\w.-]+$/.test(rel) && !rel.startsWith('.') ? rel : null;
}

async function trimmedLogoUrl(url) {
  if (!url || typeof url !== 'string') return url || '';
  const prefix = urlPrefix();
  const rel = uploadName(url);
  if (!rel) return url;
  const src = path.join(uploadsDir(), rel);
  const outName = 'site-logo-' + rel.replace(/\.[^.]+$/, '') + '.png';
  const out = path.join(uploadsDir(), outName);
  const outUrl = prefix + outName;
  try {
    const srcStat = fs.statSync(src);
    const key = url + '|' + srcStat.mtimeMs;
    if (memo.has(key)) return memo.get(key);
    let fresh = false;
    try { fresh = fs.statSync(out).mtimeMs >= srcStat.mtimeMs; } catch { /* not made yet */ }
    if (!fresh) {
      const tmp = out + '.' + process.pid + '.tmp';
      await sharp(src, { limitInputPixels: 40e6 })
        .trim({ threshold: 25 })
        .resize({ height: 480, withoutEnlargement: true })
        .png()
        .toFile(tmp);
      fs.renameSync(tmp, out);
    }
    memo.set(key, outUrl);
    return outUrl;
  } catch {
    return url;
  }
}

// A square PNG of the logo for the browser tab (16, 32, 48) and the home-screen icon (180), made from the trimmed copy on a
// white square (a tab can be dark, and Apple wants an opaque icon). Null when there is no usable local logo; the caller then
// sends the built-in favicon instead.
const iconMemo = new Map();
async function faviconPng(url, size) {
  const rel = uploadName(await trimmedLogoUrl(url));
  if (!rel) return null;
  try {
    const file = path.join(uploadsDir(), rel);
    const key = file + '|' + fs.statSync(file).mtimeMs + '|' + size;
    if (iconMemo.has(key)) return iconMemo.get(key);
    const pad = size >= 120 ? Math.round(size * 0.1) : 0;
    const inner = size - 2 * pad;
    const png = await sharp(file, { limitInputPixels: 40e6 })
      .resize({ width: inner, height: inner, fit: 'contain', background: '#ffffff' })
      .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#ffffff' })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
    iconMemo.set(key, png);
    return png;
  } catch {
    return null;
  }
}

module.exports = { trimmedLogoUrl, faviconPng };

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

async function trimmedLogoUrl(url) {
  if (!url || typeof url !== 'string') return url || '';
  const prefix = urlPrefix();
  const rel = url.startsWith(prefix) ? url.slice(prefix.length) : (url.startsWith(prefix.replace(/^\//, '')) ? url.slice(prefix.length - 1) : null);
  // Only a plain file name directly inside the uploads folder; no sub-folders, no "..".
  if (!rel || !/^[\w.-]+$/.test(rel) || rel.startsWith('.')) return url;
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

module.exports = { trimmedLogoUrl };

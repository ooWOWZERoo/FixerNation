const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Uploaded files are served straight from this site's own origin, so a file that
// ends up as .html or .svg is a page that can run script with the site's
// privileges. Both of the things multer hands us for free are attacker-
// controlled: file.mimetype is whatever Content-Type the client sent, and the
// extension in originalname is whatever name they chose. So neither is trusted
// here. The type is decided from the file's own leading bytes ("magic
// numbers"), and the extension it's stored under comes from that detected type.

const SIGNATURES = [
  { kind: 'png',  ext: '.png',  mime: 'image/png',  test: b => b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { kind: 'jpg',  ext: '.jpg',  mime: 'image/jpeg', test: b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'gif',  ext: '.gif',  mime: 'image/gif',  test: b => b.length > 6 && b.slice(0, 4).toString('latin1') === 'GIF8' },
  { kind: 'webp', ext: '.webp', mime: 'image/webp', test: b => b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP' },
  { kind: 'pdf',  ext: '.pdf',  mime: 'application/pdf', test: b => b.length > 5 && b.slice(0, 5).toString('latin1') === '%PDF-' },
  // Legacy Word (.doc) is an OLE compound file.
  { kind: 'doc',  ext: '.doc',  mime: 'application/msword', test: b => b.length > 8 && b.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  // .docx is a zip container; every zip starts "PK\x03\x04". Callers only allow
  // this kind where a Word document is expected, and a zip is never served inline.
  { kind: 'docx', ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  // AVIF also uses the ISO base media container, so it must be matched before mp4.
  { kind: 'avif', ext: '.avif', mime: 'image/avif', test: b => b.length > 12 && b.slice(4, 8).toString('latin1') === 'ftyp' && ['avif', 'avis'].includes(b.slice(8, 12).toString('latin1')) },
  // ISO base media (mp4/mov): "ftyp" at byte 4. Brand "qt  " is QuickTime.
  { kind: 'mov',  ext: '.mov',  mime: 'video/quicktime', test: b => b.length > 12 && b.slice(4, 8).toString('latin1') === 'ftyp' && b.slice(8, 12).toString('latin1') === 'qt  ' },
  { kind: 'mp4',  ext: '.mp4',  mime: 'video/mp4',  test: b => b.length > 12 && b.slice(4, 8).toString('latin1') === 'ftyp' },
  { kind: 'webm', ext: '.webm', mime: 'video/webm', test: b => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
];

const IMAGE_KINDS = new Set(['png', 'jpg', 'gif', 'webp', 'avif']);

// Detects the real type from the first bytes on disk. Returns { kind, ext, mime }
// or null if it isn't a type this site accepts at all.
function sniffFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    const head = buf.slice(0, n);
    const hit = SIGNATURES.find(sig => sig.test(head));
    return hit ? { kind: hit.kind, ext: hit.ext, mime: hit.mime } : null;
  } finally {
    fs.closeSync(fd);
  }
}

// Verifies an uploaded temp file against an allowlist of detected kinds and moves
// it to <dir>/<baseName><detected ext>. On any rejection the temp file is
// deleted and an Error with a user-safe message is thrown.
function finalizeUpload(file, { allowedKinds, dir, baseName }) {
  const detected = sniffFile(file.path);
  if (!detected || !allowedKinds.has(detected.kind)) {
    try { fs.unlinkSync(file.path); } catch { /* already gone */ }
    throw new Error('That file type isn\'t supported.');
  }
  const filename = baseName + detected.ext;
  fs.renameSync(file.path, path.join(dir, filename));
  return { filename, ext: detected.ext, mime: detected.mime, kind: detected.kind };
}

// For images from low-trust users (avatars, community uploads): decode and
// re-encode as WebP. A file that merely *starts* like an image but carries
// HTML/script after it (a polyglot) cannot survive being decoded to pixels and
// re-written, and EXIF/GPS metadata is dropped as a privacy bonus. Throws if
// the bytes aren't a decodable raster image. Returns the encoded Buffer.
async function reencodeImageToWebp(inputPath, { maxDimension = 1600 } = {}) {
  return sharp(inputPath, { limitInputPixels: 40e6, animated: true })
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}

module.exports = { sniffFile, finalizeUpload, reencodeImageToWebp, IMAGE_KINDS };

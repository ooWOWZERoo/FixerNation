const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { finalizeUpload } = require('../lib/upload-safety');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// The client's Content-Type is only a first, cheap filter -- the real decision
// is made from the file's own bytes in finalizeUpload() below. Note what is NOT
// accepted any more: SVG (a script-capable document, not just an image) and
// anything not in the kinds list. Admin sessions are trusted, but a hijacked one
// shouldn't be able to plant a page on the site's own origin.
const ALLOWED_MIME_PATTERN = new RegExp(
  '^(' +
  'image/(png|jpeg|gif|webp|avif)|' +
  'video/|' +
  'application/pdf|' +
  'application/msword|' +
  'application/vnd\\.openxmlformats-officedocument\\.wordprocessingml\\.document' +
  ')'
);
const ALLOWED_KINDS = new Set(['png', 'jpg', 'gif', 'webp', 'avif', 'mp4', 'mov', 'webm', 'pdf', 'doc', 'docx']);

// Written under a neutral temp name with NO user-chosen extension; the real
// extension is assigned from the detected file type once it's verified.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`),
});

const upload = multer({
  storage,
  // Videos can be large (existing book trailers run 30-49MB); the hosting
  // provider's own reverse proxy may enforce a lower ceiling than this —
  // if so, uploads will fail there rather than here.
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_PATTERN.test(file.mimetype)) {
      return cb(new Error('Unsupported file type: ' + file.mimetype));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.post('/', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const baseName = req.file.filename.replace(/\.part$/, '');
  let saved;
  try {
    saved = finalizeUpload(req.file, { allowedKinds: ALLOWED_KINDS, dir: uploadsDir, baseName });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const urlPrefix = process.env.UPLOADS_URL_PREFIX || '/uploads/';
  res.status(201).json({ filename: saved.filename, url: urlPrefix + saved.filename });
});

router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Upload failed' });
});

module.exports = router;

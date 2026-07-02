const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME_PATTERN = new RegExp(
  '^(' +
  'image/|' +
  'video/|' +
  'application/pdf|' +
  'application/msword|' +
  'application/vnd\\.openxmlformats-officedocument\\.wordprocessingml\\.document' +
  ')'
);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
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
  const urlPrefix = process.env.UPLOADS_URL_PREFIX || '/uploads/';
  res.status(201).json({ filename: req.file.filename, url: urlPrefix + req.file.filename });
});

router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Upload failed' });
});

module.exports = router;

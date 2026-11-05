// Fonts and the PDF viewer are served from our own server, so a student's browser never contacts
// Google or Cloudflare (Release 104). What must hold: no public page or shared script points at
// those hosts, fonts.css only names files that exist, and the PDF viewer's script and worker exist.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BANNED = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com/;

const rootFiles = fs.readdirSync(ROOT).filter((f) => /\.(html|js|css)$/.test(f));

test('no page or shared script loads Google Fonts or cdnjs', () => {
  const offenders = rootFiles.filter((f) => BANNED.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(offenders, []);
});

test('every font file named in fonts.css exists and is a real woff2', () => {
  const css = fs.readFileSync(path.join(ROOT, 'fonts.css'), 'utf8');
  const urls = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 6);
  for (const u of urls) {
    const buf = fs.readFileSync(path.join(ROOT, u));
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'wOF2', u);
  }
});

test('pages that used Google Fonts load fonts.css instead', () => {
  const pages = rootFiles.filter((f) => f.endsWith('.html'));
  const withFonts = pages.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('fonts.css?v='));
  assert.ok(withFonts.length >= 100);
  for (const must of ['student-home.html', 'student-lesson.html', 'student-login.html', 'parent-lesson.html', 'teacher-login.html']) {
    assert.ok(withFonts.includes(must), must);
  }
});

test('the PDF viewer loads its script and worker from our own server', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pdf-modal.js'), 'utf8');
  for (const name of ['pdf.min.js', 'pdf.worker.min.js']) {
    assert.ok(src.includes(`vendor/pdfjs/3.11.174/${name}`), name);
    assert.ok(fs.existsSync(path.join(ROOT, 'vendor', 'pdfjs', '3.11.174', name)), name);
  }
});

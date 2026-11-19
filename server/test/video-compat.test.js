// Upload format check for videos: a phone plays HEVC (H.265), many classroom casting devices, smart boards and older computers show a black screen. The upload is kept exactly as sent;
// the admin is only warned. Real code on synthetic MP4s (and real ffmpeg output when ffmpeg is there). Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const env = require('./helpers/crm-env');

const UP = fs.mkdtempSync(path.join(os.tmpdir(), 'fne-video-compat-'));
process.env.UPLOADS_DIR = UP;
const V = require(path.join(env.SERVER, 'lib/video-compat.js'));

// ---- tiny MP4 builder -------------------------------------------------------------------------------------------------------------
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const box = (type, ...p) => { const body = Buffer.concat(p); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); };
const full = (type, ...p) => box(type, Buffer.alloc(4), ...p);
const avcC = (profile, level) => box('avcC', Buffer.from([1, profile, 0, level, 0xff, 0xe1]));
const entry = (fourcc, extra = Buffer.alloc(0)) => Buffer.concat([u32(8 + 78 + extra.length), Buffer.from(fourcc, 'latin1'), Buffer.alloc(78), extra]);
const trak = (handler, fourcc, { w = 0, h = 0, extra } = {}) => box('trak',
  full('tkhd', Buffer.alloc(76), u32(w << 16), u32(h << 16)),
  box('mdia', full('hdlr', u32(0), Buffer.from(handler, 'latin1'), Buffer.alloc(12)), box('minf', box('stbl', full('stsd', u32(1), entry(fourcc, extra))))));
const video = (o = {}) => {
  const fourcc = o.fourcc || 'avc1';
  const extra = fourcc === 'avc1' || fourcc === 'avc3' ? avcC(o.profile === undefined ? 100 : o.profile, o.level === undefined ? 41 : o.level) : Buffer.alloc(0);
  return trak('vide', fourcc, { w: o.w || 1920, h: o.h || 1080, extra });
};
const audio = (fourcc = 'mp4a') => trak('soun', fourcc);
function mp4(o = {}) {
  const ftyp = box('ftyp', Buffer.from(o.brand || 'isom', 'latin1'), u32(512), Buffer.from('isomiso2', 'latin1'));
  const moov = box('moov', full('mvhd', Buffer.alloc(96)), ...(o.tracks || [video(), audio()]));
  const mdat = box('mdat', Buffer.alloc(300));
  return Buffer.concat(o.moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}
const tmp = (buf, name = 'v.mp4') => { const p = path.join(UP, `t-${Math.random().toString(16).slice(2)}-${name}`); fs.writeFileSync(p, buf); return p; };
const warn = (buf) => V.compatWarnings(V.inspectVideo(tmp(buf))).map(w => w.code);

test('A GOOD VIDEO: H.264 High 4.1, 1080p, AAC, index first gives no warning, and the facts are read correctly', () => {
  const info = V.inspectVideo(tmp(mp4()));
  assert.equal(info.readable, true); assert.equal(info.container, 'mp4'); assert.equal(info.faststart, true);
  assert.deepEqual({ ...info.video }, { codec: 'h264', fourcc: 'avc1', profile: 100, profileName: 'High', level: 4.1, width: 1920, height: 1080 });
  assert.deepEqual({ ...info.audio }, { codec: 'aac', fourcc: 'mp4a' });
  assert.deepEqual(V.compatWarnings(info), []);
  for (const [profile, level] of [[66, 30], [77, 40], [100, 42], [100, 31]]) assert.deepEqual(warn(mp4({ tracks: [video({ profile, level }), audio()] })), [], `profile ${profile} level ${level}`);
  assert.deepEqual(warn(mp4({ tracks: [video({ w: 1080, h: 1920 }), audio()] })), [], 'a vertical 1080 by 1920 video is not "bigger than 1080p"');
  assert.deepEqual(warn(mp4({ tracks: [video({ w: 640, h: 360 })] })), [], 'no sound track is fine');
});

test('HEVC IS THE ONE THAT BLACKED OUT THE CLASSROOM: hvc1 and hev1 warn in plain words with the fix; it also says the index is at the end when it is', () => {
  for (const fourcc of ['hvc1', 'hev1']) {
    const w = V.compatWarnings(V.inspectVideo(tmp(mp4({ tracks: [video({ fourcc }), audio()] }))));
    assert.deepEqual(w.map(x => x.code), ['hevc']);
    assert.match(w[0].text, /HEVC \(H\.265\)/); assert.match(w[0].text, /black screen/); assert.match(w[0].text, /H\.264/);
  }
  assert.deepEqual(warn(mp4({ tracks: [video({ fourcc: 'hvc1' }), audio()], moovLast: true })), ['hevc', 'faststart'], 'the live files had exactly these two problems');
});

test('OTHER THINGS THAT FAIL ON DEVICES: newer codecs, advanced H.264 settings, oversize, odd sound, no fast start, QuickTime files', () => {
  assert.deepEqual(warn(mp4({ tracks: [video({ fourcc: 'av01' })] })), ['new_codec']); assert.deepEqual(warn(mp4({ tracks: [video({ fourcc: 'vp09' })] })), ['new_codec']);
  assert.deepEqual(warn(mp4({ tracks: [video({ fourcc: 'mp4v' })] })), ['other_codec']);
  assert.deepEqual(warn(mp4({ tracks: [video({ profile: 110 })] })), ['h264_profile']); assert.deepEqual(warn(mp4({ tracks: [video({ profile: 244 })] })), ['h264_profile']);
  assert.deepEqual(warn(mp4({ tracks: [video({ level: 51 })] })), ['h264_level']);
  assert.deepEqual(warn(mp4({ tracks: [video({ w: 3840, h: 2160, level: 51 })] })).sort(), ['h264_level', 'too_big']);
  assert.deepEqual(warn(mp4({ tracks: [video(), audio('ac-3')] })), ['audio']); assert.deepEqual(warn(mp4({ tracks: [video(), audio('alac')] })), ['audio']);
  assert.deepEqual(warn(mp4({ moovLast: true })), ['faststart']);
  assert.deepEqual(warn(mp4({ brand: 'qt  ' })), ['mov']);
  assert.match(V.compatWarnings(V.inspectVideo(tmp(mp4({ moovLast: true }))))[0].text, /faststart/);
});

test('A FILE IT CANNOT READ: one plain warning, never a crash and never a refusal (empty, garbage, cut short, no index, absurdly large index)', () => {
  const good = mp4();
  const cases = { empty: Buffer.alloc(0), garbage: Buffer.from('this is not a video at all, just text'), cutShort: mp4({ moovLast: true }).slice(0, mp4({ moovLast: true }).length - 40), onlyFtyp: good.slice(0, 24), noMoov: Buffer.concat([good.slice(0, 24), box('mdat', Buffer.alloc(50))]) };
  for (const [name, buf] of Object.entries(cases)) {
    const info = V.inspectVideo(tmp(buf));
    assert.equal(info.readable, false, name); assert.deepEqual(V.compatWarnings(info).map(x => x.code), ['unreadable'], name);
  }
  assert.equal(V.inspectVideo(path.join(UP, 'does-not-exist.mp4')).readable, false, 'a missing file does not throw');
  const bigPath = tmp(Buffer.concat([good.slice(0, 24), u32(V.MAX_MOOV + 100), Buffer.from('moov'), Buffer.alloc(32)])); fs.truncateSync(bigPath, 24 + V.MAX_MOOV + 100); // a real (sparse) index bigger than the limit
  assert.equal(V.inspectVideo(bigPath).reason, 'moov_too_big'); fs.unlinkSync(bigPath);
  assert.deepEqual(V.compatWarnings(null), []);
});

test('IT NEVER READS THE PICTURE DATA: a 600 MB file whose index is at the front is checked at once, reading only the headers and the index', () => {
  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512)), moov = box('moov', ...[video({ fourcc: 'hvc1' }), audio()]);
  const header = Buffer.concat([ftyp, moov]); const size = 600 * 1024 * 1024;
  const p = tmp(Buffer.alloc(0)); const fd = fs.openSync(p, 'w');
  fs.writeSync(fd, header); fs.writeSync(fd, Buffer.concat([u32(size - header.length), Buffer.from('mdat', 'latin1')])); fs.ftruncateSync(fd, size); fs.closeSync(fd);
  const t = Date.now(); const info = V.inspectVideo(p);
  assert.ok(Date.now() - t < 500, 'fast'); assert.equal(info.video.codec, 'hevc'); assert.equal(info.faststart, true);
  fs.unlinkSync(p);
});

test('REAL FILES (when ffmpeg is on this machine): an ffmpeg H.264 file with fast start is clean, the same without fast start says so, and the dimensions are right', { skip: !fs.existsSync(path.join(env.SERVER, '..', 'tests/node_modules/ffmpeg-static/ffmpeg')) }, () => {
  const ff = path.join(env.SERVER, '..', 'tests/node_modules/ffmpeg-static/ffmpeg');
  const make = (name, extra) => { const out = path.join(UP, name); execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '1', '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...extra, out]); return out; };
  const fast = V.inspectVideo(make('real-fast.mp4', ['-movflags', '+faststart'])), slow = V.inspectVideo(make('real-slow.mp4', []));
  assert.deepEqual(V.compatWarnings(fast), []); assert.deepEqual({ codec: fast.video.codec, profile: fast.video.profileName, level: fast.video.level, w: fast.video.width, h: fast.video.height, audio: fast.audio.codec }, { codec: 'h264', profile: 'High', level: 4.1, w: 640, h: 360, audio: 'aac' });
  assert.equal(fast.faststart, true); assert.deepEqual(V.compatWarnings(slow).map(x => x.code), ['faststart']);
});

// ---- the upload route ---------------------------------------------------------------------------------------------------------------
const { db, pool } = env.makeDb();
env.install(pool);
const { server } = env.listen([['/api/uploads', require(path.join(env.SERVER, 'routes/uploads.js'))]]);
const port = server.address().port;
test.after(() => { server.close(); fs.rmSync(UP, { recursive: true, force: true }); });
env.enable(db, true);
const admin = env.addAdmin(db, 'vidboss', 'admin');
const upload = (buf, name, type) => new Promise((resolve, reject) => {
  const boundary = '----vc' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const r = http.request({ port, method: 'POST', path: '/api/uploads', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, 'x-admin': String(admin) } }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') })); });
  r.on('error', reject); r.end(body);
});

test('THE UPLOAD ROUTE: an HEVC video is accepted exactly as sent and comes back with the warning and its facts; a good one comes back with none; images and refusals are untouched', async () => {
  const hevc = mp4({ tracks: [video({ fourcc: 'hvc1' }), audio()], moovLast: true });
  const r = await upload(hevc, 'trailer.mp4', 'video/mp4');
  assert.equal(r.status, 201); assert.match(r.json.url, /^\/uploads\/.+\.mp4$/);
  assert.equal(r.json.warnings.length, 2); assert.match(r.json.warnings[0], /HEVC \(H\.265\)/); assert.match(r.json.warnings[1], /faststart/);
  assert.deepEqual({ ...r.json.video }, { codec: 'hevc', profile: null, level: null, width: 1920, height: 1080, audio: 'aac', faststart: false });
  assert.ok(fs.readFileSync(path.join(UP, r.json.filename)).equals(hevc), 'the file on disk is byte for byte what was uploaded');

  const good = await upload(mp4(), 'good.mp4', 'video/mp4');
  assert.equal(good.status, 201); assert.deepEqual(good.json.warnings, []); assert.equal(good.json.video.codec, 'h264');

  const mov = await upload(mp4({ brand: 'qt  ' }), 'clip.mov', 'video/quicktime');
  assert.equal(mov.status, 201); assert.deepEqual(mov.json.warnings.length, 1); assert.match(mov.json.warnings[0], /QuickTime/);

  const broken = await upload(mp4().slice(0, 24), 'broken.mp4', 'video/mp4');
  assert.equal(broken.status, 201, 'a video that cannot be read is still kept'); assert.equal(broken.json.warnings.length, 1); assert.match(broken.json.warnings[0], /could not read/);

  const png = await upload(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]), 'a.png', 'image/png');
  assert.equal(png.status, 201); assert.equal('warnings' in png.json, false); assert.equal('video' in png.json, false);
  assert.equal((await upload(Buffer.from('<html>hi</html>'), 'x.html', 'text/html')).status, 400);
  assert.equal((await upload(Buffer.from('not a video'), 'fake.mp4', 'video/mp4')).status, 400, 'bytes, not the name or the type, decide');
});

test('THE ADMIN PAGE: fnUploadFile shows the warnings, the notice stays until closed and is built without innerHTML, and the shared script version was bumped everywhere', () => {
  const read = (f) => fs.readFileSync(path.join(env.SERVER, '..', f), 'utf8');
  const js = read('admin-common.js');
  assert.match(js, /data\.warnings\.length\) fnNotice\(/);
  const fn = js.slice(js.indexOf('function fnNotice'), js.indexOf('function fnFormatAddress'));
  assert.match(fn, /textContent = String\(t\)/); assert.doesNotMatch(fn, /innerHTML|insertAdjacentHTML/); assert.match(fn, /Got it/);
  assert.doesNotThrow(() => new Function(js));
  const pages = fs.readdirSync(path.join(env.SERVER, '..')).filter(f => f.endsWith('.html') && /admin-common\.js\?v=/.test(read(f)));
  assert.ok(pages.length > 80, `${pages.length} pages load admin-common.js`);
  for (const f of pages) assert.match(read(f), /admin-common\.js\?v=18/, f);
  for (const f of ['lib/video-compat.js', 'routes/uploads.js']) execFileSync(process.execPath, ['--check', path.join(env.SERVER, f)]);
  assert.doesNotMatch(fs.readFileSync(path.join(env.SERVER, 'lib/video-compat.js'), 'utf8').replace(/\/\/.*$/gm, ''), /writeFile|unlink|rename|spawn|exec\(/, 'it only reads');
});

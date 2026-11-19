// Does an uploaded video play on the devices teachers actually use? A teacher's casting black screen was traced to files encoded as HEVC (H.265): a phone plays them, many classroom
// casting devices, smart boards and older computers cannot. This reads an MP4 or MOV's own "table of contents" (the moov box) and says, in plain words, what is likely to go wrong.
//
// Rules this file keeps (each has a test):
//  - It only WARNS. The upload is never refused or changed because of what is in here; a person decides what to do with the warning.
//  - It reads only the box headers and the moov box (never the picture data), capped at MAX_MOOV bytes, so a large video costs a few reads, not its full size.
//  - A file it cannot read (cut short, no moov, odd structure) says so with one warning and never throws.
//  - Plain words, no jargon beyond the format names, and the same advice every time: re-save as H.264 (High profile, 1080p or smaller) with fast start.
const fs = require('fs');

const MAX_MOOV = 16 * 1024 * 1024;
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
const H264_PROFILES = { 66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High', 110: 'High 10', 122: 'High 4:2:2', 244: 'High 4:4:4', 44: 'CAVLC 4:4:4' };
const SAFE_PROFILES = new Set([66, 77, 100]);
const VIDEO_NAMES = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', dvh1: 'hevc', dvhe: 'hevc', av01: 'av1', vp09: 'vp9', mp4v: 'mpeg4' };
const AUDIO_NAMES = { mp4a: 'aac', 'ac-3': 'ac3', 'ec-3': 'eac3', alac: 'alac', Opus: 'opus', fLaC: 'flac', sowt: 'pcm', twos: 'pcm' };

const readAt = (fd, pos, len) => { const b = Buffer.alloc(len); const n = fs.readSync(fd, b, 0, len, pos); return b.slice(0, n); };

// Top-level boxes of the file, read by header only.
function topLevel(fd, size) {
  const out = []; let pos = 0, guard = 0;
  while (pos + 8 <= size && guard++ < 200) {
    const h = readAt(fd, pos, 16);
    if (h.length < 8) break;
    let sz = h.readUInt32BE(0), hdr = 8;
    const type = h.toString('latin1', 4, 8);
    if (sz === 1) { if (h.length < 16) break; sz = Number(h.readBigUInt64BE(8)); hdr = 16; }
    else if (sz === 0) sz = size - pos;
    if (sz < hdr) break;
    out.push({ type, pos, size: sz, hdr, cut: pos + sz > size });
    pos += sz;
  }
  return out;
}

// The boxes inside buf[start, end).
function kids(buf, start, end) {
  const out = []; let p = start;
  while (p + 8 <= end) {
    let sz = buf.readUInt32BE(p), hdr = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (sz === 1) { if (p + 16 > end) break; sz = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; }
    else if (sz === 0) sz = end - p;
    if (sz < hdr || p + sz > end) break;
    out.push({ type, start: p + hdr, end: p + sz });
    p += sz;
  }
  return out;
}
const find = (list, type) => list.find(b => b.type === type);

function trackInfo(buf, trak) {
  const parts = kids(buf, trak.start, trak.end);
  const tkhd = find(parts, 'tkhd'), mdia = find(parts, 'mdia');
  if (!mdia) return null;
  const m = kids(buf, mdia.start, mdia.end);
  const hdlr = find(m, 'hdlr'), minf = find(m, 'minf');
  if (!hdlr || !minf || hdlr.end - hdlr.start < 12) return null;
  const handler = buf.toString('latin1', hdlr.start + 8, hdlr.start + 12);
  const stbl = find(kids(buf, minf.start, minf.end), 'stbl');
  const stsd = stbl && find(kids(buf, stbl.start, stbl.end), 'stsd');
  let fourcc = null, entry = null;
  if (stsd && stsd.end - stsd.start >= 16) {
    const esz = buf.readUInt32BE(stsd.start + 8);
    fourcc = buf.toString('latin1', stsd.start + 12, stsd.start + 16);
    entry = buf.slice(stsd.start + 8, Math.min(stsd.end, stsd.start + 8 + esz));
  }
  let width = null, height = null;
  if (tkhd && tkhd.end - tkhd.start >= 8) { width = buf.readUInt32BE(tkhd.end - 8) >>> 16; height = buf.readUInt32BE(tkhd.end - 4) >>> 16; }
  return { handler, fourcc, entry, width, height };
}

// -> { readable, container, faststart, video: { codec, fourcc, profile, profileName, level, width, height }|null, audio: { codec, fourcc }|null, reason }
function inspectVideo(filePath) {
  const out = { readable: false, container: null, faststart: null, video: null, audio: null, reason: null };
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const top = topLevel(fd, size);
    const ftyp = top.find(b => b.type === 'ftyp');
    if (!ftyp) { out.reason = 'no_ftyp'; return out; }
    out.container = readAt(fd, ftyp.pos + ftyp.hdr, 4).toString('latin1').trim() === 'qt' ? 'mov' : 'mp4';
    const moov = top.find(b => b.type === 'moov'), mdat = top.find(b => b.type === 'mdat');
    if (!moov || moov.cut) { out.reason = 'no_moov'; return out; } // cut short, or never finished writing
    if (moov.size > MAX_MOOV) { out.reason = 'moov_too_big'; return out; }
    out.faststart = mdat ? moov.pos < mdat.pos : true;
    const buf = readAt(fd, moov.pos, moov.size);
    for (const trak of kids(buf, moov.hdr, buf.length).filter(b => b.type === 'trak')) {
      const t = trackInfo(buf, trak);
      if (!t || !t.fourcc) continue;
      if (t.handler === 'vide' && !out.video) {
        const v = { codec: VIDEO_NAMES[t.fourcc] || t.fourcc, fourcc: t.fourcc, profile: null, profileName: null, level: null, width: t.width || null, height: t.height || null };
        const i = t.entry ? t.entry.indexOf('avcC', 0, 'latin1') : -1;
        if (i >= 0 && i + 8 <= t.entry.length) { v.profile = t.entry[i + 5]; v.profileName = H264_PROFILES[v.profile] || String(v.profile); v.level = t.entry[i + 7] / 10; }
        out.video = v;
      } else if (t.handler === 'soun' && !out.audio) out.audio = { codec: AUDIO_NAMES[t.fourcc] || t.fourcc, fourcc: t.fourcc };
    }
    out.readable = true;
    return out;
  } catch (err) {
    out.reason = 'error';
    return out;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* already closed */ } }
  }
}

const ADVICE = 'Re-save it as H.264 (High profile, 1080p or smaller) before using it.';

// info (from inspectVideo) -> [{ code, text }]. Empty means nothing to warn about.
function compatWarnings(info) {
  const w = [];
  if (!info || !info.readable) {
    if (info && info.reason) w.push({ code: 'unreadable', text: 'We could not read this video’s format, so we cannot tell whether it will play on classroom casting devices. Test it on one before relying on it.' });
    return w;
  }
  const v = info.video;
  if (v) {
    if (v.codec === 'hevc') w.push({ code: 'hevc', text: `This video is HEVC (H.265). It plays on phones and recent Macs, but many classroom casting devices, smart boards and older computers show a black screen. ${ADVICE}` });
    else if (v.codec === 'av1' || v.codec === 'vp9') w.push({ code: 'new_codec', text: `This video uses a newer format (${v.codec === 'av1' ? 'AV1' : 'VP9'}) that older devices cannot play. ${ADVICE}` });
    else if (v.codec !== 'h264') w.push({ code: 'other_codec', text: `This video uses a format (${v.fourcc}) that many devices cannot play. ${ADVICE}` });
    else {
      if (v.profile !== null && !SAFE_PROFILES.has(v.profile)) w.push({ code: 'h264_profile', text: `This video uses an advanced H.264 setting (${v.profileName}) that some casting devices cannot play. High profile is safest. ${ADVICE}` });
      else if (v.level !== null && v.level > 4.2) w.push({ code: 'h264_level', text: `This video is set for a higher H.264 level (${v.level}) than most casting devices handle (4.1 is safe). ${ADVICE}` });
    }
    if (v.width && v.height && (Math.max(v.width, v.height) > 1920 || Math.min(v.width, v.height) > 1080)) w.push({ code: 'too_big', text: `This video is ${v.width} by ${v.height}, larger than 1080p. Many casting devices cannot play anything bigger than 1920 by 1080. ${ADVICE}` });
  }
  if (info.audio && !['aac', 'mp3'].includes(info.audio.codec)) w.push({ code: 'audio', text: `The sound in this video (${info.audio.fourcc}) is not AAC, so it may be silent on some devices. Re-save it with AAC audio.` });
  if (info.faststart === false) w.push({ code: 'faststart', text: 'This video’s index is at the end of the file, so playback starts slowly (the whole file has to load first). Re-save it with "fast start" (the ffmpeg option -movflags +faststart).' });
  if (info.container === 'mov') w.push({ code: 'mov', text: 'This is a QuickTime (.mov) file. It plays on Apple devices but not everywhere. Save it as an MP4.' });
  return w;
}

module.exports = { inspectVideo, compatWarnings, MAX_MOOV };

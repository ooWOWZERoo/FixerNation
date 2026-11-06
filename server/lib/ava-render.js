// Renders one spoken line with the macOS voice "Ava (Premium)" (the same voice as the how-to videos) into a small mp3, for the games.
// macOS only: it needs `say` and `afinfo`, and tests/node_modules/ffmpeg-static for encoding. Used by build-sound-safari.js and
// build-discover-audio.js; the clips are committed, so nothing on the live site ever runs this.
//
// Every clip gets a little silence before and after, so a browser starting or stopping playback never clips the first consonant or
// the last sound, and is brought to the same peak level so quiet sounds ("mmm") are as loud as sentences.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const VOICE = 'Ava (Premium)';
const LEAD_MS = 150, TAIL_S = 0.25, PEAK_DB = -1.5;

function seconds(file) {
  const r = spawnSync('afinfo', [file], { encoding: 'utf8' });
  const m = /estimated duration:\s*([\d.]+)/.exec(r.stdout || '');
  return m ? Number(m[1]) : 0;
}

// Returns a function render({ text, rate, minSeconds }, destFile) and a done() that removes the scratch folder.
function renderer() {
  if (process.platform !== 'darwin') throw new Error('Rendering the voice needs macOS with the "Ava (Premium)" voice installed.');
  const ffmpeg = require(path.join(ROOT, 'tests', 'node_modules', 'ffmpeg-static'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ava-render-'));
  const run = (args) => { const r = spawnSync(ffmpeg, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`); return r.stderr; };
  let n = 0;
  function render({ text, rate, minSeconds }, dest) {
    const id = `c${n++}`;
    const aiff = path.join(tmp, `${id}.aiff`);
    const r = spawnSync('say', ['-v', VOICE, '-r', String(rate), '-o', aiff, text], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`say failed for "${text}": ${r.stderr}`);
    // An isolated sound that is still short is slowed down (pitch kept) until it is long enough to hear.
    let tempo = 1;
    if (minSeconds) tempo = Math.max(0.5, Math.min(1, seconds(aiff) / minSeconds));
    const wav = path.join(tmp, `${id}.wav`);
    const filters = [tempo < 1 ? `atempo=${tempo.toFixed(3)}` : null, `adelay=${LEAD_MS}:all=1`, `apad=pad_dur=${TAIL_S}`].filter(Boolean).join(',');
    run(['-y', '-loglevel', 'error', '-i', aiff, '-af', filters, '-ac', '1', '-ar', '24000', wav]);
    const peak = Number((/max_volume:\s*(-?[\d.]+) dB/.exec(run(['-i', wav, '-af', 'volumedetect', '-f', 'null', '-'])) || [])[1]);
    const gain = Number.isFinite(peak) ? PEAK_DB - peak : 0;
    run(['-y', '-loglevel', 'error', '-i', wav, '-af', `volume=${gain.toFixed(2)}dB`, '-b:a', '56k', dest]);
  }
  return { render, done() { fs.rmSync(tmp, { recursive: true, force: true }); } };
}

module.exports = { renderer, seconds, LEAD_MS };

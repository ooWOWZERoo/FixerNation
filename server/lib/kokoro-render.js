// The game voice: renders spoken lines with Kokoro (voice af_heart, on the CPU) into small mp3 clips. Used by build-discover-audio.js and
// build-sound-safari.js; the clips are committed, so nothing on the live site ever runs this and no student device ever reaches a
// third party. Needs Python 3.10 to 3.12 with the kokoro and soundfile packages (see docs/tune-your-brain/VOICE.md) and
// tests/node_modules/ffmpeg-static for finishing.
//
// Every clip is finished the same way: Kokoro's own silence at each end is trimmed, an isolated sound that is still short can be
// stretched (pitch kept), then a little silence is added at each end so a browser starting or stopping playback never clips the first
// consonant or the last sound, and the clip is brought to the same peak level so quiet sounds ("mmm") are as loud as sentences.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const VOICE = 'af_heart';
const SPEED = 0.72;       // sentences, questions, words: about 145 words a minute, natural for kindergarten to 2nd grade
const SOUND_SPEED = 0.6;  // an isolated sound ("buh", "mmm") is said slowly, then stretched further below if it is still short
const LEAD_MS = 150, TAIL_S = 0.25, PEAK_DB = -1.5;
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse';

function pythonPath() {
  return process.env.KOKORO_PYTHON || path.join(ROOT, 'tests', 'howto-out', 'kokoro-pilot', '.venv-kokoro', 'bin', 'python');
}
const SETUP = 'Kokoro needs Python 3.10 to 3.12 (not 3.13) with the kokoro and soundfile packages. See docs/tune-your-brain/VOICE.md for the setup, or set KOKORO_PYTHON to a Python that has them.';

function ffmpegPath() { return require(path.join(ROOT, 'tests', 'node_modules', 'ffmpeg-static')); }
function ff(args) { const r = spawnSync(ffmpegPath(), args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${r.stderr}`); return r.stderr; }
function seconds(file) {
  const r = spawnSync(ffmpegPath(), ['-i', file], { encoding: 'utf8' });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr || '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// A very short line on its own (a lone letter, "buh") comes out rushed or flat, because the voice has no sentence around it to lean on.
// With keepLast the line is rendered inside a short carrier ("Letter. [B](/bˈi/).") and only the audio after the last pause inside it is kept.
function keepAfterLastPause(wav, out) {
  const r = spawnSync(ffmpegPath(), ['-i', wav, '-af', 'silencedetect=noise=-40dB:d=0.12', '-f', 'null', '-'], { encoding: 'utf8' });
  const total = seconds(wav);
  const ends = [...(r.stderr || '').matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => t < total - 0.1);
  const from = ends.length ? ends[ends.length - 1] : 0;
  ff(['-y', '-loglevel', 'error', '-ss', String(Math.max(0, from - 0.02)), '-i', wav, '-ac', '1', '-ar', '24000', out]);
}

// specs: [{ dest, text, speed?, minSeconds?, keepLast?, extract?, hold? }]. extract: 'nasal' | 'fricative' | 'voiced-fricative' renders `text` (a word)
// and keeps only its first sound; hold (seconds) then holds that sound (scripts/kokoro/render_kokoro.py).  text may hold [word](/phonemes/) pronunciations (see lib/voice-text.js).
// Returns { made, phonemes: { dest: "what Kokoro decided the line sounds like" } }.
function renderAll(specs) {
  if (!specs.length) return { made: 0, phonemes: {}, cuts: {} };
  const py = pythonPath();
  if (!fs.existsSync(py)) throw new Error(`No Python at ${py}. ${SETUP}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kokoro-render-'));
  try {
    const jobs = specs.map((s, i) => ({ id: `c${i}`, text: s.text, speed: s.speed || SPEED, extract: s.extract, sustain: s.hold, synth: s.synth, seconds: s.seconds }));
    fs.writeFileSync(path.join(tmp, 'jobs.json'), JSON.stringify(jobs));
    const wavDir = path.join(tmp, 'wav');
    const r = spawnSync(py, [path.join(__dirname, '..', 'scripts', 'kokoro', 'render_kokoro.py'), path.join(tmp, 'jobs.json'), wavDir, '--voice', VOICE], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error(`Kokoro did not finish (exit ${r.status}). ${SETUP}`);
    const heard = JSON.parse(fs.readFileSync(path.join(wavDir, 'phonemes.json'), 'utf8'));
    const phonemes = {};
    specs.forEach((s, i) => {
      const wav = path.join(wavDir, `c${i}.wav`);
      const trimmed = path.join(tmp, `t${i}.wav`);
      let source = wav;
      if (s.keepLast) { source = path.join(tmp, `k${i}.wav`); keepAfterLastPause(wav, source); }
      ff(['-y', '-loglevel', 'error', '-i', source, '-af', TRIM, '-ac', '1', '-ar', '24000', trimmed]);
      let tempo = 1;
      const body = trimmed;
      if (s.minSeconds && !s.extract) tempo = Math.max(0.5, Math.min(1, seconds(trimmed) / s.minSeconds));
      const padded = path.join(tmp, `p${i}.wav`);
      const filters = [tempo < 1 ? `atempo=${tempo.toFixed(3)}` : null, `adelay=${LEAD_MS}:all=1`, `apad=pad_dur=${TAIL_S}`].filter(Boolean).join(',');
      ff(['-y', '-loglevel', 'error', '-i', body, '-af', filters, '-ac', '1', '-ar', '24000', padded]);
      const peak = Number((/max_volume:\s*(-?[\d.]+) dB/.exec(ff(['-i', padded, '-af', 'volumedetect', '-f', 'null', '-'])) || [])[1]);
      const gain = Number.isFinite(peak) ? PEAK_DB - peak : 0;
      fs.mkdirSync(path.dirname(s.dest), { recursive: true });
      ff(['-y', '-loglevel', 'error', '-i', padded, '-af', `volume=${gain.toFixed(2)}dB`, '-b:a', '56k', s.dest]);
      phonemes[s.dest] = heard[`c${i}`] || '';
    });
    const cuts = fs.existsSync(path.join(wavDir, 'cuts.json')) ? JSON.parse(fs.readFileSync(path.join(wavDir, 'cuts.json'), 'utf8')) : {};
    return { made: specs.length, phonemes, cuts: Object.fromEntries(specs.map((s, i) => [s.dest, cuts[`c${i}`]]).filter((x) => x[1])) };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { renderAll, seconds, pythonPath, VOICE, SPEED, SOUND_SPEED, LEAD_MS };

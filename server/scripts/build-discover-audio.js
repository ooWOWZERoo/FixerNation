// Builds the recorded Ava voice for the audio-led Discover games (Calm Down Corner, Sharing Circle, Helper's Choice, Same and
// Different, Feelings Detective): one small mp3 for every line a game can speak, plus a manifest the game looks lines up in.
//
//   node scripts/build-discover-audio.js            report what is missing (any computer)
//   node scripts/build-discover-audio.js --audio    render the missing clips and write the manifests (macOS with Ava (Premium))
//   node scripts/build-discover-audio.js --audio --force   re-render every clip
//
// How it works: the game page keeps its content as plain text. engine-voice.js (loaded by every Discover game) looks each spoken
// line up in window.FnAudioManifest by its exact text (pictures removed, spaces collapsed) and plays the recorded clip; a line with
// no clip is read by the browser voice, so a game is never silent. This script lists every line each game's engine can speak, names
// each clip after a hash of its text (the same line in two games is one file), and writes assets/audio/discover/<game>.js.
// Change a line in a game, run this with --audio, commit the new clip and manifest. Sound Safari has its own builder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'assets', 'audio', 'discover');
const { extractPack } = require('./audit-brain-games.js');
const sdk = require(path.join(ROOT, 'engine-sdk.js'));

const GAMES = [
  { slug: 'calm-down-corner', engine: 'audioChoice' },
  { slug: 'sharing-circle', engine: 'audioChoice' },
  { slug: 'helpers-choice', engine: 'audioChoice' },
  { slug: 'same-and-different', engine: 'audioChoice' },
  { slug: 'feelings-detective', engine: 'scenarioChoice' },
  // Release 141
  { slug: 'rhyme-time', engine: 'audioChoice' },
  { slug: 'letter-sounds', engine: 'audioChoice' },
  { slug: 'more-or-fewer', engine: 'audioChoice' },
  { slug: 'add-it-up', engine: 'audioChoice' },
  { slug: 'pattern-parade', engine: 'audioChoice' },
  { slug: 'my-feelings-today', engine: 'scenarioChoice' },
  // Release 143
  { slug: 'asking-nicely', engine: 'audioChoice' },
  { slug: 'team-tower', engine: 'audioChoice' },
];
const ENGINE_VERSIONS = { 'engine-audio-choice.js': 7, 'engine-scenario-choice.js': 9, 'engine-voice.js': 1 };
const RATE = '135';       // say -r: slower than the how-to videos (165), natural for kindergarten to 2nd grade
const SHORT_RATE = '120'; // one or two words (picture names, feelings)

// The same rule engine-voice.js applies before it looks a line up.
const clean = (s) => String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

// Every line the engine can speak for this pack.
function linesFor(game, pack) {
  const out = new Set();
  const add = (x) => { const c = clean(x); if (c) out.add(c); };
  if (game.engine === 'audioChoice') {
    add(sdk.t('audRight', 'discover')); add(sdk.t('audMiss', 'discover'));
    for (const it of pack.items) {
      add(it.stimulusText || it.transcript);
      for (const c of it.choices) { add(c.say || c.caption || c.aria); add(c.feedback); }
      add(it.explanation);
    }
  } else {
    const P = Object.assign({}, pack.prompts || {});
    ['cues', 'afterCues', 'pick'].forEach((k) => add(P[k]));
    add('Take another look at the cues, some of them point somewhere else.');
    for (const sc of pack.scenarios) {
      add(sc.context);
      sc.cues.forEach((c) => add(c.text));
      sc.feelings.forEach((f) => { add(f.text); add(f.note); });
      add(sc.reinforcement);
      if (sc.selfCheck) [sc.selfCheck].forEach((c) => addCheck(c));
    }
    if (pack.selfCheck) addCheck(pack.selfCheck);
    // Release 139: the "Your turn" finale speaks its intro, every prompt, every answer and every line a card can say (cards with no {token} in them).
    // A pack can hold several versions of its finale (variants), each with its own intro and first prompt.
    for (const ot of [pack.ownTurn].concat((pack.variants || []).map((v) => v.ownTurn)).filter(Boolean)) {
      add(ot.intro);
      for (const st of ot.steps || []) {
        add(st.prompt); add(st.promptIfNone);
        (st.options || []).forEach((o) => { add(o.text); if (o.card && !/\{/.test(o.card)) add(o.card); });
        if (st.notSure) add(st.notSure.text);
      }
      const res = ot.result || {};
      add(res.emptyLine); add(res.closing);
    }
    function addCheck(c) {
      add(c.prompt); (c.options || []).forEach((o) => add(o.text));
      add(c.bodyPrompt); (c.bodyOptions || []).forEach((o) => add(o.text));
      add(c.closing);
    }
  }
  return [...out];
}

const fileFor = (text) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12) + '.mp3';
const words = (t) => t.split(/\s+/).length;

function plan() {
  const games = GAMES.map((g) => {
    const page = path.join(ROOT, `brain-${g.slug}.html`);
    const pack = extractPack(fs.readFileSync(page, 'utf8'));
    if (!pack) throw new Error(`could not read the pack in brain-${g.slug}.html`);
    return Object.assign({}, g, { page, lines: linesFor(g, pack) });
  });
  const clips = new Map(); // file -> text
  for (const g of games) for (const t of g.lines) clips.set(fileFor(t), t);
  return { games, clips };
}

function manifestSource(game) {
  const body = {};
  for (const t of game.lines.slice().sort()) body[t] = `assets/audio/discover/${fileFor(t)}`;
  return `// Generated by server/scripts/build-discover-audio.js: the recorded Ava clip for each line of ${game.slug}. Do not edit.\n`
    + `window.FnAudioManifest = Object.assign(window.FnAudioManifest || {}, ${JSON.stringify(body, null, 1)});\n`;
}

// A game page loads: the manifest, then engine-voice.js, then its engine. Cache numbers change when a file does.
function ensureTags(file, manifestName, manifestHash) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  for (const [name, v] of Object.entries(ENGINE_VERSIONS)) s = s.replace(new RegExp(`${name.replace('.', '\\.')}\\?v=\\d+`, 'g'), `${name}?v=${v}`);
  if (!/engine-voice\.js/.test(s)) s = s.replace(/(<script src="engine-(?:audio|scenario)-choice\.js\?v=\d+"><\/script>)/, '<script src="engine-voice.js?v=1"></script>\n$1');
  if (manifestName) {
    const tag = `<script src="assets/audio/discover/${manifestName}.js?v=${manifestHash}"></script>`;
    const re = new RegExp(`<script src="assets/audio/discover/${manifestName}\\.js\\?v=[^"]*"></script>`);
    if (re.test(s)) s = s.replace(re, tag);
    else s = s.replace(/(<script src="engine-voice\.js\?v=\d+"><\/script>)/, `${tag}\n$1`);
  }
  if (s !== before) fs.writeFileSync(file, s);
}

function main() {
  const args = process.argv.slice(2);
  const { games, clips } = plan();
  fs.mkdirSync(OUT, { recursive: true });
  const missing = [...clips.keys()].filter((f) => !fs.existsSync(path.join(OUT, f)));
  console.log(`${games.length} games, ${clips.size} different lines, ${missing.length} clip(s) missing.`);
  if (args.includes('--audio')) {
    const { renderer } = require('../lib/ava-render');
    const { render, done } = renderer();
    let made = 0;
    try {
      for (const [file, text] of clips) {
        if (!args.includes('--force') && fs.existsSync(path.join(OUT, file))) continue;
        render({ text, rate: words(text) <= 2 ? SHORT_RATE : RATE }, path.join(OUT, file));
        made++;
      }
    } finally { done(); }
    console.log(`Rendered ${made} clip(s).`);
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !clips.has(f)) fs.rmSync(path.join(OUT, f));
  }
  for (const g of games) {
    const src = manifestSource(g);
    fs.writeFileSync(path.join(OUT, `${g.slug}.js`), src);
    ensureTags(g.page, g.slug, crypto.createHash('sha1').update(src).digest('hex').slice(0, 8));
  }
  // Every page that uses either engine needs the shared voice and the new engine numbers (Sound Safari names its clips itself).
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/engine-(audio|scenario)-choice\.js/.test(s) && !games.some((g) => path.basename(g.page) === f)) ensureTags(path.join(ROOT, f), null, null);
  }
  if (!args.includes('--audio') && missing.length) console.log('Run with --audio on the Mac to render them.');
}

module.exports = { plan, manifestSource, fileFor, clean, OUT, GAMES, ENGINE_VERSIONS };
if (require.main === module) main();

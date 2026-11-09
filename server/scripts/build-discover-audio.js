// Builds the recorded game voice (Kokoro "Heart", see lib/kokoro-render.js) for every game that speaks through engine-voice.js: the
// audio-led Discover games and the scenario games (Calm Down Corner, Letter Sounds, Feelings Detective, Strength Spotter and the rest):
// one small mp3 for every line a game can speak, plus a manifest the game looks lines up in.
//
//   node scripts/build-discover-audio.js            report what is missing (any computer)
//   node scripts/build-discover-audio.js --audio    render the missing clips and write the manifests (needs the Kokoro setup,
//                                                   docs/tune-your-brain/VOICE.md)
//   node scripts/build-discover-audio.js --audio --force   re-render every clip
//
// How it works: the game page keeps its content as plain text. engine-voice.js (loaded by every voiced game) looks each spoken line up
// in window.FnAudioManifest by its exact text (pictures removed, spaces collapsed) and plays the recorded clip. There is NO browser-voice
// fallback: a line with no clip is silent, and a test fails if a game can speak a line that has no clip. This script lists every line each
// game's engine can speak, names each clip after a hash of its text (the same line in two games is one file), and writes
// assets/audio/discover/<game>.js. Letter names are rendered from phonemes (lib/voice-text.js) and get their own clips, so the insect
// "bee" in Rhyme Time and the letter B in Letter Sounds never share a file.
// Change a line in a game, run this with --audio, commit the new clip and manifest. Sound Safari has its own builder.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'assets', 'audio', 'discover');
const { extractPack } = require('./audit-brain-games.js');
const { forVoice, loneLetter } = require('../lib/voice-text');
const FOCUS = require('../lib/brain-game-focus');
const sdk = require(path.join(ROOT, 'engine-sdk.js'));

const GAMES = [
  { slug: 'calm-down-corner', engine: 'audioChoice' },
  { slug: 'sharing-circle', engine: 'audioChoice' },
  { slug: 'helpers-choice', engine: 'audioChoice' },
  { slug: 'same-and-different', engine: 'audioChoice' },
  { slug: 'feelings-detective', engine: 'scenarioChoice' },
  // Release 141
  { slug: 'rhyme-time', engine: 'audioChoice' },
  { slug: 'letter-sounds', engine: 'audioChoice', letterNames: true },
  { slug: 'more-or-fewer', engine: 'audioChoice' },
  { slug: 'add-it-up', engine: 'audioChoice' },
  { slug: 'pattern-parade', engine: 'audioChoice' },
  { slug: 'my-feelings-today', engine: 'scenarioChoice' },
  // Release 143
  { slug: 'asking-nicely', engine: 'audioChoice' },
  { slug: 'team-tower', engine: 'audioChoice' },
  // Release 144
  { slug: 'wait-for-it', engine: 'audioChoice' },
  { slug: 'stop-and-think', engine: 'audioChoice' },
  // Release 167: the Explore-and-up scenario games used to speak with the browser voice because they had no clips
  { slug: 'strength-spotter', engine: 'scenarioChoice' },
  { slug: 'values-compass', engine: 'scenarioChoice' },
  { slug: 'know-yourself', engine: 'scenarioChoice' },
  { slug: 'know-your-triggers', engine: 'scenarioChoice' },
  { slug: 'stress-signals', engine: 'scenarioChoice' },
  { slug: 'what-helps-me', engine: 'scenarioChoice' },
];
// Each game's band decides how much its scenario engine speaks: only Discover is "voiced" (prompts, feedback and the finished card too).
for (const g of GAMES) g.band = (FOCUS.GAMES[g.slug] || {}).band;
const ENGINE_VERSIONS = { 'engine-audio-choice.js': 8, 'engine-scenario-choice.js': 10, 'engine-voice.js': 3 };
// The same rule engine-voice.js applies before it looks a line up.
const clean = (s) => String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

// A "Your turn" prompt can hold the child's earlier pick ("Pick one small way to grow your {s1.first|lower}."). The engine fills it in
// while playing, so the line is recorded once for each answer the child could have given. A token for a LIST of picks ({s1}) can come out
// as any combination, which is too many to record, so such a prompt is left unspoken.
function expandPrompt(template, steps) {
  const tokens = [...String(template || '').matchAll(/\{([a-zA-Z0-9_]+)(\.first)?(\|lower)?\}/g)];
  if (!tokens.length) return [template];
  let outs = [String(template)];
  for (const [m, id, first, lower] of tokens) {
    const st = steps.find((x) => x.id === id);
    if (!first || !st || !(st.options || []).length) return [];
    const vals = st.options.map((o) => { const t = clean(o.card && !/[{}]/.test(o.card) ? o.card : o.text); return lower ? t.toLowerCase() : t; });
    outs = outs.flatMap((o) => vals.map((v) => o.split(m).join(v)));
  }
  return outs;
}

// Every line the engine can speak for this pack. `band` matters only to the scenario engine, which speaks far more in Discover (prompts,
// feedback, the finished card) than in the reader bands (the story, the cues and feelings, the self-check and the "Your turn" steps).
// A line that still holds a {token} is filled in from the child's own picks while playing, so it cannot have a recorded clip: it is left out.
function linesFor(game, pack) {
  const out = new Set();
  const add = (x) => { const c = clean(x); if (c && !/[{}]/.test(c)) out.add(c); };
  const voiced = game.band === 'discover';
  if (game.engine === 'audioChoice') {
    add(sdk.t('audRight', 'discover')); add(sdk.t('audMiss', 'discover'));
    for (const it of pack.items) {
      add(it.stimulusText || it.transcript);
      for (const c of it.choices) { add(c.say || c.caption || c.aria); add(c.feedback); }
      add(it.explanation);
    }
  } else {
    const P = Object.assign({}, pack.prompts || {});
    if (voiced) {
      ['cues', 'afterCues', 'pick'].forEach((k) => add(P[k]));
      add('Take another look at the cues, some of them point somewhere else.');
    }
    for (const sc of pack.scenarios) {
      add(sc.context);
      sc.cues.forEach((c) => add(c.text));
      sc.feelings.forEach((f) => { add(f.text); if (voiced) add(f.note); });
      if (voiced) add(sc.reinforcement);
      if (sc.selfCheck) [sc.selfCheck].forEach((c) => addCheck(c));
    }
    if (pack.selfCheck) addCheck(pack.selfCheck);
    // Release 139: the "Your turn" finale speaks its intro, every prompt, every answer and (Discover only) every line a card can say (cards
    // with no {token} in them). A pack can hold several versions of its finale (variants), each with its own intro and first prompt.
    for (const ot of [pack.ownTurn].concat((pack.variants || []).map((v) => v.ownTurn)).filter(Boolean)) {
      add(ot.intro);
      for (const st of ot.steps || []) {
        expandPrompt(st.prompt, ot.steps).forEach(add); expandPrompt(st.promptIfNone, ot.steps).forEach(add);
        const lists = [st.options || []];
        if (st.optionsBy) { lists.push(st.optionsBy.fallback || []); Object.values(st.optionsBy.map || {}).forEach((l) => lists.push(l)); }
        for (const list of lists) for (const o of list) { add(o.text); if (voiced && o.card) add(o.card); }
        if (st.notSure) add(st.notSure.text);
        // a trade-off reads its situation and its question as one line, then the two choices and "it depends"
        for (const pr of st.pairs || []) {
          add(`${pr.context} ${st.prompt || ''}`);
          add(pr.optionA && pr.optionA.text); add(pr.optionB && pr.optionB.text);
          if (voiced) { add(pr.optionA && pr.optionA.card); add(pr.optionB && pr.optionB.card); add(pr.depends); }
        }
        if (st.pairs) add(st.dependsText || 'It depends');
      }
      if (voiced) { const res = ot.result || {}; add(res.emptyLine); add(res.closing); }
    }
    function addCheck(c) {
      add(c.prompt); (c.options || []).forEach((o) => add(o.text));
      add(c.bodyPrompt); (c.bodyOptions || []).forEach((o) => add(o.text));
      if (voiced) add(c.closing);
    }
  }
  return [...out];
}

// Letter Sounds spells its answers as letter names ("bee", "are", "double you") and carries the real letter as the answer's id and label.
// A line that is only such a name must be said as that LETTER, from phonemes, whatever else the word means (the insect, "are").
function letterOf(game, pack) {
  const map = {};
  if (!game.letterNames) return map;
  for (const it of pack.items) for (const c of it.choices) if (/^[A-Z]$/.test(c.id || '') && String(c.label).toUpperCase() === c.id && (c.say || c.caption)) map[clean(c.say || c.caption)] = c.id;
  return map;
}

// The clip name is a hash of the text, so the same line in two games is one file. A letter name hashes the letter instead, and is said
// from phonemes, so it never shares a file with the same word spoken as a word.
function clipFor(game, text) {
  const letter = game.letters && game.letters[text];
  if (letter) return { file: fileFor(`letter:${letter}`), voice: loneLetter(letter), keepLast: true };
  return { file: fileFor(text), voice: forVoice(text) };
}
// VOICE_TAG is part of every clip's name. Change it whenever the voice or its settings change, so every clip gets a new address and no
// browser (or school cache) keeps playing an old recording from the old address.
const VOICE_TAG = 'kokoro-af_heart-1';
const fileFor = (text) => crypto.createHash('sha1').update(`${VOICE_TAG}|${text}`).digest('hex').slice(0, 12) + '.mp3';

function plan() {
  const games = GAMES.map((g) => {
    const page = path.join(ROOT, `brain-${g.slug}.html`);
    const pack = extractPack(fs.readFileSync(page, 'utf8'));
    if (!pack) throw new Error(`could not read the pack in brain-${g.slug}.html`);
    const game = Object.assign({}, g, { page, lines: linesFor(g, pack), letters: letterOf(g, pack) });
    return game;
  });
  const clips = new Map(); // file -> { text, voice }
  for (const g of games) for (const t of g.lines) { const c = clipFor(g, t); clips.set(c.file, { text: t, voice: c.voice, keepLast: !!c.keepLast }); }
  return { games, clips };
}

function manifestSource(game) {
  const body = {};
  for (const t of game.lines.slice().sort()) body[t] = `assets/audio/discover/${clipFor(game, t).file}`;
  return `// Generated by server/scripts/build-discover-audio.js: the recorded voice clip for each line of ${game.slug}. Do not edit.\n`
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
    const { renderAll } = require('../lib/kokoro-render');
    const todo = [];
    for (const [file, c] of clips) if (args.includes('--force') || !fs.existsSync(path.join(OUT, file))) todo.push({ dest: path.join(OUT, file), text: c.voice, keepLast: c.keepLast });
    const { made } = renderAll(todo);
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

module.exports = { plan, manifestSource, fileFor, clipFor, clean, linesFor, OUT, GAMES, ENGINE_VERSIONS, VOICE_TAG };
if (require.main === module) main();

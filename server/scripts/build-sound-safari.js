// Builds Sound Safari (brain-sound-safari.html): the pool of sound-to-picture rounds and the Ava voice clips for them.
//
//   node scripts/build-sound-safari.js            rewrite the rounds in brain-sound-safari.html (any computer)
//   node scripts/build-sound-safari.js --audio    also render any missing voice clips (macOS only: needs the "Ava (Premium)"
//                                                 voice, the same one the how-to videos use, and tests/node_modules/ffmpeg-static)
//   node scripts/build-sound-safari.js --audio --force   re-render every clip
//
// This file is the single source of truth for the content. Edit the lists below, run it, commit the page and the clips.
// Rounds are deterministic: the same lists always give the same page. The HTML keeps the rounds as plain literals between the
// BEGIN/END markers because the audit and tests read the pack straight out of the page.
//
// What each round is: a spoken model word and its first sound ("Moon starts with mmm. Which picture starts with the same
// sound?"), then three pictures. The sound is said once on purpose (children told us it was said too many times). The model
// word is never one of the pictures.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'brain-sound-safari.html');
const CLIPS_DIR = path.join(ROOT, 'assets', 'audio', 'sound-safari');
const URL_PREFIX = 'assets/audio/sound-safari/';
const VOICE = 'Ava (Premium)';
const RATE = '135'; // say -r words per minute for sentences: slower than the how-to videos (165) but natural, for kindergarten to 2nd grade
const WORD_RATE = '120';

// How the voice says each sound (children's phonics spelling: stops get a soft "uh", stretchable sounds are held).
const SOUNDS = {
  m: 'mmm', s: 'sss', t: 'tuh', b: 'buh', p: 'puh', d: 'duh', f: 'fff', g: 'guh', h: 'huh', j: 'juh',
  k: 'kuh', l: 'lll', n: 'nnn', r: 'rrr', w: 'wuh', v: 'vvv', z: 'zzz', sh: 'shhh', ch: 'chuh',
};
// Sounds that are easy to mix up (same mouth shape, voiced or not). They never sit side by side in a round.
const LOOKALIKE = { b: 'p', p: 'b', d: 't', t: 'd', k: 'g', g: 'k', f: 'v', v: 'f', s: 'z', z: 's', sh: 'ch', ch: 'sh', j: 'ch', m: 'n', n: 'm' };

// Pictures: the word, its picture, and the sound it starts with. Only older emoji, so they draw on school Chromebooks.
const PICTURES = {
  m: [['moon', '🌙'], ['monkey', '🐵'], ['mouse', '🐭'], ['mango', '🥭'], ['mushroom', '🍄'], ['milk', '🥛'], ['mittens', '🧤']],
  s: [['sun', '☀️'], ['snake', '🐍'], ['sock', '🧦'], ['star', '⭐'], ['spider', '🕷️'], ['soap', '🧼']],
  t: [['tiger', '🐯'], ['turtle', '🐢'], ['tree', '🌳'], ['train', '🚂'], ['tent', '⛺'], ['tooth', '🦷'], ['tomato', '🍅'], ['truck', '🚚']],
  b: [['ball', '⚽'], ['butterfly', '🦋'], ['bear', '🐻'], ['bee', '🐝'], ['banana', '🍌'], ['bus', '🚌'], ['bed', '🛏️'], ['bread', '🍞'], ['boat', '⛵']],
  p: [['pig', '🐷'], ['pizza', '🍕'], ['pear', '🍐'], ['penguin', '🐧'], ['panda', '🐼'], ['pencil', '✏️'], ['piano', '🎹'], ['pumpkin', '🎃']],
  d: [['dog', '🐶'], ['duck', '🦆'], ['drum', '🥁'], ['donut', '🍩'], ['dolphin', '🐬'], ['door', '🚪'], ['dinosaur', '🦕']],
  f: [['fish', '🐟'], ['frog', '🐸'], ['fox', '🦊'], ['flower', '🌸'], ['fire', '🔥'], ['foot', '🦶'], ['fork', '🍴']],
  g: [['goat', '🐐'], ['grapes', '🍇'], ['gorilla', '🦍'], ['guitar', '🎸'], ['gift', '🎁']],
  h: [['horse', '🐴'], ['hat', '🎩'], ['hamburger', '🍔'], ['hammer', '🔨'], ['heart', '❤️'], ['house', '🏠'], ['helicopter', '🚁']],
  j: [['jeans', '👖'], ['giraffe', '🦒']],
  k: [['cat', '🐱'], ['cow', '🐮'], ['cake', '🎂'], ['car', '🚗'], ['camel', '🐫'], ['key', '🔑'], ['kangaroo', '🦘'], ['carrot', '🥕'], ['cookie', '🍪']],
  l: [['lion', '🦁'], ['leaf', '🍃'], ['lemon', '🍋'], ['lizard', '🦎'], ['lollipop', '🍭'], ['ladybug', '🐞']],
  n: [['nose', '👃'], ['noodles', '🍜'], ['newspaper', '📰']],
  r: [['rabbit', '🐰'], ['rainbow', '🌈'], ['rocket', '🚀'], ['robot', '🤖'], ['ring', '💍'], ['rose', '🌹'], ['rhino', '🦏']],
  w: [['whale', '🐳'], ['watch', '⌚'], ['watermelon', '🍉'], ['wolf', '🐺'], ['web', '🕸️']],
  v: [['volcano', '🌋'], ['violin', '🎻'], ['van', '🚐']],
  z: [['zebra', '🦓'], ['zero', '0️⃣']],
  sh: [['ship', '🚢'], ['shark', '🦈'], ['shoe', '👟'], ['sheep', '🐑'], ['shell', '🐚'], ['shirt', '👕']],
  ch: [['chicken', '🐔'], ['cheese', '🧀'], ['cherry', '🍒'], ['chocolate', '🍫']],
};

// Rounds: [sound, model word said aloud (not shown as a picture), picture word that is the answer].
const ROUNDS = [
  ['m', 'moon', 'monkey'], ['m', 'mouse', 'mango'], ['m', 'milk', 'mushroom'], ['m', 'mom', 'mittens'],
  ['s', 'sun', 'snake'], ['s', 'sock', 'spider'], ['s', 'soup', 'star'], ['s', 'sand', 'soap'],
  ['t', 'tiger', 'turtle'], ['t', 'tree', 'train'], ['t', 'tent', 'tooth'], ['t', 'table', 'tomato'], ['t', 'top', 'truck'],
  ['b', 'ball', 'butterfly'], ['b', 'bear', 'bee'], ['b', 'banana', 'bus'], ['b', 'bed', 'bread'], ['b', 'boy', 'boat'],
  ['p', 'pig', 'pizza'], ['p', 'pear', 'penguin'], ['p', 'panda', 'pencil'], ['p', 'pen', 'piano'], ['p', 'pot', 'pumpkin'],
  ['d', 'dog', 'duck'], ['d', 'drum', 'donut'], ['d', 'doll', 'dolphin'], ['d', 'desk', 'door'], ['d', 'dad', 'dinosaur'],
  ['f', 'fish', 'frog'], ['f', 'fox', 'flower'], ['f', 'fan', 'foot'], ['f', 'fork', 'fire'],
  ['g', 'goat', 'grapes'], ['g', 'gorilla', 'guitar'], ['g', 'gate', 'gift'], ['g', 'green', 'goat'],
  ['h', 'horse', 'hat'], ['h', 'hammer', 'hamburger'], ['h', 'heart', 'house'], ['h', 'hand', 'helicopter'],
  ['j', 'jam', 'jeans'], ['j', 'jump', 'giraffe'], ['j', 'jet', 'jeans'],
  ['k', 'cat', 'cow'], ['k', 'cake', 'car'], ['k', 'kitten', 'kangaroo'], ['k', 'cup', 'cookie'], ['k', 'carrot', 'key'],
  ['l', 'lion', 'leaf'], ['l', 'lemon', 'lizard'], ['l', 'lamp', 'lollipop'], ['l', 'ladder', 'ladybug'],
  ['n', 'nose', 'noodles'], ['n', 'nest', 'newspaper'], ['n', 'nut', 'nose'],
  ['r', 'rabbit', 'rainbow'], ['r', 'rocket', 'robot'], ['r', 'ring', 'rose'], ['r', 'rug', 'rhino'],
  ['w', 'window', 'watch'], ['w', 'wagon', 'whale'], ['w', 'worm', 'watermelon'], ['w', 'wing', 'wolf'],
  ['v', 'van', 'volcano'], ['v', 'vase', 'violin'], ['v', 'vest', 'van'],
  ['z', 'zoo', 'zebra'], ['z', 'zip', 'zero'], ['z', 'zigzag', 'zebra'],
  ['sh', 'ship', 'shark'], ['sh', 'shoe', 'sheep'], ['sh', 'shell', 'shirt'], ['sh', 'shop', 'shoe'],
  ['ch', 'chair', 'cheese'], ['ch', 'chicken', 'cherry'], ['ch', 'chip', 'chocolate'], ['ch', 'chin', 'chicken'],
];

// ---------- building the rounds ----------
const pictureOf = {}; // word -> { word, emoji, sound }
for (const [sound, list] of Object.entries(PICTURES)) for (const [word, emoji] of list) pictureOf[word] = { word, emoji, sound };

function hash(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function buildRounds() {
  return ROUNDS.map(([sound, model, answer], i) => {
    const key = `${sound}-${model}`;
    const right = pictureOf[answer];
    if (!right || right.sound !== sound) throw new Error(`${key}: ${answer} is not a "${sound}" picture`);
    const rand = rng(hash(key));
    const banned = new Set([sound, LOOKALIKE[sound]]);
    const pool = Object.values(pictureOf).filter((p) => !banned.has(p.sound) && p.word !== model && !(LOOKALIKE[p.sound] && LOOKALIKE[p.sound] === sound));
    const picks = [];
    while (picks.length < 2) {
      const p = pool[Math.floor(rand() * pool.length)];
      if (picks.some((q) => q.sound === p.sound || (LOOKALIKE[q.sound] === p.sound))) continue; // two different, unlike sounds
      picks.push(p);
    }
    const choices = [right, ...picks].map((p) => ({ p, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.p);
    const say = SOUNDS[sound];
    const line = `${cap(model)} starts with ${say}. Which picture starts with the same sound?`;
    return { key, sound, model, answer, say, line, explain: `${cap(model)} and ${answer} both start with ${say}.`, choices, number: i + 1 };
  });
}

function clipList(rounds) {
  const clips = new Map(); // file -> { text, rate }
  clips.set('yes.mp3', { text: 'Yes!', rate: RATE });
  clips.set('not-quite.mp3', { text: 'Not quite.', rate: RATE });
  for (const r of rounds) {
    clips.set(`q-${r.key}.mp3`, { text: r.line, rate: RATE });
    clips.set(`e-${r.key}.mp3`, { text: r.explain, rate: RATE });
    for (const c of r.choices) clips.set(`w-${c.word}.mp3`, { text: cap(c.word) + '.', rate: WORD_RATE });
  }
  return clips;
}

const q = (s) => JSON.stringify(s);
function pageBlock(rounds) {
  const out = [];
  for (const r of rounds) {
    out.push('      {');
    out.push(`        id: ${q(r.key)}, stimulusType: 'audio', stimulusAudioUrl: ${q(URL_PREFIX + `q-${r.key}.mp3`)},`);
    out.push(`        stimulusText: ${q(r.line)},`);
    out.push(`        words: ${q(r.line)},`);
    out.push(`        transcript: ${q(r.line)},`);
    out.push('        choices: [');
    for (const c of r.choices) {
      const ok = c.word === r.answer;
      out.push(`          { id: ${q(c.word)}, label: ${q(c.emoji)}, aria: ${q(c.word)}, audioUrl: ${q(URL_PREFIX + `w-${c.word}.mp3`)}, feedback: ${q(ok ? 'Yes!' : 'Not quite.')} },`);
    }
    out.push('        ],');
    out.push(`        correctId: ${q(r.answer)}, explanation: ${q(r.explain)},`);
    out.push(`        feedbackAudio: { right: [${q(URL_PREFIX + 'yes.mp3')}, ${q(URL_PREFIX + `e-${r.key}.mp3`)}], miss: [${q(URL_PREFIX + 'not-quite.mp3')}, ${q(URL_PREFIX + `e-${r.key}.mp3`)}] },`);
    out.push('      },');
  }
  return out.join('\n');
}

function writePage(rounds) {
  const src = fs.readFileSync(PAGE, 'utf8');
  const begin = '      // BEGIN rounds (generated by server/scripts/build-sound-safari.js; edit that file, not this block)\n';
  const end = '      // END rounds\n';
  const a = src.indexOf(begin), b = src.indexOf(end);
  if (a < 0 || b < 0) throw new Error('BEGIN/END rounds markers not found in brain-sound-safari.html');
  fs.writeFileSync(PAGE, src.slice(0, a + begin.length) + pageBlock(rounds) + '\n' + src.slice(b));
}

function render(clips, force) {
  if (process.platform !== 'darwin') throw new Error('Rendering the voice needs macOS with the "Ava (Premium)" voice installed.');
  const ffmpeg = require(path.join(ROOT, 'tests', 'node_modules', 'ffmpeg-static'));
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-safari-'));
  let made = 0;
  for (const [file, { text, rate }] of clips) {
    const dest = path.join(CLIPS_DIR, file);
    if (!force && fs.existsSync(dest)) continue;
    const aiff = path.join(tmp, file.replace(/\.mp3$/, '.aiff'));
    let r = spawnSync('say', ['-v', VOICE, '-r', rate, '-o', aiff, text], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`say failed for "${text}": ${r.stderr}`);
    r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', aiff, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB', '-ac', '1', '-ar', '24000', '-b:a', '48k', dest], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}: ${r.stderr}`);
    made++;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return made;
}

module.exports = { buildRounds, clipList, pageBlock, SOUNDS, LOOKALIKE, pictureOf, CLIPS_DIR, URL_PREFIX };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rounds = buildRounds();
  const clips = clipList(rounds);
  writePage(rounds);
  console.log(`Wrote ${rounds.length} rounds to brain-sound-safari.html (${clips.size} voice clips needed).`);
  if (args.includes('--audio')) console.log(`Rendered ${render(clips, args.includes('--force'))} clip(s) into assets/audio/sound-safari/.`);
  else {
    const missing = [...clips.keys()].filter((f) => !fs.existsSync(path.join(CLIPS_DIR, f)));
    console.log(missing.length ? `${missing.length} clip(s) are missing. Run with --audio on the Mac.` : 'All voice clips are present.');
  }
}

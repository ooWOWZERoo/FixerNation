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
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'brain-sound-safari.html');
const CLIPS_DIR = path.join(ROOT, 'assets', 'audio', 'sound-safari');
const URL_PREFIX = 'assets/audio/sound-safari/';
const VOICE = 'Ava (Premium)';
const RATE = '135'; // say -r words per minute for sentences: slower than the how-to videos (165) but natural, for kindergarten to 2nd grade
const WORD_RATE = '120';
const SOUND_RATE = '60'; // each isolated sound is said slowly, then stretched further below if it is still short
const QUESTION = 'Which picture starts with the same sound?';

// How the voice says each sound (children's phonics spelling: stops get a soft "uh", stretchable sounds are held).
const SOUNDS = {
  m: 'mmm', s: 'sss', t: 'tuh', b: 'buh', p: 'puh', d: 'duh', f: 'fff', g: 'guh', h: 'huh', j: 'juh',
  k: 'kuh', l: 'lll', n: 'nnn', r: 'rrr', w: 'wuh', v: 'vvv', z: 'zzz', sh: 'shhh', ch: 'chuh',
};
// Sounds that are easy to mix up (same mouth shape, voiced or not). They never sit side by side in a round.
const LOOKALIKE = { b: 'p', p: 'b', d: 't', t: 'd', k: 'g', g: 'k', f: 'v', v: 'f', s: 'z', z: 's', sh: 'ch', ch: 'sh', j: 'ch', m: 'n', n: 'm' };

// Sounds a mouth can hold on to (a stretched "mmm"); the others are short pops and get a shorter minimum.
const HELD = new Set(['m', 's', 'f', 'l', 'n', 'r', 'v', 'z', 'sh']);

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
    const intro = `${cap(model)} starts with the sound`;
    const line = `${intro} ${say}. ${QUESTION}`;
    const lead = `${cap(model)} and ${answer} both start with the sound`;
    return { key, sound, model, answer, say, intro, lead, line, explain: `${lead} ${say}.`, choices, number: i + 1 };
  });
}

function clipList(rounds) {
  const clips = new Map(); // file -> { text, rate, minSeconds? }
  clips.set('yes.mp3', { text: 'Yes!', rate: RATE });
  clips.set('not-quite.mp3', { text: 'Not quite.', rate: RATE });
  clips.set('question.mp3', { text: QUESTION, rate: RATE });
  // Each sound is its own clip, said slowly and held (a stretched "mmm" or "sss", a clear "tuh"), so it is never swallowed by a sentence.
  for (const [sound, say] of Object.entries(SOUNDS)) clips.set(`s-${sound}.mp3`, { text: say, rate: SOUND_RATE, minSeconds: HELD.has(sound) ? 1.0 : 0.7 });
  for (const r of rounds) {
    clips.set(`i-${r.key}.mp3`, { text: r.intro, rate: RATE });
    clips.set(`e-${r.key}.mp3`, { text: r.lead, rate: RATE });
    for (const c of r.choices) clips.set(`w-${c.word}.mp3`, { text: cap(c.word) + '.', rate: WORD_RATE });
  }
  return clips;
}

const q = (s) => JSON.stringify(s);
function pageBlock(rounds) {
  const out = [];
  for (const r of rounds) {
    out.push('      {');
    out.push(`        id: ${q(r.key)}, stimulusType: 'audio',`);
    out.push(`        stimulusAudioUrl: [${q(URL_PREFIX + `i-${r.key}.mp3`)}, ${q(URL_PREFIX + `s-${r.sound}.mp3`)}, ${q(URL_PREFIX + 'question.mp3')}],`);
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
    const tail = `${q(URL_PREFIX + `e-${r.key}.mp3`)}, ${q(URL_PREFIX + `s-${r.sound}.mp3`)}`;
    out.push(`        feedbackAudio: { right: [${q(URL_PREFIX + 'yes.mp3')}, ${tail}], miss: [${q(URL_PREFIX + 'not-quite.mp3')}, ${tail}] },`);
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
  const { renderer } = require('../lib/ava-render');
  const { render: renderOne, done } = renderer();
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
  let made = 0;
  try {
    for (const [file, spec] of clips) {
      const dest = path.join(CLIPS_DIR, file);
      if (!force && fs.existsSync(dest)) continue;
      renderOne(spec, dest);
      made++;
    }
  } finally { done(); }
  for (const f of fs.readdirSync(CLIPS_DIR)) if (f.endsWith('.mp3') && !clips.has(f)) fs.rmSync(path.join(CLIPS_DIR, f)); // clips no round uses any more
  return made;
}

// A page for a person to listen to every isolated sound and one full round of each, with the clip names to report back.
function writeAudition(rounds) {
  const file = path.join(ROOT, 'docs', 'tune-your-brain', 'sound-safari-audition.html');
  const rows = Object.entries(SOUNDS).map(([sound, say]) => {
    const r = rounds.find((x) => x.sound === sound);
    const seq = [`i-${r.key}.mp3`, `s-${sound}.mp3`, 'question.mp3'];
    return `<tr><td><b>${say}</b><br><small>sound "${sound}"</small></td>`
      + `<td><button onclick="play(['s-${sound}.mp3'])">Play the sound</button></td>`
      + `<td><button onclick="play(${JSON.stringify(seq)})">Play a question: ${r.line.replace(/"/g, '&quot;')}</button></td></tr>`;
  }).join('\n');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Sound Safari audition</title>
<style>body{font-family:system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#2A2420}td{padding:8px 10px;border-bottom:1px solid #ddd;vertical-align:middle}button{padding:8px 12px;border-radius:8px;border:1px solid #164F4A;background:#fff;cursor:pointer;font-size:14px}button:hover{background:#E4F3EE}</style></head><body>
<h1>Sound Safari: listen to the sounds</h1>
<p>Generated by <code>server/scripts/build-sound-safari.js</code>. Open this file from the repository (it plays the clips in <code>assets/audio/sound-safari/</code>). For any sound that is hard to hear, cut off, or wrong, tell Claude the sound (for example "p" or "sh").</p>
<table>${rows}</table>
<script>
let current = null;
function play(files) {
  if (current) current.stop = true;
  const token = { stop: false }; current = token; let i = 0;
  (function next() {
    if (token.stop || i >= files.length) return;
    const a = new Audio('../../assets/audio/sound-safari/' + files[i++]);
    a.onended = () => setTimeout(next, 350);
    a.play();
  })();
}
</script></body></html>
`;
  fs.writeFileSync(file, html);
}

module.exports = { buildRounds, clipList, pageBlock, SOUNDS, LOOKALIKE, pictureOf, CLIPS_DIR, URL_PREFIX };

if (require.main === module) {
  const args = process.argv.slice(2);
  const rounds = buildRounds();
  const clips = clipList(rounds);
  writePage(rounds);
  writeAudition(rounds);
  console.log(`Wrote ${rounds.length} rounds to brain-sound-safari.html (${clips.size} voice clips needed).`);
  if (args.includes('--audio')) console.log(`Rendered ${render(clips, args.includes('--force'))} clip(s) into assets/audio/sound-safari/.`);
  else {
    const missing = [...clips.keys()].filter((f) => !fs.existsSync(path.join(CLIPS_DIR, f)));
    console.log(missing.length ? `${missing.length} clip(s) are missing. Run with --audio on the Mac.` : 'All voice clips are present.');
  }
}

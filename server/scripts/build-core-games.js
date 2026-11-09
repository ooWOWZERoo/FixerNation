// Release 141: builds the new core-skills and Self-Awareness games from the specifications in this file, so their content is data (checked by
// server/test/new-games.test.js) and the pages cannot drift from it. Run:
//   node server/scripts/build-core-games.js            write every page and catalog seed script
//   node server/scripts/build-core-games.js rhyme-time  write one
// Then (macOS with Ava Premium) node server/scripts/build-discover-audio.js --audio for the spoken Discover games.
// The generated pages carry a comment saying they are generated; edit the content here, not in the page.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPTS = __dirname;

const NW = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const shuffle = (arr, r) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr, n, r, not = []) => shuffle(arr.filter((x) => !not.includes(x)), r).slice(0, n);

// ---------------------------------------------------------------------------------------------------------------------------------
// Discover (K-2), audio-led. Every item is read aloud; the child taps a picture or a letter.
// ---------------------------------------------------------------------------------------------------------------------------------
const RIGHT = 'You got it!', MISS = 'Try another one.';
const choice = (id, label, caption, aria, right, say) => Object.assign({ id, label }, caption ? { caption } : {}, say ? { say } : {}, { aria, feedback: right ? RIGHT : MISS });

function rhymeTime() {
  const W = { cat: '🐱', hat: '🎩', bat: '🦇', dog: '🐶', log: '🪵', frog: '🐸', cake: '🎂', snake: '🐍', moon: '🌙', spoon: '🥄', balloon: '🎈', boat: '🚤', coat: '🧥', goat: '🐐', fish: '🐟', dish: '🍽️', clock: '🕐', sock: '🧦', rock: '🪨', mouse: '🐭', house: '🏠', bee: '🐝', tree: '🌳', key: '🔑', bear: '🐻', chair: '🪑', pear: '🍐', sun: '☀️', car: '🚗', star: '⭐', bed: '🛏️', ball: '⚽', drum: '🥁', book: '📖' };
  const FAMILY = { cat: 'at', hat: 'at', bat: 'at', dog: 'og', log: 'og', frog: 'og', cake: 'ake', snake: 'ake', moon: 'oon', spoon: 'oon', balloon: 'oon', boat: 'oat', coat: 'oat', goat: 'oat', fish: 'ish', dish: 'ish', clock: 'ock', sock: 'ock', rock: 'ock', mouse: 'ouse', house: 'ouse', bee: 'ee', tree: 'ee', key: 'ee', bear: 'air', chair: 'air', pear: 'air' };
  const pairs = [['cat', 'hat'], ['hat', 'bat'], ['bat', 'cat'], ['dog', 'log'], ['frog', 'dog'], ['cake', 'snake'], ['moon', 'spoon'], ['balloon', 'moon'], ['boat', 'coat'], ['goat', 'boat'], ['fish', 'dish'], ['clock', 'sock'], ['rock', 'sock'], ['mouse', 'house'], ['bee', 'tree'], ['key', 'bee'], ['bear', 'chair'], ['pear', 'bear']];
  const r = rng(11);
  const others = Object.keys(W);
  return pairs.map(([target, answer]) => {
    const bad = pick(others.filter((w) => FAMILY[w] !== FAMILY[target] && w[0] !== target[0] && w[0] !== answer[0]), 2, r);
    const choices = shuffle([answer, ...bad], r).map((w) => choice(w, W[w], w, `the ${w}`, w === answer));
    const q = `Which one rhymes with ${target}?`;
    return { stimulusType: 'audio', stimulusText: q, transcript: q, visual: W[target], choices, correctId: answer, explanation: `${cap(target)} and ${answer} end with the same sound.` };
  });
}

function letterSounds() {
  const L = [['B', 'ball', '⚽', 'bee'], ['D', 'dog', '🐶', 'dee'], ['F', 'fish', '🐟', 'eff'], ['H', 'horse', '🐴', 'aitch'], ['K', 'kite', '🪁', 'kay'], ['L', 'lion', '🦁', 'el'], ['M', 'moon', '🌙', 'em'], ['N', 'nest', '🪺', 'en'], ['P', 'pig', '🐷', 'pee'], ['R', 'rabbit', '🐰', 'are'], ['S', 'sun', '☀️', 'ess'], ['T', 'tiger', '🐯', 'tee'], ['Z', 'zebra', '🦓', 'zee'], ['W', 'web', '🕸️', 'double you']];
  const SAME = { B: 'DPQ', D: 'BPQ', P: 'BDQ', M: 'NW', N: 'MH', W: 'M', H: 'N' };
  const r = rng(23);
  return L.map(([letter, word, pic, name], i) => {
    const lower = i % 2 === 1;
    const show = (l) => (lower ? l.toLowerCase() : l);
    const pool = L.filter(([l]) => l !== letter && !(SAME[letter] || '').includes(l)).map(([l]) => l);
    const bad = pick(pool, 2, r);
    const nameOf = Object.fromEntries(L.map(([l, , , n]) => [l, n]));
    const choices = shuffle([letter, ...bad], r).map((l) => ({ id: l, label: show(l), say: nameOf[l], aria: `the letter ${l}`, feedback: l === letter ? RIGHT : MISS }));
    const q = `${cap(word)} starts with which letter?`;
    return { stimulusType: 'audio', stimulusText: q, transcript: q, visual: pic, choices, correctId: letter, explanation: `${cap(word)} starts with the letter ${letter}.` };
  });
}

function moreOrFewer() {
  const T = [['apples', '🍎', 'apple'], ['fish', '🐟', 'fish'], ['stars', '⭐', 'star'], ['cars', '🚗', 'car'], ['dogs', '🐶', 'dog'], ['balloons', '🎈', 'balloon'], ['flowers', '🌸', 'flower'], ['cookies', '🍪', 'cookie']];
  const specs = [[3, 1, 'more'], [2, 5, 'more'], [6, 4, 'more'], [4, 7, 'more'], [8, 3, 'more'], [5, 9, 'more'], [7, 2, 'more'], [10, 6, 'more'], [4, 2, 'fewer'], [3, 6, 'fewer'], [7, 5, 'fewer'], [9, 4, 'fewer'], [2, 8, 'fewer'], [6, 10, 'fewer'], [5, 3, 'fewer'], [1, 4, 'fewer']];
  const r = rng(31);
  return specs.map(([a, b, kind], i) => {
    const [plural, emoji, one] = T[i % T.length];
    const [first, second] = r() < 0.5 ? [a, b] : [b, a];
    const want = kind === 'more' ? Math.max(a, b) : Math.min(a, b);
    const mk = (n, id) => ({ id, label: emoji.repeat(n), caption: `${cap(NW[n])} ${n === 1 ? one : plural}`, aria: `${NW[n]} ${n === 1 ? one : plural}`, feedback: n === want ? RIGHT : MISS });
    const q = `Which group has ${kind} ${plural}?`;
    const other = want === a ? b : a;
    return { stimulusType: 'audio', stimulusText: q, transcript: q, choices: [mk(first, 'left'), mk(second, 'right')], correctId: first === want ? 'left' : 'right',
      explanation: kind === 'more' ? `${cap(NW[want])} is more than ${NW[other]}.` : `${cap(NW[want])} is fewer than ${NW[other]}.` };
  });
}

function addItUp() {
  // Each story is written twice, for one and for more than one: "One bird is in a tree. One more flies in." not "One birds are in a tree."
  // [noun for one, noun for more, emoji, state for one, state for more, verb for one, verb for more]
  const ADD = [['bird', 'birds', '🐦', 'is in a tree', 'are in a tree', 'flies in', 'fly in'], ['cookie', 'cookies', '🍪', 'is on a plate', 'are on a plate', 'is added', 'are added'],
    ['dog', 'dogs', '🐶', 'plays in the park', 'play in the park', 'joins them', 'join them'], ['star', 'stars', '⭐', 'is in the sky', 'are in the sky', 'comes out', 'come out'],
    ['car', 'cars', '🚗', 'is in a lot', 'are in a lot', 'drives in', 'drive in'], ['fish', 'fish', '🐟', 'swims in a pond', 'swim in a pond', 'swims in', 'swim in']];
  const SUB = [['balloon', 'balloons', '🎈', 'floats in the air', 'float in the air', 'floats away', 'float away'], ['apple', 'apples', '🍎', 'is in a basket', 'are in a basket', 'is eaten', 'are eaten'],
    ['duck', 'ducks', '🦆', 'is on a pond', 'are on a pond', 'swims off', 'swim off'], ['kite', 'kites', '🪁', 'flies in the sky', 'fly in the sky', 'comes down', 'come down']];
  const adds = [[1, 1], [2, 1], [2, 2], [3, 1], [1, 4], [3, 2], [4, 3], [5, 2], [6, 3], [4, 5], [7, 2], [5, 5]];
  const subs = [[3, 1], [5, 2], [4, 3], [6, 2], [8, 3], [9, 4]];
  const r = rng(41);
  const opts = (answer, max) => { const pool = [answer - 2, answer - 1, answer + 1, answer + 2].filter((n) => n >= 0 && n <= max && n !== answer); return shuffle([answer, ...pick(pool, 2, r)], r); };
  const item = (q, answer, max, why) => ({ stimulusType: 'audio', stimulusText: q, transcript: q, choices: opts(answer, max).map((n) => ({ id: String(n), label: String(n), caption: cap(NW[n]), aria: NW[n], feedback: n === answer ? RIGHT : MISS })), correctId: String(answer), explanation: why });
  const noun = (t, n) => (n === 1 ? t[0] : t[1]);
  const state = (t, n) => (n === 1 ? t[3] : t[4]);
  const verb = (t, n) => (n === 1 ? t[5] : t[6]);
  const out = [];
  adds.forEach(([a, b], i) => {
    const t = ADD[i % ADD.length];
    out.push(item(`${cap(NW[a])} ${noun(t, a)} ${state(t, a)}. ${cap(NW[b])} more ${verb(t, b)}. How many now?`, a + b, 12, `${cap(NW[a])} and ${NW[b]} more makes ${NW[a + b]}.`));
  });
  subs.forEach(([a, b], i) => {
    const t = SUB[i % SUB.length];
    out.push(item(`${cap(NW[a])} ${noun(t, a)} ${state(t, a)}. ${cap(NW[b])} ${verb(t, b)}. How many are left?`, a - b, 12, `${cap(NW[a])} take away ${NW[b]} leaves ${NW[a - b]}.`));
  });
  return out;
}

function patternParade() {
  const C = { red: ['🔴', 'Red'], blue: ['🔵', 'Blue'], green: ['🟢', 'Green'], yellow: ['🟡', 'Yellow'], purple: ['🟣', 'Purple'], orange: ['🟠', 'Orange'], star: ['⭐', 'Star'], moon: ['🌙', 'Moon'], heart: ['❤️', 'Heart'], triangle: ['🔺', 'Triangle'], leaf: ['🍃', 'Leaf'], drop: ['💧', 'Drop'] };
  const sets = [['red', 'blue', 'green'], ['star', 'moon', 'heart'], ['yellow', 'purple', 'orange'], ['triangle', 'leaf', 'drop']];
  const r = rng(53);
  const kinds = [
    { shape: 'AB', seq: 'ABAB', ans: 'A', n: 5 }, { shape: 'AAB', seq: 'AABAA', ans: 'B', n: 3 }, { shape: 'ABC', seq: 'ABCAB', ans: 'C', n: 4 }, { shape: 'ABB', seq: 'ABBAB', ans: 'B', n: 3 }, { shape: 'AABB', seq: 'AABBA', ans: 'A', n: 1 },
  ];
  const out = [];
  let si = 0;
  kinds.forEach((k) => {
    for (let i = 0; i < k.n; i++) {
      const set = sets[si++ % sets.length];
      const [x, y, z] = shuffle(set, r);
      const map = { A: x, B: y, C: z };
      const names = k.seq.split('').map((l) => map[l]);
      const answer = map[k.ans];
      const visual = names.map((n) => C[n][0]).join(' ') + ' ❓';
      const q = `${names.map((n) => C[n][1]).join(', ')}. What comes next?`;
      const choices = shuffle(set, r).map((n) => ({ id: n, label: C[n][0], caption: C[n][1], aria: C[n][1].toLowerCase(), feedback: n === answer ? RIGHT : MISS }));
      out.push({ stimulusType: 'audio', stimulusText: q, transcript: q, visual, choices, correctId: answer, explanation: `The pattern repeats, so ${C[answer][1].toLowerCase()} comes next.` });
    }
  });
  return out;
}

function animalMatch() {
  return [['cat', '🐱'], ['dog', '🐶'], ['rabbit', '🐰'], ['frog', '🐸'], ['lion', '🦁'], ['pig', '🐷'], ['cow', '🐮'], ['duck', '🦆']].map(([id, display]) => ({ id, display }));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Explore (3-5): Word Clues and Word Problem Workshop use the Evidence Hunt engine; Times Table Trail uses Audio Choice with text.
// ---------------------------------------------------------------------------------------------------------------------------------
function wordClues() {
  const raw = [
    ['enormous', ['The elephant was enormous.', 'It was bigger than the truck beside it.', 'The children had to look up to see its face.'], 1, ['Very large in size.', 'Very old and gray.', 'Very loud and busy.'], 0, 'The elephant is bigger than a truck. That clue shows the word means very large.'],
    ['fragile', ['Dad packed the glass vase with care.', 'It was fragile, and one bump could break it.', 'He wrapped it in three thick towels.'], 1, ['Easy to break or damage.', 'Heavy and hard to lift.', 'Bright and full of color.'], 0, 'One bump could break it. That clue shows the word means easy to break.'],
    ['scarce', ['Water was scarce in the desert town.', 'People saved every drop they could find.', 'Some days there was barely enough to drink.'], 2, ['Hard to find; not enough.', 'Too cold to drink.', 'Wasted by everyone.'], 0, 'There was barely enough to drink. That clue shows the word means hard to find.'],
    ['reluctant', ['Sam was reluctant to jump into the cold lake.', 'He stood at the edge for a long time.', 'He kept saying, "Maybe later."'], 2, ['Not wanting to do something.', 'Very excited to start.', 'Too tired to move at all.'], 0, 'He kept saying "maybe later." That clue shows he did not want to jump.'],
    ['ancient', ['The museum had an ancient coin.', 'It was made more than two thousand years ago.', 'Visitors could see it behind glass.'], 1, ['Very, very old.', 'Very shiny and new.', 'Very small and light.'], 0, 'It was made two thousand years ago. That clue shows the word means very old.'],
    ['cautious', ['Mia was cautious on the icy path.', 'She took small steps and held the rail.', 'She did not want to slip.'], 1, ['Careful to stay safe.', 'Quick and full of fun.', 'Sleepy and slow to wake.'], 0, 'She took small steps and held the rail. That clue shows she was careful.'],
    ['frantic', ['The puppy was frantic when the door shut.', 'It ran in circles and barked loudly.', 'It could not sit still.'], 1, ['Wildly upset and rushed.', 'Calm and half asleep.', 'Proud of what it did.'], 0, 'It ran in circles and barked. That clue shows the puppy was wildly upset.'],
    ['peculiar', ['Leo found a peculiar rock in the creek.', 'It was purple and shaped like a star.', 'He had never seen one like it.'], 2, ['Strange or not usual.', 'Plain, gray and dull.', 'Heavy and wet and cold.'], 0, 'He had never seen one like it. That clue shows the word means unusual.'],
    ['sturdy', ['The table was sturdy.', 'Four grown-ups could stand on it without a wobble.', 'It had been in the family for years.'], 1, ['Strong and steady.', 'Small and easy to move.', 'Old and a little rusty.'], 0, 'Four grown-ups could stand on it. That clue shows the table was strong.'],
    ['timid', ['The new kitten was timid.', 'It hid under the couch when visitors came.', 'It only came out when the room was quiet.'], 1, ['Shy and easily scared.', 'Loud and full of play.', 'Hungry and looking for food.'], 0, 'It hid under the couch. That clue shows the kitten was shy.'],
    ['famished', ['After the long hike, the family was famished.', 'They ate three plates of pasta without stopping.', 'Nobody left a single bite.'], 1, ['Very, very hungry.', 'Very tired and sore.', 'Very cold and wet.'], 0, 'They ate three plates without stopping. That clue shows they were very hungry.'],
    ['vast', ['The ocean looked vast from the top of the cliff.', 'Blue water stretched in every direction.', 'Ships looked like tiny dots.'], 1, ['Huge and wide open.', 'Quiet and very still.', 'Warm and a bit salty.'], 0, 'Water stretched in every direction. That clue shows the ocean looked huge.'],
  ];
  return raw.map(([word, passage, evidence, opts, right, explanation]) => ({
    passage, question: `What does the word "${word}" mean?`,
    choices: opts.map((text, i) => ({ id: `${word}-${i}`, text })), correctChoiceId: `${word}-${right}`, correctEvidenceIndex: evidence, explanation,
  }));
}

function wordProblemWorkshop() {
  const P = [
    [['Ava has 14 stickers.', 'She gives 6 to her cousin.', 'How many does she have left?'], 14, 6, '-', 1, 'Giving some away takes some off, so subtract.'],
    [['There are 8 rows of chairs.', 'Each row has 6 chairs.', 'How many chairs are there in all?'], 8, 6, '*', 1, 'Equal rows join together, so multiply.'],
    [['Sam saved $12 in May.', 'He saved $9 in June.', 'How much did he save in all?'], 12, 9, '+', 1, 'Putting two amounts together means add.'],
    [['Mr. Cruz has 45 pencils.', 'He shares them equally among 5 tables.', 'How many pencils are at each table?'], 45, 5, '/', 1, 'Sharing equally means divide.'],
    [['A bakery made 36 muffins.', 'It sold 18 before noon.', 'How many muffins are left?'], 36, 18, '-', 1, 'Some were sold, so take them away.'],
    [['Each bag holds 7 apples.', 'Mia buys 9 bags.', 'How many apples does she have?'], 9, 7, '*', 1, 'Equal bags join together, so multiply.'],
    [['A book has 120 pages.', 'Leo read 45 pages on Monday.', 'How many pages are left?'], 120, 45, '-', 1, 'The pages he read come off the total.'],
    [['24 students line up in 4 equal lines.', 'How many students are in each line?'], 24, 4, '/', 0, 'Equal lines share the students, so divide.'],
    [['A store had 58 red balloons.', 'It also had 27 blue balloons.', 'How many balloons are there in all?'], 58, 27, '+', 1, 'Two groups together means add.'],
    [['Tia ran 3 miles each day.', 'She did this for 5 days.', 'How many miles did she run in all?'], 3, 5, '*', 1, 'The same amount each day means multiply.'],
    [['A ribbon is 72 inches long.', 'It is cut into 8 equal pieces.', 'How long is each piece?'], 72, 8, '/', 1, 'Equal pieces from one whole means divide.'],
    [['Ben had $30.', 'He bought a game for $18.', 'How much money does he have now?'], 30, 18, '-', 1, 'Spending takes money away, so subtract.'],
  ];
  const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const val = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b };
  return P.map(([passage, a, b, op, evidence, why], i) => {
    const choices = ['+', '-', '*', '/'].map((o) => ({ id: `wp${i}-${o === '+' ? 'add' : o === '-' ? 'sub' : o === '*' ? 'mul' : 'div'}`, text: `${a} ${SYM[o]} ${b}` }));
    const right = choices.find((c) => c.text === `${a} ${SYM[op]} ${b}`).id;
    return { passage, question: 'Which number sentence solves it?', choices, correctChoiceId: right, correctEvidenceIndex: evidence, explanation: `${why} ${a} ${SYM[op]} ${b} = ${val[op](a, b)}.` };
  });
}

function timesTableTrail() {
  const r = rng(67);
  const facts = [];
  const mult = [[2, 6], [3, 4], [5, 7], [4, 8], [6, 6], [7, 3], [9, 4], [8, 5], [6, 7], [9, 6], [7, 8], [8, 9], [3, 9], [4, 7], [10, 7], [6, 8]];
  const divs = [[12, 3], [20, 4], [35, 5], [48, 6], [56, 7], [72, 8], [81, 9], [36, 4]];
  mult.forEach(([a, b]) => facts.push({ q: `${a} × ${b} = ?`, answer: a * b, near: [a * (b + 1), (a + 1) * b, a * (b - 1), (a - 1) * b, a * b + 1, a * b - 1, a * b + 10, a * b - 10], why: `${a} × ${b} = ${a * b}. ${cap(NW[b])} groups of ${NW[a]} make ${a * b}.` }));
  divs.forEach(([n, d]) => facts.push({ q: `${n} ÷ ${d} = ?`, answer: n / d, near: [n / d + 1, n / d - 1, n / d + 2, d, n / d + 3], why: `${n} ÷ ${d} = ${n / d}, because ${n / d} × ${d} = ${n}.` }));
  return facts.map((f, i) => {
    const pool = [...new Set(f.near)].filter((n) => Number.isInteger(n) && n > 0 && n !== f.answer);
    const bad = pick(pool, 2, r);
    const choices = shuffle([f.answer, ...bad], r).map((n) => ({ id: String(n), label: String(n), feedback: n === f.answer ? 'Right.' : 'Not quite.' }));
    return { stimulusType: 'text', stimulusText: f.q, choices, correctId: String(f.answer), explanation: f.why };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Self-Awareness check-ins: no stories, only a short "Your turn" about the child (engine-scenario-choice.js ownTurn). Nothing picked is logged.
// ---------------------------------------------------------------------------------------------------------------------------------
const NOT_SURE = { id: 'not-sure', text: "I'm not sure" };
const FEELINGS = [['happy', '😊 Happy'], ['sad', '😢 Sad'], ['angry', '😡 Angry'], ['scared', '😨 Scared'], ['nervous', '😟 Nervous'], ['excited', '🤩 Excited'], ['proud', '😎 Proud'], ['calm', '😌 Calm']];

function myFeelingsToday() {
  const common = (intro, prompt) => ({
    intro, illustration: '🪞', stepWord: 'Your turn', summaryLabel: 'Questions about you', privateNote: 'Only you see your answers.',
    steps: [
      { id: 'f1', type: 'pickMany', max: 2, prompt, confirm: 'I picked these', options: FEELINGS.map(([id, text]) => ({ id, text, card: `I feel ${id}.` })), notSure: NOT_SURE },
      { id: 'f2', type: 'pickOne', prompt: 'Where do you feel it in your body?', options: [['tummy', 'My tummy'], ['chest', 'My chest'], ['face', 'My face'], ['hands', 'My hands']].map(([id, text]) => ({ id, text, card: `I feel it in ${text.toLowerCase()}.` })).concat([{ id: 'elsewhere', text: 'Somewhere else', card: 'I feel it somewhere else.' }]), notSure: NOT_SURE },
      { id: 'f3', type: 'pickOne', prompt: 'What helps you with this feeling? Pick one.', options: [
        { id: 'breaths', text: '🌬️ Slow breaths', card: 'Slow breaths help me.' }, { id: 'grownup', text: '🗣️ Tell a grown-up', card: 'Telling a grown-up helps me.' },
        { id: 'move', text: '🏃 Move around', card: 'Moving around helps me.' }, { id: 'quiet', text: '🤫 Sit somewhere quiet', card: 'Sitting somewhere quiet helps me.' }], notSure: NOT_SURE },
    ],
    result: { heading: 'My feeling card', lines: [{ text: '{item}', each: 'f1', needs: 'f1' }, { text: '{f2}', needs: ['f1', 'f2'] }, { text: '{f3}', needs: 'f3' }], emptyLine: 'That is okay. Feelings can be hard to name.', closing: 'Only you see this card. Grown-ups you trust can help with big feelings.', finish: 'Finish' },
  });
  return {
    scenarios: [],
    variants: [
      { ownTurn: common('Think about this morning. Only you see what you pick.', 'How did you feel this morning? Pick one or two.') },
      { ownTurn: common('Think about school today. Only you see what you pick.', 'How do you feel at school? Pick one or two.') },
      { ownTurn: common('Think about playing with friends. Only you see what you pick.', 'How do you feel when you play? Pick one or two.') },
    ],
  };
}

function whatHelpsMe() {
  const o = (id, text) => ({ id, text });
  return { scenarios: [], ownTurn: {
    intro: 'This is about you. Only you see what you pick.', illustration: '🧠', stepWord: 'Your turn', summaryLabel: 'Questions you answered about yourself', privateNote: 'Your answers here are private and are not saved.',
    steps: [
      { id: 'w1', type: 'pickMany', max: 2, prompt: 'Pick up to two things that help you learn.', confirm: 'These help me', options: [o('move', 'Moving a little first'), o('draw', 'Drawing or doodling'), o('talk', 'Talking it through'), o('write', 'Writing it down'), o('friend', 'Working with a friend'), o('quiet', 'A quiet spot'), o('break', 'A short break'), o('list', 'A list of steps')], notSure: { id: 'not-sure', text: "I'm not sure yet" } },
      { id: 'w2', type: 'pickOne', prompt: 'When is it hardest to focus?', options: [o('noisy', 'When it is noisy'), o('tired', 'When I am tired'), o('long', 'When the work is long'), o('worried', 'When I am worried'), o('lost', 'When I do not get it')], notSure: NOT_SURE },
      { id: 'w3', type: 'pickOne', prompt: 'What could you try this week?', options: [o('spot', 'Ask for a quiet spot'), o('breaks', 'Take a short break each 15 minutes'), o('steps', 'Make a list of steps first'), o('buddy', 'Work with a friend'), o('sketch', 'Draw it before I write')], notSure: NOT_SURE },
    ],
    result: { heading: 'What helps me', lines: [
      { text: 'What helps me learn: {w1|lower}.', needs: 'w1' }, { text: 'It is hardest for me to focus {w2|lower}.', needs: 'w2' }, { text: 'This week I will try this: {w3|lower}.', needs: 'w3' }],
      emptyLine: 'That is fine. You can find out what helps as you go.', closing: 'Knowing what helps is a strength. Only you see this card.', finish: 'Finish' },
  } };
}

function knowYourTriggers() {
  const o = (id, text) => ({ id, text });
  return { scenarios: [], ownTurn: {
    intro: 'This check-in is about you. Only you see your answers.', illustration: '🧭', stepWord: 'Your turn', summaryLabel: 'Questions you answered about yourself', privateNote: 'Your answers here are private and are not saved.',
    steps: [
      { id: 't1', type: 'pickMany', max: 3, prompt: 'Pick up to three things that make stress rise for you.', confirm: 'These are mine', options: [o('deadlines', 'Deadlines'), o('left-out', 'Being left out'), o('arguments', 'Arguments'), o('compared', 'Being compared to others'), o('changes', 'Plans changing'), o('grade', 'A bad grade'), o('watched', 'Feeling watched'), o('too-much', 'Too much to do')], notSure: { id: 'not-sure', text: "I'm not sure yet" } },
      { id: 't2', type: 'pickOne', prompt: 'What do you notice first when stress rises?', options: [o('chest', 'My chest feels tight'), o('thoughts', 'My thoughts race'), o('short', 'I get short with people'), o('quiet', 'I go quiet'), o('avoid', 'I want to avoid it'), o('sleep', 'I sleep badly')], notSure: NOT_SURE },
      { id: 't3', type: 'pickOne', prompt: 'What could help you notice it sooner?', options: [o('body', 'A quick body check'), o('name', 'Naming the feeling'), o('pause', 'A short pause'), o('write', 'Writing it down'), o('tell', 'Telling someone I trust')], notSure: NOT_SURE },
    ],
    result: { heading: 'My triggers', lines: [
      { text: 'What raises my stress: {t1|lower}.', needs: 't1' }, { text: 'First I notice: {t2|lower}.', needs: 't2' }, { text: 'What could help me notice sooner: {t3|lower}.', needs: 't3' }],
      emptyLine: 'That is fine. Triggers can take time to spot.', closing: 'Noticing comes first. If stress feels too big, talk to an adult you trust.', finish: 'Finish' },
  } };
}

function knowYourself() {
  const o = (id, text) => ({ id, text });
  const pair = (a, b, context, ta, tb) => ({ a, b, context, optionA: { text: ta, card: `When ${a} and ${b} pulled apart, I leaned toward ${a}.` }, optionB: { text: tb, card: `When ${a} and ${b} pulled apart, I leaned toward ${b}.` }, depends: `When ${a} and ${b} pulled apart, I said it depends.` });
  return { scenarios: [], ownTurn: {
    intro: 'This is about what matters to you. Only you see what you pick.', illustration: '🧭', stepWord: 'Your turn', summaryLabel: 'Questions you answered about yourself', privateNote: 'Your answers here are private and are not saved.',
    steps: [
      { id: 'top', type: 'rank', max: 3, prompt: 'Pick the three priorities that matter most to you right now, in order.', confirm: 'These are my top three', options: [o('health', 'Health'), o('family', 'Family'), o('school', 'School'), o('friends', 'Friends'), o('money', 'Money'), o('fun', 'Fun'), o('helping', 'Helping others'), o('independence', 'Independence')], notSure: { id: 'not-sure', text: "I'm not sure yet" } },
      { id: 'trade', type: 'tradeoff', fromStep: 'top', prompt: 'Which would you protect?', dependsText: 'It depends', pairs: [
        pair('health', 'school', 'It is the night before a big exam. You can sleep or keep studying until midnight.', 'Get a full night of sleep.', 'Keep studying a few more hours.'),
        pair('family', 'friends', 'Your family dinner and a friend\'s party are on the same Saturday night.', 'Go to the family dinner.', 'Go to the party.'),
        pair('money', 'fun', 'You have a free weekend. You can work an extra shift or go on a trip with friends.', 'Work the extra shift.', 'Go on the trip.'),
        pair('helping', 'independence', 'A neighbor asks for help all afternoon. You planned that time for your own project.', 'Help your neighbor.', 'Keep the time for your project.'),
        pair('school', 'fun', 'A game night is on the same evening as a big assignment.', 'Finish the assignment first.', 'Go to game night.'),
        pair('family', 'independence', 'Your family wants you home. You have a chance to try something new on your own.', 'Stay close to your family.', 'Take the chance to go it alone.'),
      ] },
      { id: 'week', type: 'pickOne', dependsOn: 'top', prompt: 'How did your week match {top.first|lower}?', promptIfNone: 'How did your week match what matters to you?', options: [
        { id: 'big', text: 'A big choice did', card: 'This week a big choice matched {top.first|lower}.' }, { id: 'small', text: 'A small choice did', card: 'This week a small choice matched {top.first|lower}.' }, { id: 'none', text: 'Not yet', card: 'My week did not match {top.first|lower} yet, and that is okay.' }], notSure: NOT_SURE },
    ],
    result: { heading: 'My priorities', lines: [{ text: 'My top three: {top|lower}.', needs: 'top' }, { text: '{trade}', needs: 'trade' }, { text: '{week}', needs: ['top', 'week'] }],
      emptyLine: 'That is fine. Priorities can take time to sort out.', closing: 'Priorities change as you do. Only you see this.', finish: 'Finish' },
  } };
}

function stressSignals() {
  const o = (id, text) => ({ id, text });
  return { scenarios: [], ownTurn: {
    intro: 'This check-in is about you. Only you see your answers.', illustration: '🪞', stepWord: 'Your turn', summaryLabel: 'Questions you answered about yourself', privateNote: 'Your answers here are private and are not saved.',
    steps: [
      { id: 's1', type: 'pickMany', max: 3, prompt: 'Which signs show up when stress builds? Pick up to three.', confirm: 'These show up', options: [o('shoulders', 'Tight shoulders or jaw'), o('stomach', 'Headaches or a tight stomach'), o('racing', 'Thoughts that will not slow down'), o('worst', 'Thinking the worst will happen'), o('snapping', 'Snapping at people'), o('pulling', 'Pulling away from friends'), o('putting-off', 'Putting things off'), o('scrolling', 'Scrolling to avoid it')], notSure: { id: 'not-sure', text: "I'm not sure yet" } },
      { id: 's2', type: 'pickOne', prompt: 'Which kind of sign is easiest for you to miss?', options: [o('body', 'Signs in my body'), o('thoughts', 'Signs in my thoughts'), o('actions', 'Signs in what I do')], notSure: NOT_SURE },
      { id: 's3', type: 'pickOne', prompt: 'What could help you check in earlier?', options: [o('daily', 'A two minute check-in each day'), o('friend', 'A friend who knows my signs'), o('note', 'A note on my phone'), o('breath', 'Slow breathing before big tasks')], notSure: NOT_SURE },
    ],
    result: { heading: 'My stress signals', lines: [
      { text: 'Signs I notice: {s1|lower}.', needs: 's1' }, { text: 'The easiest kind for me to miss: {s2|lower}.', needs: 's2' }, { text: 'What could help me check in earlier: {s3|lower}.', needs: 's3' }],
      emptyLine: 'That is fine. Signs can take time to spot.', closing: 'Everyone feels stress. If it is hard to handle, talk to a trusted adult or a counselor.', finish: 'Finish' },
  } };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The games
// ---------------------------------------------------------------------------------------------------------------------------------
const GAMES = [
  { slug: 'rhyme-time', name: 'Rhyme Time', icon: '🎵', skill: 'Rhyming', band: 'discover', domain: 'literacy', focus: 'literacy', engine: 'audioChoice', activity: 'rhyme-time-sounds', blurb: 'Listen. Find the rhyme.', desc: 'Listen to a word, then find the picture that rhymes with it.', pack: { title: 'Rhyme Time', roundsPerRun: 5, items: rhymeTime() } },
  { slug: 'letter-sounds', name: 'Letter Sounds', icon: '🔤', skill: 'Letters and Sounds', band: 'discover', domain: 'literacy', focus: 'literacy', engine: 'audioChoice', activity: 'letter-sounds-first', blurb: 'Listen. Find the letter.', desc: 'Listen to a word, then find the letter it starts with.', pack: { title: 'Letter Sounds', roundsPerRun: 5, items: letterSounds() } },
  { slug: 'more-or-fewer', name: 'More or Fewer', icon: '⚖️', skill: 'Comparing Numbers', band: 'discover', domain: 'math', focus: 'math', engine: 'audioChoice', activity: 'more-or-fewer-groups', blurb: 'Listen. Pick the group.', desc: 'Look at two groups, then pick the one with more or fewer.', pack: { title: 'More or Fewer', roundsPerRun: 5, items: moreOrFewer() } },
  { slug: 'add-it-up', name: 'Add It Up', icon: '➕', skill: 'Adding and Taking Away', band: 'discover', domain: 'math', focus: 'math', engine: 'audioChoice', activity: 'add-it-up-small', blurb: 'Listen. Find the total.', desc: 'Listen to a number story, then pick how many there are.', pack: { title: 'Add It Up', roundsPerRun: 5, items: addItUp() } },
  { slug: 'pattern-parade', name: 'Pattern Parade', icon: '🎨', skill: 'Patterns', band: 'discover', domain: 'executive', focus: 'thinking', engine: 'audioChoice', activity: 'pattern-parade-next', blurb: 'Look. What comes next?', desc: 'Look at a pattern, then pick what comes next.', pack: { title: 'Pattern Parade', roundsPerRun: 5, items: patternParade() } },
  { slug: 'animal-match', name: 'Animal Match', icon: '🐱', skill: 'Memory', band: 'discover', domain: 'executive', focus: 'thinking', engine: 'memory', activity: 'animal-match-pairs', blurb: 'Flip the cards. Find the pairs.', desc: 'Flip cards to find the animals that match.', pack: { title: 'Animal Match', items: animalMatch(), pairCount: 4 } },
  { slug: 'word-clues', name: 'Word Clues', icon: '🔎', skill: 'Vocabulary in Context', band: 'explore', domain: 'literacy', focus: 'literacy', engine: 'evidenceHunt', activity: 'word-clues-context', blurb: 'Read the clues, pick the meaning, then find the sentence that shows it.', desc: 'Find what a new word means, then show the clue that proves it.', pack: { title: 'Word Clues', roundsPerRun: 5, items: wordClues() } },
  { slug: 'times-table-trail', name: 'Times Table Trail', icon: '✖️', skill: 'Multiplication and Division Facts', band: 'explore', domain: 'math', focus: 'math', engine: 'audioChoice', activity: 'times-table-trail-facts', blurb: 'Pick the answer. No clock.', desc: 'Practice multiplication and division facts with no clock.', pack: { title: 'Times Table Trail', roundsPerRun: 8, items: timesTableTrail() } },
  { slug: 'word-problem-workshop', name: 'Word Problem Workshop', icon: '🧮', skill: 'Word Problems', band: 'explore', domain: 'math', focus: 'math', engine: 'evidenceHunt', activity: 'word-problem-workshop-operations', blurb: 'Read the problem, pick the number sentence, then find the key sentence.', desc: 'Read a word problem, pick the number sentence, then find the key sentence.', pack: { title: 'Word Problem Workshop', roundsPerRun: 5, items: wordProblemWorkshop() } },
  { slug: 'my-feelings-today', name: 'My Feelings Today', icon: '🪞', skill: 'Knowing My Feelings', band: 'discover', domain: 'sel', focus: 'self_awareness', casel: ['self_awareness'], engine: 'scenarioChoice', activity: 'my-feelings-today-checkin', blurb: 'Check in with how you feel.', desc: 'Say how you feel, where you feel it and what helps. Only you see it.', pack: Object.assign({ title: 'My Feelings Today' }, myFeelingsToday()) },
  { slug: 'what-helps-me', name: 'What Helps Me', icon: '🧠', skill: 'Knowing How I Learn', band: 'explore', domain: 'sel', focus: 'self_awareness', casel: ['self_awareness'], engine: 'scenarioChoice', activity: 'what-helps-me-checkin', blurb: 'Find out what helps you learn.', desc: 'Pick what helps you learn and focus, then try one idea. Only you see it.', pack: Object.assign({ title: 'What Helps Me' }, whatHelpsMe()) },
  { slug: 'know-your-triggers', name: 'Know Your Triggers', icon: '🧭', skill: 'Noticing Stress', band: 'challenge', domain: 'sel', focus: 'self_awareness', casel: ['self_awareness', 'self_management'], engine: 'scenarioChoice', activity: 'know-your-triggers-checkin', blurb: 'Notice what raises your stress.', desc: 'Name what raises your stress and how you notice it first. Only you see it.', pack: Object.assign({ title: 'Know Your Triggers' }, knowYourTriggers()) },
  { slug: 'know-yourself', name: 'Know Yourself', icon: '🔭', skill: 'Priorities and Values', band: 'advance', domain: 'sel', focus: 'self_awareness', casel: ['self_awareness'], engine: 'scenarioChoice', activity: 'know-yourself-checkin', blurb: 'See what matters to you.', desc: 'Rank what matters to you, face a tradeoff and see where you lean. Only you see it.', pack: Object.assign({ title: 'Know Yourself' }, knowYourself()) },
  { slug: 'stress-signals', name: 'Stress Signals', icon: '📡', skill: 'Noticing Stress Signals', band: 'advance', domain: 'sel', focus: 'self_awareness', casel: ['self_awareness', 'self_management'], engine: 'scenarioChoice', activity: 'stress-signals-checkin', blurb: 'Notice how stress shows up for you.', desc: 'Find the signs that stress is building for you and one way to check in sooner. Only you see it.', pack: Object.assign({ title: 'Stress Signals' }, stressSignals()) },
];

GAMES.push(...require('./core-games-relationships').REL);
GAMES.push(...require('./core-games-last-group').LAST);

const ENGINE_SCRIPTS = {
  audioChoice: ['engine-audio-choice.js?v=8'],
  evidenceHunt: ['engine-evidence-hunt.js?v=2'],
  scenarioChoice: ['engine-scenario-choice.js?v=10'],
  memory: ['engine-memory.js'],
};

const VOICE_SLUGS = new Set(require('./build-discover-audio').GAMES.map((v) => v.slug));

function page(g) {
  // A game that speaks has a clip manifest (scripts/build-discover-audio.js lists them): the Discover games and, since Release 167, the
  // scenario games for older children too.
  const voiced = g.engine !== 'memory' && VOICE_SLUGS.has(g.slug);
  const scripts = [
    'referral.js?v=1', 'nav.js?v=22', 'site-auth.js?v=12', 'footer.js?v=18', 'accessibility-utils.js', 'game-shell.js?v=3', 'engine-sdk.js?v=6',
  ].concat(voiced ? ['assets/audio/discover/' + g.slug + '.js?v=00000000', 'engine-voice.js?v=3'] : ['audioChoice', 'scenarioChoice'].includes(g.engine) ? ['engine-voice.js?v=3'] : [], ENGINE_SCRIPTS[g.engine]);
  const json = JSON.stringify(g.pack, null, 2).replace(/\n/g, '\n  ');
  const engineKind = { audioChoice: 'Audio Choice', evidenceHunt: 'Evidence Hunt', scenarioChoice: 'Scenario Choice (a "Your turn" check-in with no stories)', memory: 'Memory' }[g.engine];
  const skipStart = g.engine === 'memory' ? `
  // Animal Match: ?pairs=3, 4 or 6 sets the number of pairs (4 by default). No clock and no score to beat.
  const wantPairs = Number(params.get('pairs'));
  if ([3, 4, 6].includes(wantPairs)) contentPack.pairCount = wantPairs;
` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="icon" type="image/png" sizes="32x32" href="/api/settings/favicon?size=32">
<link rel="icon" type="image/png" sizes="16x16" href="/api/settings/favicon?size=16">
<link rel="apple-touch-icon" href="/api/settings/favicon?size=180">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Fixer Nation Education - ${g.name}</title>
<link rel="stylesheet" href="fonts.css?v=1">
<link rel="stylesheet" href="brain-games.css?v=7">
</head>
<body>
<header></header>

<div class="game-frame">
  <p id="loginHint" style="font-size:12px;color:var(--ink-soft);text-align:center;margin-bottom:12px;"></p>
  <div id="mount" class="game-card-panel band-aware"></div>
</div>

<footer></footer>
${scripts.map((s) => `<script src="${s}"></script>`).join('\n')}
<script>
  // ${g.name} - Tune Your Brain (${g.band} band). GENERATED by server/scripts/build-core-games.js: change the content there, not here.
  // Engine: ${engineKind}. Focus: ${g.focus.replace(/_/g, ' ')}. Release ${g.release || 141}.
  const params = new URLSearchParams(location.search);
  const band = params.get('band') || '${g.band}';

  const contentPack = ${json};
${skipStart}
  fetch('/api/brain-games/me/progress').then((r) => {
    if (!r.ok) {
      document.getElementById('loginHint').textContent =
        'Playing without an account or classroom login, so progress won\\'t be saved.';
    }
  }).catch(() => {});

  FnEngineSDK.run({
    container: document.getElementById('mount'),
    engineName: '${g.engine}',
    engineVersion: 1,
    contentPack,
    band,
    activityId: '${g.activity}',
    header: {
      icon: '${g.icon}',
      title: '${g.name}',
      description: '${g.blurb.replace(/'/g, "\\'")}',
    },
  });
</script>
<script src="game-backlink.js?v=1" defer></script>
</body>
</html>
`;
}

function seed(g) {
  const casel = g.casel ? `'${g.casel.join(',')}'` : 'null';
  return `// Release ${g.release || 141} - adds ${g.name} as a real, assignable entry in the classroom game-assignment flow, by extending the brain_games catalog table.
// ${g.band} band, focus ${g.focus}. Generated by server/scripts/build-core-games.js.
// reward_pipeline is left unset so it defaults to 'classroom_generic'; run seed-classroom-completion-badges.js separately to add its badge,
// and seed-brain-games-focus-values.js to confirm the focus.
//
// Safe to re-run: skipped if a row with this slug already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });

  const [[existing]] = await conn.query('SELECT id FROM brain_games WHERE slug = ?', ['${g.slug}']);
  if (existing) {
    console.log('Skipped: ${g.slug} already in brain_games catalog (id=' + existing.id + ')');
  } else {
    const [[maxOrder]] = await conn.query('SELECT MAX(display_order) AS m FROM brain_games');
    await conn.query(
      \`INSERT INTO brain_games (name, slug, description, icon, primary_skill, display_order, band, domain, casel_competencies, focus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)\`,
      [
        ${JSON.stringify(g.name)}, '${g.slug}',
        ${JSON.stringify(g.desc)},
        '${g.icon}', ${JSON.stringify(g.skill)}, (maxOrder?.m || 0) + 1,
        '${g.band}', '${g.domain}', ${casel}, '${g.focus}',
      ]
    );
    console.log('Added: ${g.slug} to brain_games catalog');
  }

  await conn.end();
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
`;
}

function main() {
  const only = process.argv.slice(2);
  for (const g of GAMES) {
    if (only.length && !only.includes(g.slug)) continue;
    // Keep the manifest cache number the audio builder wrote, if the page already exists.
    let html = page(g);
    const file = path.join(ROOT, `brain-${g.slug}.html`);
    if (fs.existsSync(file)) {
      const old = fs.readFileSync(file, 'utf8').match(/assets\/audio\/discover\/[a-z-]+\.js\?v=([0-9a-f]{8})/);
      if (old) html = html.replace('?v=00000000', `?v=${old[1]}`);
    }
    fs.writeFileSync(file, html);
    fs.writeFileSync(path.join(SCRIPTS, `seed-${g.slug}-catalog-entry.js`), seed(g));
    console.log('wrote', g.slug);
  }
}

module.exports = { GAMES, page, seed };
if (require.main === module) main();

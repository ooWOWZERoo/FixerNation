// Every game that speaks (the audio-led Discover games and, since Release 167, the Explore-and-up scenario games) speaks with recorded clips
// of the game voice, Kokoro "Heart" (Releases 131 and 167). There is no browser voice. Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { plan, manifestSource, fileFor, clipFor, clean, OUT, VOICE_TAG } = require('../scripts/build-discover-audio.js');
const { extractPack, ROOT } = require('../scripts/audit-brain-games.js');

const { games, clips } = plan();

test('every line a Discover game can speak has a recorded clip, and no clip is left over', () => {
  assert.equal(games.length, 21); // the original five, six from Release 141, two from 143, two from 144 and six from Release 167
  clips.forEach((c, file) => assert.ok(fs.existsSync(path.join(OUT, file)) && fs.statSync(path.join(OUT, file)).size > 1500, `no clip for "${c.text}"`));
  const onDisk = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp3'));
  assert.equal(onDisk.length, clips.size, 'stray clips: run node scripts/build-discover-audio.js --audio');
});

test('each game page loads its manifest, then the shared voice, then its engine; the manifest is up to date', () => {
  games.forEach((g) => {
    const html = fs.readFileSync(g.page, 'utf8');
    const m = html.indexOf(`assets/audio/discover/${g.slug}.js`), v = html.indexOf('engine-voice.js'), e = html.search(/engine-(audio|scenario)-choice\.js/);
    assert.ok(m > 0 && v > m && e > v, `${g.slug}: script order is manifest, voice, engine`);
    assert.equal(fs.readFileSync(path.join(OUT, `${g.slug}.js`), 'utf8'), manifestSource(g), `${g.slug}: manifest is out of date`);
    assert.match(html, /engine-(audio|scenario)-choice\.js\?v=(8|10)/);
  });
  // Sound Safari names its own clips but needs the same voice player.
  assert.match(fs.readFileSync(path.join(ROOT, 'brain-sound-safari.html'), 'utf8'), /engine-voice\.js\?v=3/);
});

test('the games have real variety: bigger pools, a short run drawn from them', () => {
  const need = { 'calm-down-corner': 16, 'sharing-circle': 16, 'helpers-choice': 16, 'same-and-different': 24, 'feelings-detective': 12, 'rhyme-time': 16, 'letter-sounds': 12, 'more-or-fewer': 14, 'add-it-up': 16, 'pattern-parade': 14, 'asking-nicely': 12, 'team-tower': 12, 'wait-for-it': 12, 'stop-and-think': 12 };
  games.forEach((g) => {
    const pack = extractPack(fs.readFileSync(g.page, 'utf8'));
    if (!need[g.slug]) return; // the six reader-band scenario games are held to their own tests (own-turn.test.js, explore-games.test.js)
    if (g.slug === 'my-feelings-today') return; // a check-in about the child: no stories, three openings instead (new-games.test.js)
    const n = (pack.items || pack.scenarios).length;
    assert.ok(n >= need[g.slug], `${g.slug}: ${n} rounds`);
    assert.ok(pack.roundsPerRun >= 3 && pack.roundsPerRun < n, `${g.slug}: roundsPerRun ${pack.roundsPerRun}`);
  });
  ['calm-down-corner', 'sharing-circle', 'helpers-choice'].forEach((slug) => {
    extractPack(fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8')).items.forEach((it, i) => {
      assert.ok(it.explanation, `${slug} round ${i + 1} explains why`);
      it.choices.forEach((c) => assert.ok(c.feedback, `${slug} round ${i + 1}: ${c.id} has spoken feedback`));
    });
  });
});

test('engine-voice.js plays a clip for each line it has, skips a line with no clip, and never uses a browser voice', () => {
  const played = [], spoken = [];
  const win = { FnAudioManifest: { 'Hello there.': 'a.mp3', 'Pick one.': 'b.mp3' }, speechSynthesis: { speak: (u) => spoken.push(u.text), cancel() { spoken.push('cancel'); } } };
  function Audio(u) { this.url = u; this.addEventListener = (ev, fn) => { if (ev === 'ended') setImmediate(fn); }; this.play = () => { played.push(u); return Promise.resolve(); }; this.pause = () => {}; }
  const ctx = { window: win, Audio, SpeechSynthesisUtterance: function (t) { this.text = t; }, setTimeout, clearTimeout, setImmediate, Promise, Number, String, Object };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'engine-voice.js'), 'utf8'), ctx);
  const r = win.FnVoice.say(['😀 Hello there.', 'Pick one.'], { gapMs: 0 });
  assert.ok(r.done, 'clips are playing');
  return r.done.then((ok) => {
    assert.equal(ok, true);
    assert.deepEqual(played, ['a.mp3', 'b.mp3']);
    played.length = 0;
    const r2 = win.FnVoice.say(['Hello there.', 'No clip for this line'], { gapMs: 0 });
    assert.ok(r2.done, 'the line that has a clip still plays');
    return r2.done.then(() => {
      assert.deepEqual(played, ['a.mp3'], 'the line with no clip is skipped');
      const r3 = win.FnVoice.say(['No clip for this line', 'Nor this one']);
      assert.equal(r3.done, null, 'nothing to play');
      assert.deepEqual(spoken, [], 'the browser voice is never asked to speak or even cancel');
      assert.equal(clean('  🙂 Hi   there '), 'Hi there');
    });
  });
});

test('when the browser blocks sound before a tap, a "Tap to hear" button appears, and one tap plays the line', () => {
  const played = [], pills = [];
  let blockedOnce = true;
  const doc = {
    body: { appendChild: (el) => pills.push(el) },
    createElement: () => ({ listeners: {}, style: {}, setAttribute() {}, addEventListener(ev, fn) { this.listeners[ev] = fn; }, parentNode: null }),
    getElementById: () => pills.find((p) => p.id === 'fnVoicePill' && !p.removed) || null,
  };
  function Audio(u) { this.url = u; this.listeners = {}; this.addEventListener = (ev, fn) => { this.listeners[ev] = fn; }; this.pause = () => {};
    this.play = () => { if (blockedOnce) { blockedOnce = false; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); } played.push(u); setImmediate(() => this.listeners.ended && this.listeners.ended()); return Promise.resolve(); }; }
  const win = { FnAudioManifest: { 'Hello there.': 'a.mp3' } };
  const ctx = { window: win, document: doc, Audio, setTimeout, clearTimeout, setImmediate, Promise, Number, String, Object };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'engine-voice.js'), 'utf8'), ctx);
  const r = win.FnVoice.say(['Hello there.'], { gapMs: 0 });
  return new Promise((res) => setImmediate(res)).then(() => {
    assert.equal(pills.length, 1, 'one button is shown');
    assert.match(pills[0].textContent, /Tap to hear/);
    assert.equal(played.length, 0, 'nothing played yet');
    pills[0].parentNode = { removeChild: (el) => { el.removed = true; } };
    pills[0].listeners.click();
    return r.done.then((ok) => { assert.equal(ok, true); assert.deepEqual(played, ['a.mp3']); });
  });
});

test('no page, engine or script uses the browser voice any more', () => {
  const offenders = [];
  const files = fs.readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f));
  for (const f of files) if (/speechSynthesis|SpeechSynthesisUtterance/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))) offenders.push(f);
  assert.deepEqual(offenders, [], 'these files still call the browser voice');
});

test('a letter name is its own clip, said from phonemes: the letter B and the insect "bee" never share a file', () => {
  const letters = games.find((g) => g.slug === 'letter-sounds');
  const rhyme = games.find((g) => g.slug === 'rhyme-time');
  assert.equal(letters.letters.bee, 'B');
  assert.equal(letters.letters.are, 'R');
  assert.equal(letters.letters['double you'], 'W');
  const asLetter = clipFor(letters, 'bee'), asWord = clipFor(rhyme, 'bee');
  assert.notEqual(asLetter.file, asWord.file);
  assert.equal(asLetter.voice, 'Letter. [B](/bˈi/).');
  assert.equal(asLetter.keepLast, true, 'only the part after the lead-in word is kept');
  assert.equal(asWord.voice, 'bee');
  assert.equal(clipFor(letters, 'are').voice, 'Letter. [R](/ˈɑɹ/).');
  assert.equal(clipFor(letters, 'Ball starts with the letter B.').voice, 'Ball starts with the letter [B](/bˈi/).');
  // every letter answer in the game has its own letter clip
  const pack = extractPack(fs.readFileSync(letters.page, 'utf8'));
  for (const it of pack.items) for (const c of it.choices) assert.ok(letters.letters[clean(c.say)], `${c.say} is read as the letter ${c.id}`);
});

test('the six reader-band scenario games have clips for the lines their engine speaks, and none for lines it never speaks', () => {
  for (const slug of ['strength-spotter', 'values-compass', 'know-yourself', 'know-your-triggers', 'stress-signals', 'what-helps-me']) {
    const g = games.find((x) => x.slug === slug);
    assert.ok(g, `${slug} is in the clip list`);
    const pack = extractPack(fs.readFileSync(g.page, 'utf8'));
    assert.ok(g.lines.length >= 20, `${slug}: ${g.lines.length} lines`);
    for (const sc of pack.scenarios || []) {
      assert.ok(g.lines.includes(clean(sc.context)), `${slug}: the story is spoken`);
      assert.ok(!g.lines.includes(clean(sc.reinforcement)), `${slug}: feedback is on screen only in the reader bands`);
    }
    assert.ok(g.lines.every((l) => !/[{}]/.test(l)), `${slug}: a line with a {token} cannot have a recording`);
    assert.match(fs.readFileSync(g.page, 'utf8'), new RegExp(`assets/audio/discover/${slug}\\.js\\?v=`), `${slug} loads its manifest`);
  }
});

test('every clip name carries the voice tag, so changing the voice gives every clip a new address', () => {
  assert.match(VOICE_TAG, /^kokoro-af_heart-\d+$/);
  assert.equal(fileFor('Hello'), require('node:crypto').createHash('sha1').update(`${VOICE_TAG}|Hello`).digest('hex').slice(0, 12) + '.mp3');
});

test('the line a game speaks is looked up exactly as the content has it (emoji removed, spaces collapsed)', () => {
  const t = '😢 Sad';
  assert.equal(clean(t), 'Sad');
  assert.equal(fileFor(clean(t)), fileFor('Sad'));
});

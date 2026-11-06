// The five audio-led Discover games speak with recorded Ava clips (Release 131). Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { plan, manifestSource, fileFor, clean, OUT } = require('../scripts/build-discover-audio.js');
const { extractPack, ROOT } = require('../scripts/audit-brain-games.js');

const { games, clips } = plan();

test('every line a Discover game can speak has a recorded clip, and no clip is left over', () => {
  assert.equal(games.length, 11); // the original five plus six from Release 141
  clips.forEach((text, file) => assert.ok(fs.existsSync(path.join(OUT, file)) && fs.statSync(path.join(OUT, file)).size > 1500, `no clip for "${text}"`));
  const onDisk = fs.readdirSync(OUT).filter((f) => f.endsWith('.mp3'));
  assert.equal(onDisk.length, clips.size, 'stray clips: run node scripts/build-discover-audio.js --audio');
});

test('each game page loads its manifest, then the shared voice, then its engine; the manifest is up to date', () => {
  games.forEach((g) => {
    const html = fs.readFileSync(g.page, 'utf8');
    const m = html.indexOf(`assets/audio/discover/${g.slug}.js`), v = html.indexOf('engine-voice.js'), e = html.search(/engine-(audio|scenario)-choice\.js/);
    assert.ok(m > 0 && v > m && e > v, `${g.slug}: script order is manifest, voice, engine`);
    assert.equal(fs.readFileSync(path.join(OUT, `${g.slug}.js`), 'utf8'), manifestSource(g), `${g.slug}: manifest is out of date`);
    assert.match(html, /engine-(audio|scenario)-choice\.js\?v=(7|9)/);
  });
  // Sound Safari names its own clips but needs the same voice player.
  assert.match(fs.readFileSync(path.join(ROOT, 'brain-sound-safari.html'), 'utf8'), /engine-voice\.js\?v=1/);
});

test('the games have real variety: bigger pools, a short run drawn from them', () => {
  const need = { 'calm-down-corner': 16, 'sharing-circle': 16, 'helpers-choice': 16, 'same-and-different': 24, 'feelings-detective': 12, 'rhyme-time': 16, 'letter-sounds': 12, 'more-or-fewer': 14, 'add-it-up': 16, 'pattern-parade': 14 };
  games.forEach((g) => {
    const pack = extractPack(fs.readFileSync(g.page, 'utf8'));
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

test('engine-voice.js plays a clip per line when every line has one, and the browser voice when any is missing', () => {
  const played = [], spoken = [];
  const win = { FnAudioManifest: { 'Hello there.': 'a.mp3', 'Pick one.': 'b.mp3' }, speechSynthesis: { speak: (u) => spoken.push(u.text), cancel() {} } };
  function Audio(u) { this.url = u; this.addEventListener = (ev, fn) => { if (ev === 'ended') setImmediate(fn); }; this.play = () => { played.push(u); return Promise.resolve(); }; this.pause = () => {}; }
  const ctx = { window: win, Audio, SpeechSynthesisUtterance: function (t) { this.text = t; }, setTimeout, clearTimeout, setImmediate, Promise, Number, String, Object };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'engine-voice.js'), 'utf8'), ctx);
  const r = win.FnVoice.say(['😀 Hello there.', 'Pick one.'], { gapMs: 0 });
  assert.ok(r.done, 'clips are playing');
  return r.done.then((ok) => {
    assert.equal(ok, true);
    assert.deepEqual(played, ['a.mp3', 'b.mp3']);
    const r2 = win.FnVoice.say(['Hello there.', 'No clip for this line'], { rate: 0.8 });
    assert.equal(r2.done, null);
    assert.deepEqual(spoken, ['Hello there. No clip for this line.']);
    assert.equal(clean('  🙂 Hi   there '), 'Hi there');
  });
});

test('the line a game speaks is looked up exactly as the content has it (emoji removed, spaces collapsed)', () => {
  const t = '😢 Sad';
  assert.equal(clean(t), 'Sad');
  assert.equal(fileFor(clean(t)), fileFor('Sad'));
});

// Sound Safari (Release 130): a pool of at least 50 sound-to-picture rounds, said once at a slow pace by the recorded Ava
// voice, with the page generated from server/scripts/build-sound-safari.js. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractPack, ROOT } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));
const { buildRounds, clipList, pageBlock, SOUNDS, LOOKALIKE, pictureOf, CLIPS_DIR } = require(path.join(__dirname, '..', 'scripts', 'build-sound-safari.js'));

const page = fs.readFileSync(path.join(ROOT, 'brain-sound-safari.html'), 'utf8');
const pack = extractPack(page);
const rounds = buildRounds();

test('the pool has at least 50 rounds, each run draws a short set from it, and ids are unique', () => {
  assert.ok(pack.items.length >= 50, `${pack.items.length} rounds`);
  assert.equal(pack.items.length, rounds.length);
  assert.ok(pack.roundsPerRun >= 4 && pack.roundsPerRun <= 8 && pack.roundsPerRun < pack.items.length);
  assert.equal(new Set(pack.items.map((i) => i.id)).size, pack.items.length);
  assert.ok(new Set(rounds.map((r) => r.sound)).size >= 15, 'many different sounds, not just a few');
});

test('the page matches the generator (run: cd server && node scripts/build-sound-safari.js)', () => {
  assert.ok(page.includes(pageBlock(rounds)), 'brain-sound-safari.html is out of date with build-sound-safari.js');
});

test('each round: the sound is said once, the answer starts with it, the other two do not and are not look-alike sounds', () => {
  rounds.forEach((r) => {
    const said = r.line.split(r.say).length - 1;
    assert.equal(said, 1, `${r.key}: the sound "${r.say}" is said ${said} times in "${r.line}"`);
    assert.ok(r.line.endsWith('?') && /Which picture starts with/.test(r.line));
    assert.equal(pictureOf[r.answer].sound, r.sound);
    assert.equal(r.choices.length, 3);
    assert.equal(new Set(r.choices.map((c) => c.word)).size, 3);
    const others = r.choices.filter((c) => c.word !== r.answer);
    others.forEach((c) => {
      assert.notEqual(c.sound, r.sound, `${r.key}: ${c.word} also starts with ${r.sound}`);
      assert.notEqual(LOOKALIKE[r.sound], c.sound, `${r.key}: ${c.word} sounds too much like the answer`);
      assert.notEqual(c.word, r.model);
    });
    assert.notEqual(others[0].sound, others[1].sound, `${r.key}: the two wrong pictures start with the same sound`);
    assert.notEqual(r.model, r.answer);
  });
  Object.keys(SOUNDS).forEach((s) => assert.ok(rounds.some((r) => r.sound === s), `sound ${s} is used`));
});

test('every clip the page names exists, and every round plays the voice instead of the browser voice', () => {
  const urls = new Set();
  pack.items.forEach((it) => {
    assert.ok(it.stimulusAudioUrl && it.feedbackAudio.right.length === 2 && it.feedbackAudio.miss.length === 2, `${it.id}: voice clips`);
    urls.add(it.stimulusAudioUrl);
    it.feedbackAudio.right.concat(it.feedbackAudio.miss).forEach((u) => urls.add(u));
    it.choices.forEach((c) => { assert.ok(c.audioUrl, `${it.id}/${c.id}: name clip`); urls.add(c.audioUrl); });
  });
  [...urls].forEach((u) => assert.ok(fs.existsSync(path.join(ROOT, u)) && fs.statSync(path.join(ROOT, u)).size > 1000, `missing or empty clip ${u}`));
  const needed = [...clipList(rounds).keys()];
  needed.forEach((f) => assert.ok(fs.existsSync(path.join(CLIPS_DIR, f)), `clip ${f} was not rendered`));
  assert.equal(fs.readdirSync(CLIPS_DIR).filter((f) => f.endsWith('.mp3')).length, needed.length, 'no stray clips');
});

test('the slow fallback voice and the pacing gap are set, and the page loads the newer engine', () => {
  assert.ok(pack.speechRate > 0 && pack.speechRate <= 0.9, 'browser-voice fallback is a little slower than normal');
  assert.ok(pack.audioGapMs >= 300 && pack.audioGapMs <= 600);
  assert.match(page, /engine-audio-choice\.js\?v=5/);
  const engine = fs.readFileSync(path.join(ROOT, 'engine-audio-choice.js'), 'utf8');
  assert.match(engine, /playClips/);
  assert.match(engine, /speechRate/);
});

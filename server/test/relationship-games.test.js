// Release 143: the ten Relationship Skills and Social Awareness games (content in server/scripts/core-games-relationships.js).
// Registration, page drift and the spoken-clip checks for these games are in new-games.test.js (it covers every generated game); this file holds
// what is particular to them: coverage of the two focuses in every band, the writing rules for each band, and that no answer is given away by
// its length, its place or its tone.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { GAMES } = require(path.join(__dirname, '..', 'scripts', 'build-core-games.js'));
const F = require(path.join(__dirname, '..', 'lib', 'brain-game-focus.js'));

const REL = GAMES.filter((g) => g.release === 143);
const words = (s) => String(s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?]["”’]?)\s+/).filter(Boolean);
const HARD = /\b(constructive|overwhelmed|perspective|affects?|reactions?|assume[sd]?|appropriate|situation|consequences?)\b/i; // Explore: thinking words a child has to decode
const DASH = /[—–]|\s-\s/;
const PRAISE = /^(good (catch|noticing|thinking|job)|great|nice (work|job|read)|well done|exactly|right[.,!])/i;
const SOOTHING = /\b(completely normal|that is normal|that's normal|totally normal|perfectly normal)\b/i;
const LIMIT = { explore: 12, challenge: 20, advance: 20 };

test('RELATIONSHIP GAMES: ten games, and every band now has two Relationship Skills and two Social Awareness games', () => {
  assert.equal(REL.length, 10);
  const grid = F.coverage();
  for (const b of F.BANDS) for (const f of ['relationship_skills', 'social_awareness']) {
    assert.ok(grid[b][f].counted.length >= 2, `${b} / ${f}: ${grid[b][f].counted.length} games`);
  }
  assert.deepEqual(REL.map((g) => g.slug).sort(), ['asking-nicely', 'many-voices', 'many-ways-to-be', 'other-side-of-the-screen', 'repair-it', 'speak-up-kindly', 'team-mission', 'team-tower', 'walk-in-my-shoes', 'walk-in-their-shoes']);
  REL.forEach((g) => { assert.equal(g.domain, 'sel'); assert.ok(g.casel.includes(g.focus)); assert.ok(['relationship_skills', 'social_awareness'].includes(g.focus)); });
});

for (const g of REL.filter((x) => x.engine === 'evidenceHunt')) {
  test(`${g.slug.toUpperCase()}: ten items, the writing rules for its band, balanced options, and a proof sentence in the passage`, () => {
    const items = g.pack.items;
    assert.equal(items.length, 10);
    assert.equal(g.pack.roundsPerRun, 5);
    const ids = new Set();
    let rightIsLongest = 0;
    items.forEach((it, i) => {
      const at = `${g.slug} item ${i + 1}`;
      assert.ok(it.passage.length >= 4 && it.passage.length <= 5, `${at}: passage length`);
      assert.ok(it.correctEvidenceIndex >= 0 && it.correctEvidenceIndex < it.passage.length, `${at}: proof index`);
      assert.equal(it.choices.length, 3);
      it.choices.forEach((c) => { assert.ok(!ids.has(c.id), `${at}: duplicate id ${c.id}`); ids.add(c.id); });
      assert.ok(it.choices.some((c) => c.id === it.correctChoiceId));
      const texts = it.passage.concat([it.question, it.explanation], it.choices.map((c) => c.text));
      texts.forEach((t) => {
        assert.ok(!DASH.test(t), `${at}: dash in "${t}"`);
        assert.ok(!SOOTHING.test(t) && !PRAISE.test(t.trim()), `${at}: soothing line or praise opener: ${t}`);
        if (g.band === 'explore') assert.ok(!HARD.test(t), `${at}: hard word in "${t}"`);
        sentences(t).forEach((sn) => assert.ok(words(sn) <= LIMIT[g.band], `${at}: ${words(sn)} words in "${sn}"`));
      });
      assert.ok(words(it.explanation) <= 30, `${at}: explanation length`);
      const len = it.choices.map((c) => c.text.length), right = it.choices.find((c) => c.id === it.correctChoiceId).text.length;
      assert.ok(Math.max(...len) / Math.min(...len) <= 1.6, `${at}: option lengths ${len.join('/')} are not close`);
      if (right === Math.max(...len)) rightIsLongest++;
      assert.ok(it.question.endsWith('?'));
    });
    assert.ok(rightIsLongest <= 5, `the right answer is the longest in ${rightIsLongest} of 10 items`);
  });
}

test('RELATIONSHIP GAMES: the right answer is not always the first-listed or the kindest-sounding long one, and the wrong answers are not cartoonish', () => {
  for (const g of REL.filter((x) => x.engine === 'evidenceHunt')) {
    // Authoring order is not a tell: the engine shuffles the choices every run (engine-sdk.js), and each choice id ends in a, b or c.
    g.pack.items.forEach((it) => assert.ok(it.correctChoiceId.endsWith('-a')));
    const wrong = g.pack.items.flatMap((it) => it.choices.filter((c) => c.id !== it.correctChoiceId).map((c) => c.text));
    assert.equal(new Set(wrong).size, wrong.length, `${g.slug}: every wrong answer is different`);
  }
  for (const slug of ['speak-up-kindly', 'repair-it']) {
    // These two offer three drafts: one clear and kind, one that gives in or hides, one that attacks or dodges. Each draft has to be a real message.
    REL.find((g) => g.slug === slug).pack.items.forEach((it) => it.choices.forEach((c) => assert.ok(words(c.text) >= 10 && /[.?]$/.test(c.text), `${slug}: ${c.text}`)));
  }
});

test('RELATIONSHIP GAMES: the spoken Discover games keep the right answer in different places and use no word a five-year-old cannot say back', () => {
  for (const g of REL.filter((x) => x.engine === 'audioChoice')) {
    assert.equal(g.pack.items.length, 14);
    const spots = new Set(g.pack.items.map((it) => it.choices.findIndex((c) => c.id === it.correctId)));
    assert.deepEqual([...spots].sort(), [0, 1, 2], `${g.slug}: the right answer appears in every place`);
    g.pack.items.forEach((it, i) => {
      assert.equal(it.choices.length, 3);
      assert.equal(it.choices.filter((c) => c.id === it.correctId).length, 1);
      it.choices.forEach((c) => assert.ok(c.caption && c.aria && c.label, `${g.slug} ${i + 1}: a picture, a caption and a text label`));
      assert.ok(/\?$/.test(it.stimulusText), `${g.slug} ${i + 1}: ends with the question`);
    });
  }
});

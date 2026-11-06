// Release 87: the six Discover games (ages 5-6) are held to the rules in docs/tune-your-brain/R87_DISCOVER_REWRITE_OUTLINE.md:
// short spoken sentences, a question that ends every spoken line, a short caption or spoken name on every picture,
// concrete words, no dashes, short feedback, and engines that actually speak the question, the answers and the feedback.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { auditAll, extractPack, ROOT } = require(path.join(__dirname, '..', 'scripts', 'audit-brain-games.js'));

const DISCOVER = ['calm-down-corner', 'sharing-circle', 'helpers-choice', 'feelings-detective', 'sound-safari', 'same-and-different'];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const packOf = (slug) => extractPack(read(`brain-${slug}.html`));
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?])\s+/).filter(Boolean);
const NO_DASH = /[—–]/;
// Abstract words a five-year-old should not have to decode (naming a feeling in Feelings Detective is that game's lesson).
const HARD = /\b(responsible|frustrated|embarrassed|constructive|perspective|annoyed|appropriate|situation)\b/i;

test('DISCOVER: all six games are bands "discover" pages that parse', () => {
  for (const slug of DISCOVER) {
    const src = read(`brain-${slug}.html`);
    assert.match(src, /params\.get\('band'\) \|\| 'discover'/, `${slug} is a Discover page`);
    assert.ok(packOf(slug), `${slug} pack parses`);
  }
});

for (const slug of DISCOVER.filter((s) => s !== 'feelings-detective')) {
  test(`${slug}: short spoken story ending in the question, a caption or spoken name on every picture`, () => {
    const pack = packOf(slug);
    assert.ok(pack.items.length >= 4);
    pack.items.forEach((it, i) => {
      const spoken = it.stimulusText;
      assert.ok(/\?$/.test(spoken), `${slug} item ${i + 1}: the spoken line ends with the question`);
      assert.ok(words(spoken) <= 26, `${slug} item ${i + 1}: ${words(spoken)} words spoken`);
      sentences(spoken).forEach((sn) => assert.ok(words(sn) <= 12, `${slug} item ${i + 1}: sentence too long: ${sn}`));
      assert.ok(!NO_DASH.test(spoken) && !HARD.test(spoken), `${slug} item ${i + 1}: dash or hard word in the spoken line`);
      assert.equal(it.choices.length, 3);
      it.choices.forEach((c) => {
        assert.ok(c.label && c.aria, `${slug} item ${i + 1}: picture and aria on ${c.id}`);
        if (slug !== 'sound-safari') {
          assert.ok(c.caption && words(c.caption) <= 4, `${slug} item ${i + 1}: caption on ${c.id}`);
          assert.ok(!NO_DASH.test(c.caption) && !HARD.test(c.caption));
        }
        if (c.feedback) assert.ok(words(c.feedback) <= 15, `${slug} item ${i + 1}: feedback too long on ${c.id}: ${c.feedback}`);
      });
      if (it.explanation) assert.ok(words(it.explanation) <= 16, `${slug} item ${i + 1}: explanation too long`);
    });
  });
}

test('calm-down-corner, sharing-circle, helpers-choice: one question each, and the headers are two short sentences', () => {
  const asks = { 'calm-down-corner': 'What helps you feel calm?', 'sharing-circle': 'What is kind?', 'helpers-choice': 'What is the right thing to do?' };
  for (const [slug, ask] of Object.entries(asks)) {
    packOf(slug).items.forEach((it, i) => assert.ok(it.stimulusText.endsWith(ask), `${slug} ${i + 1} ends with "${ask}"`));
    const header = read(`brain-${slug}.html`).match(/description: '([^']+)'/)[1];
    assert.ok(words(header) <= 8 && sentences(header).length === 2, `${slug} header: ${header}`);
  }
});

test('sound-safari: the voice says the sound and the question without slashes, and the words button asks the question', () => {
  packOf('sound-safari').items.forEach((it, i) => {
    assert.ok(!/[\/]/.test(it.stimulusText), `item ${i + 1}: no /m/ notation in the spoken line`);
    assert.ok(/Which picture starts with/.test(it.stimulusText) && /\?$/.test(it.stimulusText));
    assert.ok(it.words && /\?$/.test(it.words), `item ${i + 1}: on-screen words`);
  });
});

test('same-and-different: spoken stories are about 20 words, shuffled answers keep their captions', () => {
  const pack = packOf('same-and-different');
  assert.ok(pack.items.length >= 24, 'a pool of at least 24 rounds');
  assert.ok(pack.roundsPerRun >= 4 && pack.roundsPerRun < pack.items.length);
  pack.items.forEach((it, i) => {
    assert.ok(words(it.stimulusText) <= 26, `round ${i + 1}: ${words(it.stimulusText)} words`);
    assert.equal(it.stimulusText, it.transcript, `round ${i + 1}: the screen-reader text equals the spoken text`);
    it.choices.forEach((c) => assert.ok(!/\s/.test(c.label.trim()), `round ${i + 1}: ${c.id} label is just the picture`));
  });
});

test('feelings-detective: clues and feelings are short and carry a picture; prompts are Discover wording; the private check-in stays private', () => {
  const pack = packOf('feelings-detective');
  assert.ok(pack.scenarios.length >= 12, 'a pool of at least 12 stories');
  assert.ok(pack.roundsPerRun >= 3 && pack.roundsPerRun < pack.scenarios.length);
  assert.equal(pack.prompts.pick, 'How might they feel? Pick one or more.');
  assert.ok(!/\(s\)/.test(JSON.stringify(pack.prompts)), 'no "(s)" in the prompts');
  const emoji = /\p{Extended_Pictographic}/u;
  pack.scenarios.forEach((sc, i) => {
    assert.ok(words(sc.context) <= 9, `story ${i + 1}: context too long`);
    sc.cues.forEach((c) => {
      assert.ok(emoji.test(c.text), `story ${i + 1}: clue has a picture: ${c.text}`);
      assert.ok(words(c.text.replace(/\p{Extended_Pictographic}/gu, '')) <= 7, `story ${i + 1}: clue too long: ${c.text}`);
    });
    assert.equal(sc.cues.filter((c) => c.present).length, 2, `story ${i + 1}: two clues are really there`);
    sc.feelings.forEach((f) => assert.ok(emoji.test(f.text), `story ${i + 1}: feeling has a face: ${f.text}`));
    assert.equal(sc.feelings.filter((f) => f.tag === 'less_fitting').length, 1);
    [sc.reinforcement, sc.feelings.find((f) => f.note) && sc.feelings.find((f) => f.note).note, sc.seekHelp && sc.seekHelp.text].filter(Boolean)
      .forEach((line) => assert.ok(words(line) <= 15 && !NO_DASH.test(line) && !/ - /.test(line), `story ${i + 1}: line too long or dashed: ${line}`));
  });
  const sc = pack.selfCheck;
  assert.ok(words(sc.prompt) <= 8 && words(sc.bodyPrompt) <= 10 && words(sc.closing) <= 15);
  assert.equal(sc.options.map((o) => o.id).join(), 'yes,no,not-sure');
});

test('ENGINES: the audio engine speaks the story, the answers and every outcome, and Discover has its own words', () => {
  const src = read('engine-audio-choice.js');
  assert.match(src, /item\.choices\.map\(\(c\) => c\.say \|\| c\.caption \|\| c\.aria\)/, 'choices are read aloud');
  assert.match(src, /if \(item\.stimulusType === 'audio'\) \{[\s\S]*?V\.say\(pieces, \{ rate: speechRate/, 'feedback is always spoken for audio rounds (recorded clips first, the browser voice otherwise)');
  assert.match(src, /t\('audRight'\)/); assert.match(src, /t\('audMiss'\)/);
  assert.match(src, /hint_requested', \{ index, kind: 'show_words' \}/);
  assert.ok(!/Not quite —/.test(src), 'no hard-coded old outcome line left in the engine');
  const sdk = require(path.join(ROOT, 'engine-sdk.js'));
  assert.equal(sdk.t('audRight', 'discover'), 'You got it!');
  assert.equal(sdk.t('audMiss', 'discover'), 'Try another one.');
  assert.equal(sdk.t('audRight', undefined), 'Correct!', 'an unbanded page keeps the old wording');
  const sc = read('engine-scenario-choice.js');
  assert.match(sc, /const voiced = band === 'discover'/);
  assert.match(sc, /if \(voiced\) speak\(P\.afterCues\)/);
  assert.match(sc, /if \(voiced\) speak\(messageLines\)/);
  assert.match(sc, /kind: 'show_words'/);
  // emoji are stripped before the browser voice sees any text
  assert.match(sc, /Extended_Pictographic/); assert.match(src, /Extended_Pictographic/);
});

test('PRIVACY: the new Discover buttons log only that a hint was used, never what a child picked in the check-in', () => {
  const sc = read('engine-scenario-choice.js');
  const calls = sc.split('\n').filter((l) => /onEvidence\(/.test(l) && /self_check/.test(l));
  calls.forEach((l) => assert.match(l, /\{ scenarioIndex: index, stage: 'self_check(_body)?' \}/));
});

test('CSS: Discover has caption tiles, readable text rows and a words box; pages carry the new versions', () => {
  const css = read('brain-games.css');
  assert.match(css, /\.fn-choice-btn\.has-caption/);
  assert.match(css, /\.fn-words-box/);
  assert.match(css, /\.fn-stimulus-box \.fn-story-text\[hidden\] \{ display: none; \}/, 'the hidden story must stay hidden until the button is pressed');
  assert.match(css, /html\[data-band="discover"\] \.fn-choice-btn\.long-text \{[^}]*font-size: 22px/);
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const html = read(f);
    const tag = /<script[^>]+engine-audio-choice\.js[^>]*>/.exec(html);
    if (tag) assert.ok(tag[0].includes('engine-audio-choice.js?v=6'), `${f} loads an old audio engine`);
  }
});

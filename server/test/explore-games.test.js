// Release 88: the six Explore games (ages 7-10) are held to the limits in docs/tune-your-brain/R88_EXPLORE_TRIM_OUTLINE.md
// (answer options 12 words, feedback two sentences and 18 words, story setup 22, any sentence 12, no hard thinking words, no dashes),
// and the two small mechanisms from that release: amber for "right answer, weaker proof" and a visible step count in Explore.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const limits = require(path.join(__dirname, '..', 'scripts', 'explore-limits.js'));
const sdk = require(path.join(__dirname, '..', '..', 'engine-sdk.js'));
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

for (const slug of limits.ALL) {
  test(`EXPLORE ${slug}: every line is within the Explore limits`, () => {
    const bad = limits.check(slug);
    assert.deepEqual(bad.slice(0, 5), [], `${bad.length} lines over the limits, for example:\n${bad.slice(0, 5).join('\n')}`);
  });
}

test('EXPLORE: the limits are the ones in the approved outline', () => {
  assert.deepEqual(limits.LIMITS, { option: 12, feedbackWords: 18, feedbackSentences: 2, setup: 22, sentence: 12, explanation: 16, story: 25 });
});

test('EVIDENCE: a right answer with weaker proof is amber in the older bands and still red where no band is set', () => {
  for (const band of ['explore', 'challenge', 'advance']) assert.equal(sdk.t('evWeakKind', band), 'partial', band);
  assert.equal(sdk.t('evWeakKind', undefined), 'incorrect');
  assert.equal(sdk.t('evWeakKind', 'discover'), 'incorrect');
  const src = read('engine-evidence-hunt.js');
  assert.match(src, /resultKind = t\('evWeakKind'\)/);
  assert.match(read('brain-games.css'), /\.fn-shell-feedback\.partial/);
});

test('MILESTONES: Explore shows "Steps finished" and "Smart choices"; every other band keeps the old labels', () => {
  assert.equal(sdk.t('brLabelSteps', 'explore'), 'Steps finished');
  assert.equal(sdk.t('brLabelHelped', 'explore'), 'Smart choices');
  for (const band of ['discover', 'challenge', 'advance', undefined]) {
    assert.equal(sdk.t('brLabelSteps', band), 'Steps completed');
    assert.equal(sdk.t('brLabelHelped', band), 'Choices that helped');
  }
  const src = read('engine-branching-scenario.js');
  assert.match(src, /label: t\('brLabelSteps'\)/); assert.match(src, /label: t\('brLabelHelped'\)/);
});

test('STEP COUNT: the shell shows "Step 2 of 5" in Explore and Challenge, and every engine passes its word', () => {
  const shell = read('game-shell.js');
  assert.match(shell, /function renderProgress\(current, total, word\)/);
  assert.match(shell, /word && \['explore', 'challenge'\]\.includes\(getBand\(\)\)/);
  const words = { 'engine-evidence-hunt.js': 'Question', 'engine-branching-scenario.js': 'Step', 'engine-scenario-choice.js': 'Story', 'engine-audio-choice.js': 'Question', 'engine-simulation.js': 'Decision' };
  for (const [file, word] of Object.entries(words)) assert.match(read(file), new RegExp(`renderProgress\\([^)]*'${word}'\\)`), `${file} passes '${word}'`);
  assert.match(read('brain-games.css'), /\.fn-progress-count/);
});

test('PAGES: game pages load the new shell and engine versions', () => {
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const html = read(f);
    const tag = /<script[^>]+src="game-shell\.js[^"]*"[^>]*>/.exec(html);
    if (tag) assert.ok(tag[0].includes('game-shell.js?v=3'), `${f} loads an old game-shell`);
  }
});

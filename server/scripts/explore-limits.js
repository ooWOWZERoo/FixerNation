// Checks the six Explore games (ages 7-10) against the limits in docs/tune-your-brain/R88_EXPLORE_TRIM_OUTLINE.md.
// Run:  node server/scripts/explore-limits.js [slug ...]     (prints every line that breaks a limit; exit code 1 if any)
// Used by server/test/explore-games.test.js.
const fs = require('fs');
const path = require('path');
const { extractPack, ROOT } = require('./audit-brain-games.js');

const LIMITS = { option: 12, feedbackWords: 18, feedbackSentences: 2, setup: 22, sentence: 12, explanation: 16, story: 25 };
const SCENARIO = ['choice-quest', 'team-pick', 'peace-table', 'fix-it-workshop'];
const ALL = SCENARIO.concat(['reading-detective', 'strength-spotter']);
// Thinking words a child has to decode. Feeling words (frustrated, embarrassed, nervous, left out) are allowed: naming them is the lesson.
const HARD = /\b(constructive|overwhelmed|perspective|affects?|reactions?|assume[sd]?|appropriate|situation|consequences?)\b/i;
const DASH = /[—–]/;

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?]["\u201d\u2019]?)\s+/).filter(Boolean);

function check(slug) {
  const pack = extractPack(fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8'));
  const bad = [];
  const flag = (where, why, text) => bad.push(`${slug} ${where}: ${why}: ${text}`);
  const common = (where, text) => {
    if (DASH.test(text)) flag(where, 'dash', text);
    const h = String(text).match(HARD); if (h) flag(where, `hard word "${h[0]}"`, text);
    sentences(text).forEach((sn) => { if (words(sn) > LIMITS.sentence) flag(where, `sentence of ${words(sn)} words`, sn); });
  };
  if (SCENARIO.includes(slug)) {
    pack.variants.forEach((v, n) => v.steps.forEach((st) => {
      const at = `story ${n + 1} ${st.key}`;
      if (words(st.prompt) > LIMITS.setup) flag(at, `prompt of ${words(st.prompt)} words`, st.prompt);
      if (/\?/.test(st.prompt) && !/\?$/.test(st.prompt.trim())) flag(at, 'the question is not the last sentence', st.prompt);
      common(`${at} prompt`, st.prompt);
      (st.choices || []).forEach((c) => {
        const cat = `${at} ${c.type}`;
        if (words(c.text) > LIMITS.option) flag(cat, `option of ${words(c.text)} words`, c.text);
        common(`${cat} option`, c.text);
        if (words(c.feedback) > LIMITS.feedbackWords) flag(cat, `feedback of ${words(c.feedback)} words`, c.feedback);
        if (sentences(c.feedback).length > LIMITS.feedbackSentences) flag(cat, `feedback of ${sentences(c.feedback).length} sentences`, c.feedback);
        common(`${cat} feedback`, c.feedback);
      });
    }));
  } else if (slug === 'reading-detective') {
    pack.items.forEach((it, i) => {
      if (words(it.explanation) > LIMITS.explanation) flag(`item ${i + 1}`, `explanation of ${words(it.explanation)} words`, it.explanation);
      common(`item ${i + 1} explanation`, it.explanation);
      common(`item ${i + 1} question`, it.question);
      it.passage.forEach((p) => common(`item ${i + 1} passage`, p));
      it.choices.forEach((c) => common(`item ${i + 1} choice`, c.text));
    });
  } else if (slug === 'strength-spotter') {
    pack.scenarios.forEach((s, i) => {
      if (words(s.context) > LIMITS.story) flag(`story ${i + 1}`, `story of ${words(s.context)} words`, s.context);
      common(`story ${i + 1} context`, s.context);
      common(`story ${i + 1} reinforcement`, s.reinforcement);
      s.cues.forEach((c) => common(`story ${i + 1} clue`, c.text));
      s.feelings.forEach((f) => { common(`story ${i + 1} strength`, f.text); if (f.note) common(`story ${i + 1} note`, f.note); });
    });
  }
  return bad;
}

if (require.main === module) {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
  let total = 0;
  slugs.forEach((s) => { const bad = check(s); total += bad.length; console.log(`${s}: ${bad.length} over the limits`); bad.slice(0, 400).forEach((b) => console.log('  ' + b)); });
  process.exit(total ? 1 : 0);
}
module.exports = { check, LIMITS, ALL, SCENARIO, words, sentences };

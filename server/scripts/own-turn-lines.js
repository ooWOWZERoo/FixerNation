// Releases 138 and 139: the writing rules for the "Your turn" finale of Feelings Detective (Discover, K-2), Strength Spotter (Explore, grades 3-5) and Values Compass (Challenge, grades 6-8).
// No dashes, no praise openers, no soothing lines, short sentences, and (Explore) no hard thinking words. The growth steps for each strength are
// close in length, so the longest is not the "right" one. Also lists every string so the owner's review document can be checked against the page.
// Run:  node server/scripts/own-turn-lines.js [slug ...]     (prints each line that breaks a rule; exit code 1 if any)
// Used by server/test/own-turn.test.js.
const fs = require('fs');
const path = require('path');
const { extractPack, ROOT } = require('./audit-brain-games.js');

const SLUGS = ['feelings-detective', 'strength-spotter', 'values-compass', 'my-feelings-today', 'what-helps-me', 'know-your-triggers', 'know-yourself', 'stress-signals'];
// Sentence and option limits by band: Discover 9 and 4, Explore 12 and 12, Challenge and Advance 20 and 14.
const BAND_OF = { 'feelings-detective': 'discover', 'my-feelings-today': 'discover', 'strength-spotter': 'explore', 'what-helps-me': 'explore', 'values-compass': 'challenge', 'know-your-triggers': 'challenge', 'know-yourself': 'advance', 'stress-signals': 'advance' };
const LIMITS = { discover: [9, 4], explore: [12, 12], challenge: [20, 14], advance: [20, 14] };
const SENTENCE_LIMIT = new Proxy({}, { get: (_, slug) => LIMITS[BAND_OF[slug]][0] });
const OPTION_LIMIT = new Proxy({}, { get: (_, slug) => LIMITS[BAND_OF[slug]][1] });
const HARD = /\b(constructive|overwhelmed|perspective|affects?|reactions?|assume[sd]?|appropriate|situation|consequences?)\b/i;
const SOOTHING = /\b(completely normal|that is normal|that's normal|totally normal|perfectly normal)\b/i;
const PRAISE = /^(good (catch|noticing|thinking|job)|great|nice (work|job|read)|well done|exactly|right[.,!])/i;
const DASH = /[—–]| - /;
const words = (s) => String(s).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?]["”’]?)\s+/).filter(Boolean);

// Every visible string in the finale and the one-tap check, with where it is.
function strings(pack) {
  const out = [];
  const add = (where, text, kind) => { if (typeof text === 'string' && text) out.push({ where, text, kind: kind || 'line' }); };
  const finales = [pack.ownTurn].concat((pack.variants || []).map((v) => v.ownTurn)).filter(Boolean);
  if (pack.selfCheck) { add('check prompt', pack.selfCheck.prompt); pack.selfCheck.options.forEach((o) => add('check option', o.text, 'option')); }
  finales.forEach((ot) => {
  add('intro', ot.intro); add('privateNote', ot.privateNote, 'note'); add('summaryLabel', ot.summaryLabel, 'note');
  ot.steps.forEach((st) => {
    add(`${st.id} prompt`, st.prompt); add(`${st.id} promptIfNone`, st.promptIfNone); add(`${st.id} confirm`, st.confirm, 'option');
    (st.options || []).forEach((o) => { add(`${st.id} option`, o.text, 'option'); add(`${st.id} card`, o.card, 'card'); });
    if (st.notSure) add(`${st.id} not sure`, st.notSure.text, 'option');
    add(`${st.id} depends`, st.dependsText, 'option');
    if (st.optionsBy) {
      Object.entries(st.optionsBy.map).forEach(([k, list]) => list.forEach((o) => add(`${st.id} ${k}`, o.text, 'option')));
      st.optionsBy.fallback.forEach((o) => add(`${st.id} fallback`, o.text, 'option'));
    }
    (st.pairs || []).forEach((p) => {
      add(`${p.a}/${p.b} setup`, p.context, 'setup'); add(`${p.a}/${p.b} A`, p.optionA.text, 'option'); add(`${p.a}/${p.b} B`, p.optionB.text, 'option');
      add(`${p.a}/${p.b} cardA`, p.optionA.card, 'card'); add(`${p.a}/${p.b} cardB`, p.optionB.card, 'card'); add(`${p.a}/${p.b} depends`, p.depends, 'card');
    });
  });
  const res = ot.result;
  add('heading', res.heading, 'note'); res.lines.forEach((l, i) => add(`card line ${i + 1}`, l.text, 'card')); add('emptyLine', res.emptyLine); add('closing', res.closing); add('finish', res.finish, 'option');
  });
  return out;
}

function check(slug) {
  const pack = extractPack(fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8'));
  const bad = [];
  const flag = (where, why, text) => bad.push(`${slug} ${where}: ${why}: ${String(text).slice(0, 140)}`);
  for (const s of strings(pack)) {
    if (DASH.test(s.text)) flag(s.where, 'dash', s.text);
    if (SOOTHING.test(s.text)) flag(s.where, 'soothing line', s.text);
    if (PRAISE.test(s.text.trim())) flag(s.where, 'praise opener', s.text);
    if (slug !== 'values-compass' && HARD.test(s.text)) flag(s.where, `hard word "${s.text.match(HARD)[0]}"`, s.text);
    if (s.kind !== 'note') sentences(s.text.replace(/\{[^}]*\}/g, 'word')).forEach((sn) => { if (words(sn) > SENTENCE_LIMIT[slug]) flag(s.where, `sentence of ${words(sn)} words`, sn); });
    if (s.kind === 'option' && words(s.text) > OPTION_LIMIT[slug]) flag(s.where, `option of ${words(s.text)} words`, s.text);
    if (/\{[^}]*\}/.test(s.text)) {
      // Tokens must name a step in this pack.
      const ids = new Set([pack.ownTurn].concat((pack.variants || []).map((v) => v.ownTurn)).filter(Boolean)[0].steps.map((st) => st.id).concat(['item'])); // {item} is each pick of a line marked each
      (s.text.match(/\{([a-zA-Z0-9_]+)/g) || []).forEach((t) => { if (!ids.has(t.slice(1))) flag(s.where, `unknown token ${t}`, s.text); });
    }
  }
  // The growth steps for one strength are close in length, so length gives nothing away.
  const by = (pack.ownTurn || { steps: [] }).steps.find((st) => st.optionsBy);
  if (by) Object.entries(by.optionsBy.map).concat([['fallback', by.optionsBy.fallback]]).forEach(([k, list]) => {
    const w = list.map((o) => words(o.text));
    if (Math.max(...w) > 1.6 * Math.min(...w)) flag(`${k} steps`, `lengths ${w.join('/')} are not balanced`, list.map((o) => o.text).join(' | '));
  });
  return bad;
}

module.exports = { check, strings, SLUGS };

if (require.main === module) {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : SLUGS;
  const bad = slugs.flatMap(check);
  console.log(bad.length ? bad.join('\n') : `OK: ${slugs.join(', ')} follow the rules`);
  process.exit(bad.length ? 1 : 0);
}

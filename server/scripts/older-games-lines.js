// Checks the visible text of the 13 Challenge and Advance games for the Release 89 rules (docs/tune-your-brain/R89_CHALLENGE_ADVANCE_LEGACY_CATALOG_OUTLINE.md):
// no dashes or spaced hyphens used as dashes, no soothing "that is normal" lines, no praise openers ("Good catch.", "Right."),
// and every game has its own header line. Also reports the Decision Point length rule (feedback 30 words and 3 sentences or fewer).
// Run:  node server/scripts/older-games-lines.js [slug ...]   (prints each line that breaks a rule; exit code 1 if any)
const fs = require('fs');
const path = require('path');
const { extractPack, ROOT } = require('./audit-brain-games.js');

const GAMES = ['decision-point', 'group-chat-meltdown', 'headline', 'money-moves', 'say-it-another-way', 'values-compass', 'critical-read',
  'first-shift', 'the-post', 'money-matters', 'perspective-swap', 'community-voice', 'idea-lab'];
const SOOTHING = /\b(completely normal|that is normal|that's normal|totally normal|perfectly normal)\b/i;
const PRAISE = /^(good (catch|noticing|thinking|job)|great|nice (work|job|read)|well done|exactly|right[.,!])/i;
const DASH = /[—–]| - /;
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const sentences = (s) => String(s).split(/(?<=[.!?]["”’]?)\s+/).filter(Boolean);

// Every quoted string in the page's script that reads like text (has letters and a space), skipping comment lines.
function visibleStrings(src) {
  const script = src.split('\n').filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n');
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  let m;
  while ((m = re.exec(script))) {
    const t = m[2].replace(/\\(['"`])/g, '$1');
    if (/[A-Za-z]{3}/.test(t) && /\s/.test(t) && !/^[\w\-./:?=#&%]+$/.test(t) && !/^(https?:|\.\/|<)/.test(t) && !/\$\{/.test(t)) out.push(t);
  }
  return out;
}

function check(slug) {
  const src = fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8');
  const bad = [];
  const flag = (why, text) => bad.push(`${slug}: ${why}: ${String(text).slice(0, 150)}`);
  visibleStrings(src).forEach((t) => {
    if (/[—–]/.test(t)) flag('dash', t);
    else if (/ - /.test(t)) flag('spaced hyphen used as a dash', t);
    if (SOOTHING.test(t)) flag('soothing line', t);
    if (PRAISE.test(t.trim())) flag('praise opener', t);
  });
  const pack = extractPack(src);
  if (slug === 'decision-point' && pack) {
    [].concat(pack.steps || []).forEach((st) => (st.choices || []).forEach((c) => {
      if (words(c.feedback) > 30) flag(`feedback of ${words(c.feedback)} words`, c.feedback);
      if (sentences(c.feedback).length > 3) flag(`feedback of ${sentences(c.feedback).length} sentences`, c.feedback);
    }));
  }
  return bad;
}

function header(slug) {
  const src = fs.readFileSync(path.join(ROOT, `brain-${slug}.html`), 'utf8');
  const m = src.match(/description:\s*(['"])((?:(?!\1).)*)\1/);
  return m ? m[2] : null;
}

if (require.main === module) {
  const slugs = process.argv.slice(2).length ? process.argv.slice(2) : GAMES;
  let total = 0;
  slugs.forEach((s) => { const bad = check(s); total += bad.length; console.log(`${s}: ${bad.length} lines break a rule`); bad.forEach((b) => console.log('  ' + b)); });
  process.exit(total ? 1 : 0);
}
module.exports = { GAMES, check, header, visibleStrings, words, sentences };

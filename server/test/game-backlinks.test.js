// Every Brain Games page must have a way back to the games page (game-backlink.js adds the link). Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
// The hub, the badge page and the stats page link to the games page themselves.
const OWN_LINK = new Set(['brain-games.html', 'brain-badges.html', 'brain-games-progress.html']);

test('every game page loads game-backlink.js, and the script links to brain-games.html', () => {
  const pages = fs.readdirSync(ROOT).filter((f) => /^brain-.*\.html$/.test(f) && !OWN_LINK.has(f)).concat(['tune-your-brain-engine-activity.html']);
  assert.ok(pages.length >= 30, `${pages.length} game pages found`);
  pages.forEach((f) => assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /<script src="game-backlink\.js\?v=1" defer><\/script>/, `${f} has no way back to the games page`));
  const js = fs.readFileSync(path.join(ROOT, 'game-backlink.js'), 'utf8');
  assert.match(js, /href="brain-games\.html"/);
  assert.match(js, /window\.self !== window\.top/, 'skips the student classroom frame, which has its own My Classroom link');
  OWN_LINK.forEach((f) => { if (f !== 'brain-games.html') assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /brain-games\.html/, `${f} links to the games page`); });
});

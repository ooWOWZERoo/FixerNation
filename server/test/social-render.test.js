// social.html renderContent(): how a post's text is shown. Regression: an apostrophe in a post ("Today's lesson") is escaped to
// &#39;, and the hashtag step then treated "#39" as a hashtag, so the post showed "Today&", a highlighted "#39", and ";s".
// The page's own functions are read out of social.html and run here, so this tests the real code.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'social.html'), 'utf8');
function grab(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} is in social.html`);
  let depth = 0, i = html.indexOf('{', start);
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(start, j + 1); }
  }
  throw new Error(`could not read ${name}`);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${grab('esc')}\n${grab('renderContent')}`, ctx);
const render = (t) => ctx.renderContent(t);

test('an apostrophe is shown as an apostrophe, never as a hashtag', () => {
  const out = render("Today's Morning Boost lesson sparked a great talk. Here's why.");
  assert.doesNotMatch(out, /post-hashtag/);
  assert.match(out, /Today&#39;s Morning Boost/);
  assert.match(out, /Here&#39;s why/);
});

test('real hashtags still highlight, at the start, after a space and after a newline', () => {
  assert.match(render('#sel is great'), /<span class="post-hashtag"[^>]*>#sel<\/span> is great/);
  assert.match(render('Try this #classroommanagement today'), /<span class="post-hashtag"[^>]*>#classroommanagement<\/span> today/);
  assert.match(render('line one\n#routines'), /<br><span class="post-hashtag"[^>]*>#routines<\/span>/);
});

test('an apostrophe next to a hashtag keeps both right', () => {
  const out = render("Today's tip #morningboost");
  assert.equal((out.match(/class="post-hashtag"/g) || []).length, 1, 'only the real hashtag is highlighted');
  assert.match(out, /<span class="post-hashtag"[^>]*>#morningboost<\/span>/);
  assert.doesNotMatch(out, />#39</);
});

test('other special characters and links are escaped and linked as before', () => {
  assert.match(render('5 < 6 & "quotes"'), /5 &lt; 6 &amp; &quot;quotes&quot;/);
  assert.match(render('<script>alert(1)</script>'), /&lt;script&gt;/);
  assert.match(render('see https://example.com/routine-chart now'), /<a class="post-link" href="https:\/\/example.com\/routine-chart"/);
  assert.doesNotMatch(render('see https://example.com/page#section now'), /post-hashtag/, 'a # inside a web address is not a hashtag');
});

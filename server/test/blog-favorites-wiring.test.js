// Release 91: the pieces of favorites are connected: the table exists in schema.sql and the alter script, the route is mounted,
// the Morning Boost page loads the script and uses it for stars, chips, the email link and sign-in, and the menu link is on every page.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('TABLE: the same table in fresh installs and in the alter script, with cascading keys', () => {
  for (const f of ['server/db/schema.sql', 'server/scripts/alter-add-blog-post-favorites.js']) {
    const src = read(f);
    assert.match(src, /blog_post_favorites/);
    assert.match(src, /PRIMARY KEY \(site_user_id, post_id\)/);
    assert.match(src, /FOREIGN KEY \(site_user_id\) REFERENCES site_users\(id\) ON DELETE CASCADE/);
    assert.match(src, /FOREIGN KEY \(post_id\) REFERENCES blog_posts\(id\) ON DELETE CASCADE/);
  }
  assert.match(read('server/scripts/alter-add-blog-post-favorites.js'), /already exists/, 'safe to run twice');
  assert.match(read('SCHEMA.md'), /blog_post_favorites/);
});

test('ROUTE: mounted once, every handler behind sign-in', () => {
  const app = read('server/app.js');
  assert.match(app, /require\('\.\/routes\/blog-favorites'\)/);
  assert.equal((app.match(/app\.use\('\/api\/blog-favorites'/g) || []).length, 1);
  const route = read('server/routes/blog-favorites.js');
  const handlers = route.match(/router\.(get|put|post|delete)\(/g) || [];
  assert.equal(handlers.length, 2);
  assert.equal((route.match(/router\.(get|put)\([^\n]*requireSiteAuth/g) || []).length, 2, 'both routes use requireSiteAuth');
  assert.ok(!/req\.(body|query|params)\.(siteUserId|userId|site_user_id)/.test(route), 'the user id never comes from the request');
});

test('PAGE: Morning Boost loads the favorites script and wires stars, chips, sign-in, the email link and the auth event', () => {
  const html = read('morning-boost-blog.html');
  assert.match(html, /<script src="blog-favorites\.js\?v=1"><\/script>/);
  assert.ok(html.indexOf('blog-favorites.js') < html.indexOf('const MB_CATEGORY'), 'script loads before the page script');
  assert.match(html, /FnFavorites\.starHtml\(featured, favStore && favStore\.isFav\(featured\.id\), 'text'\)/);
  assert.match(html, /FnFavorites\.starHtml\(p, favStore && favStore\.isFav\(p\.id\), 'icon'\)/);
  assert.match(html, /id="favChips"/);
  assert.match(html, /FnFavorites\.chipsHtml\(favStore\.view, favStore\.count\(postsCache\)\)/);
  assert.match(html, /new URLSearchParams\(location\.search\)\.get\('post'\)/);
  assert.match(html, /document\.addEventListener\('fn-auth-changed'/);
  assert.match(html, /favStore\.applyPending\(postsCache\)/);
  assert.match(html, /closePostRead\(\);\s*\n\s*fnAuthOpenModal\('login'\)/, 'the post modal closes before the sign-in box opens (it sits above it)');
  assert.match(html, /Nothing saved yet/); assert.match(html, /Sign in to see your favorites/);
  assert.match(html, /renderGrid\(mine, true\)/, 'in Favorites view the featured post is not hidden');
});

test('MENU: "My Favorites" is in the signed-in menu, and every public page loads the new site-auth', () => {
  assert.match(read('site-auth.js'), /li\('morning-boost-blog\.html\?view=favorites', 'My Favorites'\)/);
  const stale = [];
  let withScript = 0;
  for (const f of fs.readdirSync(ROOT).filter((n) => n.endsWith('.html'))) {
    const m = /<script src="site-auth\.js\?v=(\d+)"/.exec(read(f));
    if (m) { withScript++; if (m[1] !== '11') stale.push(f); }
  }
  assert.deepEqual(stale, []); assert.ok(withScript >= 70, `${withScript} pages`);
});

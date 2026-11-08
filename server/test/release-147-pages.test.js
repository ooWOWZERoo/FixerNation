// Release 147: three public pages that disagreed with what the system does now say the same thing as the rest.
// Parents see lesson completion only; reflections are for the assigning teacher only; parents join by a teacher's invitation.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('for-parents.html does not promise quiz scores or skill growth', () => {
  const s = read('for-parents.html');
  assert.ok(!/quiz scores/i.test(s));
  assert.ok(!/skill growth/i.test(s));
  assert.match(s, /started and finished/);
});

test('for-students.html says reflections are for the assigning teacher only', () => {
  const s = read('for-students.html');
  assert.ok(!/teacher and school administrator/i.test(s));
  assert.match(s, /Reflections are visible only to the assigning teacher\./);
});

test('education-portal.html tells parents to wait for an invitation, not ask for a code', () => {
  const s = read('education-portal.html');
  assert.ok(!/parent code/i.test(s));
  assert.match(s, /sends an invitation/);
});

test('for-schools.html takes its prices from the admin price list, not from its own text', () => {
  const s = read('for-schools.html');
  assert.ok(!/Contact us for pricing/i.test(s));
  assert.match(s, /\/api\/license-products/);
  for (const tier of ['individual', 'school', 'district']) assert.match(s, new RegExp(`data-tier="${tier}"`));
});

test('education-schools.html no longer carries a hard-coded $149 or $0', () => {
  const s = read('education-schools.html');
  assert.ok(!/\$<span id="regSoloPrice">149/.test(s));
  assert.ok(!/id="regPrice">\$0</.test(s));
});

test('education-schools.html: the solo button buys the admin per-seat product through the same checkout as licenses.html', () => {
  const s = read('education-schools.html');
  assert.match(s, /\/api\/checkout\/create-session/);
  assert.match(s, /productId: _soloProduct\.id/);
  assert.ok(!/cartAdd\(/.test(s), 'the cart path needs a school domain and cannot sell a solo license');
  // products are found by their settings, never by position or id
  assert.match(s, /p\.seatCount === 1 && !p\.variableSeats && !p\.isTrial/);
  assert.match(s, /p\.seatCount === 1 && p\.variableSeats && !p\.isTrial && !p\.callForQuote && p\.price > 0/);
  assert.ok(!/p\.id === 1[34]/.test(s) && !/\$249/.test(s), 'no hard-coded id or price');
  // the same terms and refund line licenses.html shows next to Buy Now
  assert.match(s, /terms\.html[^]*refund-policy\.html/);
  assert.ok(!/Contact Us'/.test(s.replace(/'Ask About a Solo License'/g, '')), 'no quote-only "Contact Us" price on the registration card');
});

test('education-schools.html: a school with no license on file can still buy a solo license', () => {
  const s = read('education-schools.html');
  const branch = s.slice(s.indexOf("data.reason === 'no_school'"), s.indexOf("data.reason === 'license_pending'"));
  assert.ok(!/soloBtn\.textContent|soloBtn\.onclick/.test(branch), 'the solo button is no longer turned into Contact Us');
  assert.match(branch, /buy a license for yourself/);
});

test('checkout: the old hard-coded $49 and $39 license prices are gone; only the admin price list sells licenses', () => {
  const s = read('server/routes/checkout.js');
  assert.ok(!/4900|3900|const PRICING/.test(s));
  assert.match(s, /Send a productId from the license price list/);
});

test('the one-off price script is marked historic', () => {
  assert.match(read('server/scripts/update-license-product-pricing.js'), /HISTORIC, DO NOT RE-RUN/);
});

test('no page promises an individual license only one classroom (nothing enforces it)', () => {
  const schools = read('for-schools.html');
  assert.ok(!/one classroom/i.test(schools) && !/One Digital Classroom/.test(schools) && !/Multiple Digital Classrooms/.test(schools));
  assert.ok(!/one teacher with one classroom/i.test(read('help-center.js')));
});

test('Help center: parents are told there is no code, the writing-visibility answer waits for the owner, and for-parents names the teacher', () => {
  const vm = require('node:vm');
  const ctx = { window: {}, document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], head: { appendChild() {} }, body: { appendChild() {} }, createElement: () => ({ style: {}, setAttribute() {} }) }, location: { search: '' }, console, setTimeout, fetch: () => Promise.resolve({ ok: false }) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('help-center.js'), ctx);
  const HC = ctx.FNHelpCenter;
  const byId = (id) => HC.entries.find((e) => e.id === id);
  assert.equal(byId('parent-need-code').reviewed, true);
  assert.match(byId('parent-need-code').a, /no parent code/);
  assert.equal(byId('who-reads-student-writing').reviewed, false, 'privacy wording stays a draft until the owner reads it');
  assert.match(byId('license-price').a, /single teacher can buy online/);
  const parents = read('for-parents.html');
  assert.ok(!/FNE administrator sends a parent invite/.test(parents));
  assert.match(parents, /Your child's teacher sends a parent invitation/);
});

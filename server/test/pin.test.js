// A student PIN is 4 to 6 digits, checked on the server as well as in the page (lib/pin.js).
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidPin, PIN_ERROR } = require('../lib/pin');

test('4 to 6 digits pass, as a string or a number', () => {
  for (const ok of ['1234', '48201', '482019', 4821, 482019]) assert.equal(isValidPin(ok), true, String(ok));
});

test('too short, too long, or not digits all fail', () => {
  for (const bad of ['', '123', '1234567', '12 34', '12a4', '1e3', '-1234', '12.34', ' 1234']) assert.equal(isValidPin(bad), false, JSON.stringify(bad));
});

test('anything that is not a string or number fails, even if it would turn into digits', () => {
  for (const bad of [undefined, null, ['1234'], { toString: () => '1234' }, true, 123, 1234567]) assert.equal(isValidPin(bad), false, String(bad));
});

test('the message says what is wanted', () => {
  assert.match(PIN_ERROR, /4 to 6 digits/);
});

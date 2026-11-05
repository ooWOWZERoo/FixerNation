// Release 121: the idle lock on admin pages that show student names (admin-privacy-lock.js). Runs the real script against a tiny
// fake browser with a hand-driven clock: nothing is hidden before the idle time, any mouse move/click/key press restarts the count,
// and at the idle time the names are wiped (the page's clear() runs) and a "show them again" button reloads them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'admin-privacy-lock.js'), 'utf8');

function browser({ minutes = 5, settingFails = false } = {}) {
  let now = 1_000_000;
  const listeners = {};
  const intervals = [];
  const makeEl = () => {
    const el = { children: [], style: {}, textContent: '', listeners: {}, className: '', type: '' };
    el.appendChild = (c) => { el.children.push(c); return c; };
    el.addEventListener = (name, fn) => { el.listeners[name] = fn; };
    return el;
  };
  const ctx = {
    window: { addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); } },
    document: { createElement: makeEl },
    fetch: async () => (settingFails ? { ok: false } : { ok: true, json: async () => ({ minutes }) }),
    setInterval: (fn) => { intervals.push(fn); return intervals.length; },
    clearInterval: (id) => { intervals[id - 1] = null; },
    Date: { now: () => now },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return {
    ctx,
    listeners,
    advance: (ms) => { now += ms; intervals.forEach(fn => fn && fn()); },
    fire: (name) => (listeners[name] || []).forEach(fn => fn({})),
  };
}

function setup(opts) {
  const b = browser(opts);
  const notice = { children: [], style: { display: 'none' }, textContent: '', appendChild(c) { this.children.push(c); } };
  notice.appendChild = (c) => { notice.children.push(c); };
  let cleared = 0, reloaded = 0;
  const lock = b.ctx.window.fnPrivacyLock({ notice, clear: () => { cleared++; }, reload: () => { reloaded++; } });
  return { b, lock, notice, counts: () => ({ cleared, reloaded }) };
}
const MIN = 60 * 1000;

test('the default is 5 minutes when the setting cannot be read', async () => {
  const { lock } = setup({ settingFails: true });
  await lock.ready;
  assert.equal(lock.minutes(), 5);
});

test('the minutes come from the setting', async () => {
  const { lock } = setup({ minutes: 12 });
  await lock.ready;
  assert.equal(lock.minutes(), 12);
});

test('nothing is hidden before the idle time; at the idle time the names are wiped and a notice appears', async () => {
  const { b, lock, notice, counts } = setup({ minutes: 5 });
  await lock.ready;
  lock.arm();
  b.advance(4 * MIN + 55000);
  assert.deepEqual(counts(), { cleared: 0, reloaded: 0 });
  b.advance(10000);
  assert.equal(counts().cleared, 1);
  assert.equal(notice.style.display, 'block');
  assert.match(notice.children[0].textContent, /Student names are hidden after 5 minutes without activity/);
  assert.equal(notice.children[1].textContent, 'Show them again');
});

test('a mouse move, click or key press restarts the count', async () => {
  for (const ev of ['mousemove', 'click', 'keydown']) {
    const { b, lock, counts } = setup({ minutes: 5 });
    await lock.ready;
    lock.arm();
    b.advance(4 * MIN);
    b.fire(ev);
    b.advance(4 * MIN);
    assert.equal(counts().cleared, 0, `${ev}: 8 minutes passed but only 4 since the last activity`);
    b.advance(1 * MIN + 5000);
    assert.equal(counts().cleared, 1, `${ev}: locks 5 minutes after the last activity`);
  }
});

test('"Show them again" runs the reload and clears the notice; the lock re-arms when the names are back', async () => {
  const { b, lock, notice, counts } = setup({ minutes: 1 });
  await lock.ready;
  lock.arm();
  b.advance(MIN + 6000);
  assert.equal(counts().cleared, 1);
  notice.children[1].listeners.click();
  assert.equal(counts().reloaded, 1);
  assert.equal(notice.style.display, 'none');
  lock.arm(); // the page calls arm() once the lookup has put names back
  b.advance(MIN + 6000);
  assert.equal(counts().cleared, 2, 'it locks again after another idle period');
});

test('a page with no names on it (never armed, or disarmed) never locks', async () => {
  const { b, lock, counts } = setup({ minutes: 1 });
  await lock.ready;
  b.advance(10 * MIN);
  assert.equal(counts().cleared, 0, 'not armed');
  lock.arm(); lock.disarm();
  b.advance(10 * MIN);
  assert.equal(counts().cleared, 0, 'disarmed');
});

test('it listens for the mouse, the keyboard and touch', () => {
  const { b } = setup();
  for (const ev of ['mousemove', 'mousedown', 'click', 'keydown', 'touchstart']) assert.ok((b.listeners[ev] || []).length >= 1, ev);
});

// Customer Hub Overview status outlines (red, yellow, green): crm-status.js. The rules are pure, so they run here without a browser.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../../crm-status.js');
const { RULES } = require('../lib/crm-attention');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('MY TASKS: red if anything is overdue, yellow if something is due today, green if on time, grey if there are no tasks at all', () => {
  assert.deepEqual(S.tasks({ open: 5, overdue: 2, dueToday: 1 }), { level: 'red', word: '2 overdue' });
  assert.deepEqual(S.tasks({ open: 3, overdue: 0, dueToday: 1 }), { level: 'amber', word: '1 due today' });
  assert.deepEqual(S.tasks({ open: 3, overdue: 0, dueToday: 4 }), { level: 'amber', word: '4 due today' });
  assert.deepEqual(S.tasks({ open: 3, overdue: 0, dueToday: 0 }), { level: 'green', word: 'On time' });
  assert.deepEqual(S.tasks({ open: 0, overdue: 0, dueToday: 0 }), { level: 'neutral', word: 'No open tasks' }, 'nothing to be on time about is not green');
  assert.equal(S.tasks(undefined).level, 'neutral');
  assert.equal(S.tasks({ open: 'x', overdue: -4, dueToday: null }).level, 'neutral', 'junk numbers never make a box red');
});

test('NEEDS ATTENTION: red only for a rule about something late or stuck; any other item is yellow; empty is green', () => {
  assert.deepEqual(S.attention({ task_overdue: 1, stale_deal: 4 }), { level: 'red', word: '1 late' });
  assert.deepEqual(S.attention({ quote_expiring: 2, no_owner: 1 }), { level: 'amber', word: '3 to look at' });
  assert.deepEqual(S.attention({ quote_expiring: 0, task_overdue: 0 }), { level: 'green', word: 'All clear' });
  assert.deepEqual(S.attention({}), { level: 'green', word: 'All clear' });
  assert.equal(S.attention(undefined).level, 'green');
  assert.equal(S.attention({ next_step_overdue: 1, checklist_overdue: 1, won_no_purchase: 1 }).word, '3 late');
});

test('NEEDS ATTENTION: every rule the server has is classed, and every red rule really exists (the two lists cannot drift apart)', () => {
  const server = Object.keys(RULES);
  for (const k of S.RED_RULES) assert.ok(server.includes(k), `${k} is a red rule on the page but not a rule on the server`);
  for (const k of server) {
    const level = S.attention({ [k]: 1 }).level;
    assert.ok(level === 'red' || level === 'amber', `${k} must be red or yellow`);
    assert.equal(level, S.RED_RULES.includes(k) ? 'red' : 'amber');
  }
  // The rules the owner sees as "late": a date has passed, or a deal is Won with no purchase.
  assert.deepEqual([...S.RED_RULES].sort(), ['checklist_overdue', 'next_step_overdue', 'task_overdue', 'won_no_purchase']);
});

test('DEALS AND DECISIONS: overdue next steps are red or green; things waiting for a decision are yellow or green, never red', () => {
  assert.deepEqual(S.overdueDeals(3), { level: 'red', word: '3 overdue' });
  assert.deepEqual(S.overdueDeals(0), { level: 'green', word: 'None late' });
  assert.deepEqual(S.waiting(2), { level: 'amber', word: '2 waiting' });
  assert.deepEqual(S.waiting(0), { level: 'green', word: 'Nothing waiting' });
  for (const n of [0, 1, 50, '7', undefined, null, NaN]) assert.notEqual(S.waiting(n).level, 'red');
});

test('NOT COLOUR ALONE: each level has its own shape and its own word, the chip escapes its text, and the box class names the level', () => {
  const chips = ['red', 'amber', 'green', 'neutral'].map(level => S.chip({ level, word: 'x' }));
  const shapes = chips.map(c => c.match(/aria-hidden="true">(.)</)[1]);
  assert.equal(new Set(shapes).size, 4, 'four different shapes');
  assert.match(S.chip({ level: 'red', word: '<img src=x onerror=1>' }), /&lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(S.chip({ level: 'red', word: '<img src=x>' }), /<img/);
  assert.equal(S.boxClass({ level: 'amber' }), 'crm-status-box crm-status-amber');
  assert.match(S.LEGEND, /red means something is late/i);
  assert.match(S.LEGEND, /yellow/i); assert.match(S.LEGEND, /green/i);
});

test('WHERE IT IS USED: the four work-status boxes on the Overview, and never on a contact, a label or a pipeline total', () => {
  const html = read('admin-crm-overview.html');
  assert.match(html, /<script src="crm-status\.js\?v=1"><\/script>/);
  for (const [what, re] of [['My tasks', /FnCrmStatus\.tasks\(s\)/], ['Needs attention', /FnCrmStatus\.attention\(r\.data\.counts\)/], ['Overdue next steps', /FnCrmStatus\.overdueDeals\(/],
    ['Needs a decision', /FnCrmStatus\.waiting\(Number\(dec\.quotesWithoutDeal/], ['No next step', /FnCrmStatus\.waiting\(d\.nextSteps\.missing\.total\)/]]) assert.match(html, re, what);
  assert.match(html, /FnCrmStatus\.LEGEND/);
  // The label tiles and the pipeline tiles are drawn by tile(); the status helpers must not appear in it or beside the three labels.
  const tileFn = html.match(/function tile\([\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(tileFn, /FnCrmStatus/);
  const labelBlock = html.slice(html.indexOf('Contacts by label'), html.indexOf('aria-label="Pipeline"'));
  assert.doesNotMatch(labelBlock, /FnCrmStatus|crm-status/);
  for (const f of ['admin-crm-contacts.html', 'admin-crm-contact.html', 'admin-crm-accounts.html', 'admin-crm-account.html']) assert.doesNotMatch(read(f), /crm-status/, `${f} must not use status outlines`);
  assert.doesNotMatch(read('crm-status.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s\/\/ .*$/gm, ''), /\b(hot|warm|cold)\b/i, 'code only; comments may name the rule');
});

test('STYLES: one outline style per level from the existing admin colours, with a dark-mode-safe chip, and the CSS version is the same on every Hub page', () => {
  const css = read('crm-common.css');
  for (const level of ['red', 'amber', 'green', 'neutral']) {
    assert.match(css, new RegExp(`\\.crm-status-box\\.crm-status-${level}\\{border-color:`), level);
    assert.match(css, new RegExp(`\\.crm-status-chip\\.crm-status-${level}\\{background:`), level);
  }
  assert.match(css, /--a-danger\)/); assert.match(css, /crm-status-amber\{border-color:var\(--a-gold\)/); assert.match(css, /--a-success\)/);
  assert.doesNotMatch(css.slice(css.indexOf('Status outlines')), /--a-warning/, 'the orange-brown warning colour is too close to the red to tell apart');
  assert.doesNotMatch(css.slice(css.indexOf('Status outlines')), /#[0-9a-f]{3,6}\b/i, 'no new hard-coded colour');
  const pages = fs.readdirSync(ROOT).filter(f => /^admin-crm-.*\.html$/.test(f));
  const versions = new Set(pages.map(f => (read(f).match(/crm-common\.css\?v=(\d+)/) || [])[1]));
  assert.equal(versions.size, 1, `every Hub page loads the same crm-common.css version: ${[...versions]}`);
  assert.ok(!versions.has(undefined));
});

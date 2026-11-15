// Sales CRM phase 5a: the mailbox sync decision (lib/crm-mail-sync-state.js). Pure, so it runs with no mail server.
// The same logic was also proven against a real IMAP server (GreenMail) whose folder was rebuilt: see docs/reference/crm-email-sync-spike.md.
// Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideSync, nextPosition, messageKey } = require('../lib/crm-mail-sync-state');

const server = (o = {}) => ({ uidValidity: 1000n, uidNext: 11, exists: 10, ...o });

test('FIRST RUN: a folder never synced starts from UID 1', () => {
  assert.deepEqual(decideSync(null, server()), { action: 'initial', fromUid: 1, reason: 'never_synced' });
  assert.equal(decideSync({ uidValidity: 1000, lastUid: null }, server()).action, 'initial');
});

test('NORMAL RUNS: only UIDs after the saved one are fetched, and an unchanged folder fetches nothing', () => {
  assert.deepEqual(decideSync({ uidValidity: 1000, lastUid: 4 }, server()), { action: 'incremental', fromUid: 5, reason: 'new_messages' });
  assert.deepEqual(decideSync({ uidValidity: '1000', lastUid: 10 }, server()), { action: 'nothing_new', fromUid: 11, reason: 'up_to_date' });
});

test('UIDVALIDITY: a BigInt from the server matches the number or string the database returns, and a different one forces a full resync', () => {
  assert.equal(decideSync({ uidValidity: '1000', lastUid: 10 }, server({ uidValidity: 1000n })).action, 'nothing_new');
  assert.equal(decideSync({ uidValidity: 1000, lastUid: 10 }, server({ uidValidity: 1001n })).reason, 'uidvalidity_changed');
  assert.equal(decideSync({ uidValidity: 1000, lastUid: 10 }, server({ uidValidity: 1001n })).fromUid, 1, 'every saved UID is meaningless now');
});

test('IMPOSSIBLE STATES: anything that does not add up is a resync, never a guess', () => {
  assert.equal(decideSync({ uidValidity: 1000, lastUid: 50 }, server()).reason, 'uidnext_went_backwards');
  assert.equal(decideSync({ uidValidity: 1000, lastUid: -3 }, server()).reason, 'stored_uid_invalid');
  assert.equal(decideSync({ uidValidity: 1000, lastUid: 'abc' }, server()).reason, 'stored_uid_invalid');
  for (const bad of [null, {}, { uidValidity: 1000 }, { uidValidity: 1000, uidNext: 'x' }]) assert.equal(decideSync({ uidValidity: 1000, lastUid: 4 }, bad).action, 'resync');
});

test('SAVED POSITION: a resync forgets the old UIDs, so the next run is not mistaken for a shrunken folder (the bug the real-server proof found)', () => {
  const old = { uidValidity: '1000', lastUid: 40 };
  const rebuilt = server({ uidValidity: 2000n, uidNext: 6, exists: 5 });
  const d = decideSync(old, rebuilt);
  assert.equal(d.action, 'resync');
  const pos = nextPosition(d, old, rebuilt, 5);
  assert.deepEqual(pos, { uidValidity: '2000', lastUid: 5 }, 'not 40');
  assert.equal(decideSync(pos, rebuilt).action, 'nothing_new');
  // The wrong way (taking the larger of the two) would have saved 40 and resynced forever.
  assert.equal(decideSync({ uidValidity: '2000', lastUid: 40 }, rebuilt).reason, 'uidnext_went_backwards');
  // An empty rebuilt folder is fine too.
  const empty = server({ uidValidity: 3000n, uidNext: 1, exists: 0 });
  assert.equal(decideSync(nextPosition(decideSync(old, empty), old, empty, 0), empty).action, 'nothing_new');
});

test('SAVED POSITION: an ordinary run only ever moves forward', () => {
  const stored = { uidValidity: '1000', lastUid: 4 };
  const d = decideSync(stored, server());
  assert.deepEqual(nextPosition(d, stored, server(), 10), { uidValidity: '1000', lastUid: 10 });
  assert.deepEqual(nextPosition(d, stored, server(), 0), { uidValidity: '1000', lastUid: 4 }, 'a fetch that returned nothing keeps the position');
});

test('MESSAGE KEY: the same message in two mailboxes, or the same UID under a new UIDVALIDITY, is a different key', () => {
  assert.notEqual(messageKey(1, 'INBOX', 1000n, 7), messageKey(2, 'INBOX', 1000n, 7));
  assert.notEqual(messageKey(1, 'INBOX', 1000n, 7), messageKey(1, 'INBOX', 2000n, 7));
  assert.equal(messageKey(1, 'INBOX', 1000n, 7), messageKey(1, 'INBOX', '1000', 7));
});

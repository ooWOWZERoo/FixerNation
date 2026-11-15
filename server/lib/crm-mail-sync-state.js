// Sales CRM phase 5a (email spike): the one decision a mailbox sync has to get right, kept pure so it is tested without a mail server.
// docs/reference/crm-email-sync-spike.md has the findings this comes from.
//
// IMAP numbers each message in a folder with a UID. The UIDs only mean something together with the folder's UIDVALIDITY: if the server ever
// rebuilds the folder (a restore, a migration, a deleted-and-recreated folder) it must hand out a NEW UIDVALIDITY, and every UID we stored is
// then meaningless. So a message is identified by (mailbox, folder, uidvalidity, uid), and a changed UIDVALIDITY means "start this folder
// again, and recognise what we already have by Message-ID, never by UID". Anything that looks impossible is treated the same way: resync, never guess.
//
//   stored  = what we saved after the last run: { uidValidity, lastUid } or null for a folder never synced
//   server  = what the folder says now:         { uidValidity, uidNext, exists }
// Returns { action, fromUid, reason }.  action: 'initial' | 'nothing_new' | 'incremental' | 'resync'
const same = (a, b) => String(a) === String(b); // imapflow returns UIDVALIDITY as a BigInt; a database hands back a string or a number

function decideSync(stored, server) {
  if (!server || server.uidValidity === undefined || server.uidValidity === null || !Number.isFinite(Number(server.uidNext))) {
    return { action: 'resync', fromUid: 1, reason: 'server_state_unreadable' };
  }
  if (!stored || stored.lastUid === undefined || stored.lastUid === null) return { action: 'initial', fromUid: 1, reason: 'never_synced' };
  if (!same(stored.uidValidity, server.uidValidity)) return { action: 'resync', fromUid: 1, reason: 'uidvalidity_changed' };
  const last = Number(stored.lastUid);
  const newest = Number(server.uidNext) - 1; // the highest UID the server has handed out so far
  if (!Number.isInteger(last) || last < 0) return { action: 'resync', fromUid: 1, reason: 'stored_uid_invalid' };
  if (newest < last) return { action: 'resync', fromUid: 1, reason: 'uidnext_went_backwards' }; // same UIDVALIDITY but fewer UIDs: do not trust it
  if (newest === last) return { action: 'nothing_new', fromUid: last + 1, reason: 'up_to_date' };
  return { action: 'incremental', fromUid: last + 1, reason: 'new_messages' };
}

// The position to save after a run. On a resync (or a first run) the old position is DISCARDED: taking the larger of the old and new UIDs would keep a number from the
// previous UIDVALIDITY and every later run would think the folder had shrunk (found while proving this against a real server, see the spike document).
function nextPosition(decision, stored, server, maxFetchedUid) {
  const keep = decision.action === 'incremental' || decision.action === 'nothing_new';
  const base = keep && stored ? Number(stored.lastUid) || 0 : 0;
  return { uidValidity: String(server.uidValidity), lastUid: Math.max(base, Number(maxFetchedUid) || 0) };
}

// What identifies one stored copy of a message. The same message in two mailboxes is two rows; a UIDVALIDITY reset makes the same message a "new" UID,
// which is why a resync also checks Message-ID (per mailbox) before inserting.
const messageKey = (mailboxId, folder, uidValidity, uid) => `${mailboxId}:${folder}:${String(uidValidity)}:${uid}`;

module.exports = { decideSync, nextPosition, messageKey };

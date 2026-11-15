#!/usr/bin/env node
// Sales CRM phase 5a: email feasibility spike (docs/reference/crm-email-sync-spike.md). READ ONLY and COUNTS ONLY.
//
// It answers four questions about the mailbox the CRM would read: can this host reach it and log in over TLS, what does the server support, how much mail is there,
// and can a script that lives for a minute or two on this shared host keep the session healthy. It opens every folder read-only, never fetches a body, never
// changes a flag, never moves or deletes anything, and never prints a subject, a name, an email address or a password: only numbers, folder names, capability names and error codes.
//
// It needs `imapflow`, which is NOT in server/package.json (this is a spike: nothing in the repo or on the server changes). Install it in a scratch folder:
//   mkdir -p /home/fixernat/spike-imap && cd /home/fixernat/spike-imap && npm init -y && npm install imapflow
// then run this file with NODE_PATH pointing at that folder (see the findings document for the exact commands). The login comes from the environment only.
//
//   IMAP_HOST       mail.example.com
//   IMAP_PORT       993                 (default)
//   IMAP_SECURE     true                (default; false means STARTTLS on the port)
//   IMAP_USER       the full mailbox address
//   IMAP_PASSWORD   its password
//   --hold SECONDS  keep the session open this long, sending NOOPs, to see whether the host drops it (default 45)
//   --days N        how far back to count volume (default 30)
const { decideSync } = require('../lib/crm-mail-sync-state');

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const HOLD_SECONDS = Math.min(300, Math.max(0, Number(arg('--hold', 45))));
const DAYS = Math.min(365, Math.max(1, Number(arg('--days', 30))));
const t0 = Date.now();
const ms = () => `${Date.now() - t0} ms`;
const say = (label, value) => console.log(`${label.padEnd(34)}${value}`);
const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);

// Only codes and short generic text: a server's error line can echo the user name.
function safeError(err) {
  const bits = [err && err.code, err && err.responseStatus, err && err.authenticationFailed ? 'authentication failed' : null, err && err.serverResponseCode].filter(Boolean);
  const text = String((err && err.message) || err || '').replace(/[\w.+-]+@[\w.-]+/g, '<address>').slice(0, 100);
  return `${bits.join(' / ') || 'error'}${text ? ` (${text})` : ''}`;
}

async function main() {
  let ImapFlow;
  try { ({ ImapFlow } = require('imapflow')); } catch {
    console.error('imapflow is not installed where this script can find it. Install it in a scratch folder and set NODE_PATH (see the header of this file).');
    process.exit(2);
  }
  const host = process.env.IMAP_HOST, user = process.env.IMAP_USER, pass = process.env.IMAP_PASSWORD;
  if (!host || !user || !pass) { console.error('Set IMAP_HOST, IMAP_USER and IMAP_PASSWORD in the environment first.'); process.exit(2); }
  const port = Number(process.env.IMAP_PORT || 993);
  const secure = process.env.IMAP_SECURE !== 'false';

  console.log('Sales CRM email spike (read only, counts only)');
  say('node', process.version);
  say('server', `${host}:${port} ${secure ? 'TLS' : 'STARTTLS'}`);
  say('memory at start (rss)', `${rssMb()} MB`);

  const client = new ImapFlow({ host, port, secure, auth: { user, pass }, logger: false, socketTimeout: 60000, greetingTimeout: 20000, connectionTimeout: 20000 });
  client.on('error', (e) => say('connection error event', safeError(e)));
  let closedEarly = false;
  client.on('close', () => { closedEarly = true; });

  // 1. Connect and log in. A certificate that does not match the host name is the usual first surprise on shared hosting.
  const c0 = Date.now();
  try { await client.connect(); } catch (err) {
    say('connect + login', `FAILED ${safeError(err)}`);
    console.log('RESULT: no-go until the connection works (host name, port, TLS certificate or password).');
    process.exit(1);
  }
  say('connect + login', `ok in ${Date.now() - c0} ms`);
  const caps = [...(client.capabilities || new Map()).keys()].map(String);
  const want = ['IDLE', 'UIDPLUS', 'CONDSTORE', 'QRESYNC', 'ENABLE', 'MOVE', 'SPECIAL-USE', 'STARTTLS', 'ESEARCH', 'LIST-STATUS'];
  say('capabilities present', want.filter(w => caps.includes(w)).join(', ') || 'none of the usual ones');
  say('capabilities missing', want.filter(w => !caps.includes(w)).join(', ') || 'none');

  // 2. Folders: names and the folder's own counters (read-only STATUS, nothing is selected for writing).
  const folders = await client.list({ statusQuery: { messages: true, uidNext: true, uidValidity: true } });
  say('folders', String(folders.length));
  let totalMessages = 0;
  const perFolder = [];
  for (const f of folders) {
    if (f.flags && f.flags.has('\\Noselect')) continue;
    const st = f.status || {};
    totalMessages += Number(st.messages || 0);
    perFolder.push({ path: f.path, special: f.specialUse || '', messages: Number(st.messages || 0), uidNext: st.uidNext, uidValidity: st.uidValidity });
  }
  for (const f of perFolder) {
    console.log(`  ${f.path.padEnd(28)} ${String(f.messages).padStart(7)} messages  uidvalidity ${String(f.uidValidity)}  ${f.special}`);
  }
  say('messages in all folders', String(totalMessages));

  // 3. Volume and size from headers only: SEARCH by date, then FETCH of size and internal date (no envelope, no body).
  const since = new Date(Date.now() - DAYS * 86400000);
  const inbox = perFolder.find(f => f.path.toUpperCase() === 'INBOX') || perFolder[0];
  if (inbox) {
    const lock = await client.getMailboxLock(inbox.path, { readOnly: true });
    try {
      say('opened read-only', inbox.path);
      say('uidvalidity / uidnext', `${String(client.mailbox.uidValidity)} / ${String(client.mailbox.uidNext)}`);
      const recent = await client.search({ since }, { uid: true });
      const f0 = Date.now();
      let bytes = 0, biggest = 0, n = 0;
      const perDay = new Map();
      if (recent.length) {
        for await (const m of client.fetch(recent.slice(-2000), { uid: true, size: true, internalDate: true }, { uid: true })) {
          n += 1; bytes += Number(m.size || 0); biggest = Math.max(biggest, Number(m.size || 0));
          const day = new Date(m.internalDate).toISOString().slice(0, 10);
          perDay.set(day, (perDay.get(day) || 0) + 1);
        }
      }
      const days = [...perDay.values()];
      say(`messages in the last ${DAYS} days`, String(recent.length));
      say('busiest day / average per day', `${days.length ? Math.max(...days) : 0} / ${(recent.length / DAYS).toFixed(1)}`);
      say('size: average / biggest', n ? `${Math.round(bytes / n / 1024)} KB / ${Math.round(biggest / 1024)} KB` : 'n/a');
      say('header fetch speed', n ? `${n} messages in ${Date.now() - f0} ms` : 'n/a');

      // 4. What the sync decision would do for a first run, and for a run that already saved a position one message back.
      const server = { uidValidity: client.mailbox.uidValidity, uidNext: client.mailbox.uidNext, exists: client.mailbox.exists };
      say('first sync would do', decideSync(null, server).action);
      say('a saved position would do', decideSync({ uidValidity: server.uidValidity, lastUid: Number(server.uidNext) - 2 }, server).action);
      say('a changed UIDVALIDITY would do', decideSync({ uidValidity: '1', lastUid: 5 }, server).reason);
    } finally { lock.release(); }
  }

  // 5. Hold the session the way a cron run would, to see whether this host (or the server) drops it.
  if (HOLD_SECONDS > 0) {
    const h0 = Date.now();
    let noops = 0;
    while (Date.now() - h0 < HOLD_SECONDS * 1000 && !closedEarly) {
      await new Promise(r => setTimeout(r, 5000));
      try { await client.noop(); noops += 1; } catch (err) { say('session dropped', `after ${Math.round((Date.now() - h0) / 1000)} s: ${safeError(err)}`); break; }
    }
    say(`held ${HOLD_SECONDS}s`, closedEarly ? 'NO, closed early' : `yes (${noops} NOOPs answered)`);
  }

  // 6. A clean logout, then a second login (a cron job starts a new session every run).
  await client.logout();
  const again = new ImapFlow({ host, port, secure, auth: { user, pass }, logger: false });
  again.on('error', () => {});
  const r0 = Date.now();
  try { await again.connect(); say('second login', `ok in ${Date.now() - r0} ms`); await again.logout(); } catch (err) { say('second login', `FAILED ${safeError(err)}`); }

  say('memory at end (rss)', `${rssMb()} MB`);
  say('total run time', ms());
  console.log('Nothing was changed in the mailbox. No message text, subject or address was printed.');
}

main().catch(err => { console.error('The spike stopped:', safeError(err)); process.exit(1); });

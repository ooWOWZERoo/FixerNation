# Sales CRM phase 5a: email feasibility spike

Written 2026-11-15. This is the spike the plan calls for before any email code (`docs/reference/sales-crm-update-requirements.md`, decision D7 and phase 5a). **No schema, no table, no setting and no change to the running site.** It answers one question: can the CRM safely read one mailbox from this host? The answer is **GO**: the software side was proven locally, and the owner's run on the real host on 2026-11-15 passed every check (section 6).

## 1. What was found out

| Question (D7) | Answer | How we know |
|---|---|---|
| Is there an IMAP library, and does it fit this host? | **Yes: `imapflow` 2.11 (reads mail) and `mailparser` 3.14 (reads a message's text).** Both are pure JavaScript with no native addon, MIT licensed, Node 20 or newer (the host runs Node 24). Neither is installed in the repo yet. | `npm view` shows their whole dependency lists (pino, iconv-lite, libmime, socks, linkify-it, html-to-text, nodemailer 10.5, and similar): nothing compiled. That is the opposite of the `tfjs-node` trouble on this host (hidden thread caps, script approval), so that checklist does not apply. `mailparser` already shares `nodemailer` with the site. |
| Does a library session work end to end? | **Yes**, against a real IMAP server (GreenMail, in Docker): connect, list folders, count, read headers read-only, hold the session with NOOPs, log out, log in again. 40 messages' headers fetched in 3 ms; the whole script used about 77 MB. | `server/scripts/spike-crm-imap.js` run locally. |
| Does UIDVALIDITY handling work? | **Yes, and the proof found a bug in my first draft.** After the server rebuilt the folder (new UIDVALIDITY), the sync noticed, started the folder again, recognised the 3 messages it already had by Message-ID (re-keyed, not duplicated), added the 2 new ones, and the next run found nothing new. The first draft kept the larger of the old and new UIDs, so every later run thought the folder had shrunk and resynced forever; fixed in `nextPosition()` and pinned by a test. | `lib/crm-mail-sync-state.js`, `test/crm-mail-sync-state.test.js` (7 tests), plus a throwaway proof against GreenMail (a restart gives the folder a new UIDVALIDITY). |
| Which host, port, TLS? | **Not known from the repo.** `.env.example` says sending uses `mail.fixernationeducation.com` on 587 (STARTTLS) with the mailbox's own address and password. cPanel's usual reading side is the same host on **993 with TLS**. Reading uses the same mailbox login, so no new account type is needed. | `.env.example`; to be confirmed by the run below. |
| Can a cron-run Node script hold a session on this host? | **Unknown until it is run there.** Nothing on the software side stops it. The host-specific risks are the account's hidden CloudLinux caps, an outbound-connection rule, and the mail server's idle timeout. | Section 3 tests the first and third; the plan's cron scripts already show a Node script can run on this host. |
| How much mail is there? | **Unknown until it is run.** | Section 3 prints counts only. |

## 2. What the spike script and the sync rule do

`server/scripts/spike-crm-imap.js` is **read only and counts only**. It opens folders read-only, never fetches a body, never sets or clears a flag, never moves or deletes anything, and never prints a subject, a name, an address or a password. Errors print a code and a short generic line with any email address blanked. The login comes from the environment, typed in the Terminal, never written to a file by the script.

`server/lib/crm-mail-sync-state.js` is the one decision a sync must get right:

- A message is identified by **(mailbox, folder, UIDVALIDITY, UID)**. If UIDVALIDITY changes, every saved UID is meaningless: start the folder again and recognise what we already have by **Message-ID within that mailbox**, never by UID.
- Anything that does not add up (UID counter went backwards, unreadable server state, a bad saved number) means **resync, never guess**.
- After a resync the saved position is **discarded, not merged** with the old one.
- The same message in two mailboxes is two rows (the key includes the mailbox).
- A resync never deletes what we already hold. A rebuilt folder that lost mail does not erase our copy.

## 3. What only the owner can run (about five minutes, cPanel Terminal)

This needs the mailbox address and its password, typed into the Terminal on the server. **Do not paste either into the chat.** The output is counts and timings only, safe to paste back. Use the mailbox that sends the site's email (`SMTP_USER`), or a mailbox you would be happy for the CRM to read.

**Step A. Pull the code and put the library in a scratch folder** (nothing in the repo or `package.json` changes):

```bash
cd /home/fixernat/repositories/fixernation && git pull
```

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  mkdir -p /home/fixernat/spike-imap && cd /home/fixernat/spike-imap && \
  npm init -y > /dev/null && npm install imapflow
```

**Step B. Run the spike** (it asks for the address and password without showing the password; it holds the session for 90 seconds):

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  read -r -p "Mailbox address: " IMAP_USER && read -r -s -p "Password: " IMAP_PASSWORD && echo && \
  IMAP_HOST=mail.fixernationeducation.com IMAP_USER="$IMAP_USER" IMAP_PASSWORD="$IMAP_PASSWORD" \
  NODE_PATH=/home/fixernat/spike-imap/node_modules node scripts/spike-crm-imap.js --hold 90 --days 30 ; \
  unset IMAP_USER IMAP_PASSWORD
```

If it says the certificate does not match the host name, open cPanel, Email Accounts, Connect Devices for that mailbox, use the "Incoming Server" name shown there as `IMAP_HOST`, and run it again. Tell me what it printed either way.

**Step C. Clean up** (removes only the scratch folder this spike made):

```bash
rm -rf /home/fixernat/spike-imap
```

## 4. Go or no-go, decided from that output

| Look at | Go | Stop and reshape |
|---|---|---|
| `connect + login` | `ok` in under a few seconds | fails (host name, port, certificate or password), or the host blocks outbound mail ports |
| `held 90s` | `yes` | the session drops (an idle timeout shorter than a sync run, or a host limit) |
| `second login` | `ok` | fails (the host or server limits repeated logins) |
| `memory at end` and run time | well under about 150 MB and a minute or two | the process is killed or crawls |
| `messages in all folders` and `busiest day` | any volume the plan expects (a small sales inbox) | tens of thousands of messages: then the first sync needs a date window |
| `capabilities` | UIDPLUS present (UID-based work); IDLE, CONDSTORE and QRESYNC are nice, not needed (we poll every few minutes) | UIDPLUS missing: workable, tell me |

If it is a **no-go**, the plan's fallback is a **shared-inbox forwarding address**: staff BCC or forward customer mail to one address the CRM reads, instead of connecting to personal mailboxes. That is smaller and needs no per-person grants.

## 5. What phase 5b would build, if go (nothing built yet)

One mailbox, **read-only**, first. Decisions this spike points to (confirm before 5b):

1. **Secret storage:** the mailbox password stored encrypted with a key held only in `server/.env`, never in git (D7). Nothing is stored until 5b.
2. **How it runs:** a cron script every few minutes, one session per run (the `held` and `second login` checks decide this), using the MariaDB `GET_LOCK` so two runs never overlap. No in-process scheduler (there is none on this host, and no pm2).
3. **What is stored:** headers, Message-ID, threading ids (`References`, `In-Reply-To`, never the subject), the sanitized text and its attachments' names, linked to a contact by exact address match, with ambiguous matches in a review queue and never guessed.
4. **What is never stored or logged:** passwords, message bodies in logs, or anything from a folder the owner has not chosen.
5. **Student data:** a customer's mail can contain a student's name. 5b needs a stated rule (for example: only the folders the owner picks, staff-only screens, and the same retention rule as other CRM files) before the first real sync.
6. **Libraries added in 5b only:** `imapflow` and `mailparser` in `server/package.json`, with `npm install` on cPanel (pure JavaScript, so no script-approval step expected).

Phase 5c (reply and send through `lib/mailer.js`) and 5d (AI) stay as the plan has them. The plan still says 5d waits until sync has run stably for a month.

## 6. Result of the run on the real host (2026-11-15) — GO

Run by the owner in the cPanel Terminal against the `sales@` mailbox, `mail.fixernationeducation.com` port 993 (TLS), Node 24.22. Counts and timings only.

| Check | Result | Verdict |
|---|---|---|
| Connect and log in | ok in 416 ms; the certificate matches the host name | go |
| Capabilities | IDLE, UIDPLUS, CONDSTORE, QRESYNC, ENABLE, MOVE, SPECIAL-USE, ESEARCH, LIST-STATUS all present (STARTTLS absent only because port 993 is TLS from the first byte) | go, and better than needed |
| Hold a session | **90 seconds, 18 keep-alive pings answered, never dropped** | go |
| Second login | ok in 202 ms | go |
| Memory and time | 70 MB at start, 83 MB at the end, 92 seconds in all (90 of them the deliberate hold) | go |
| Volume | 8 folders, 68 messages in all; INBOX 41, Trash 11, "Registered Teachers" 16, the rest empty; **7 messages in the last 30 days**, busiest day 4, average 0.2 a day, about 2 KB each | go: tiny. A whole first sync is milliseconds |

What it tells us for 5b:

- **Polling is plenty.** At under one message a day, a cron run every 10 minutes is more than frequent enough; IDLE and long-lived sessions are not needed. Each run opens a session, asks for anything after the saved UID, and leaves.
- **Folder names are `INBOX.<name>`** (this server nests everything under INBOX), so folders must be chosen by their saved path and by the SPECIAL-USE flag, never by assuming `Sent` or `Junk`.
- **`INBOX.Registered Teachers` (16 messages) looks like a filing rule for automated sign-up notices.** Those carry teachers' names and addresses and are not sales conversations. 5b should read only the folders the owner ticks, and this one is better left unticked.
- **CONDSTORE and QRESYNC exist**, so a later version could ask the server for just what changed; the plain UID approach is already enough at this volume.
- **UIDVALIDITY values are timestamps** (about 1786105149), as expected, and the sync rule in `lib/crm-mail-sync-state.js` handles a change.
- **A byproduct:** the INBOX also receives delivery-failure notices. The plan's deferred "deeper bounce detection" (CHANGELOG, Unreleased) could reuse this same reader later. It is not part of 5b.

The scratch folder `/home/fixernat/spike-imap` can now be deleted (Step C).

## 7. Owner's decisions after the spike (2026-11-15)

- **Folders:** INBOX only. Trash, Junk and `Registered Teachers` are never read.
- **Who reads mail in the CRM:** CRM Admin only to start; Sales gets access later by a per-person grant.
- **Timing:** **pause here.** Phase 5b is not started. Use the pipeline, tasks and quotes on real deals first (the plan's checkpoint), then start 5b in a fresh session. The spike result stays valid; if the mailbox login changes or the host is moved, run the spike again.
- Still to settle when 5b starts: the student-data rule from section 5 (item 5) and where the encryption key for the mailbox password lives.

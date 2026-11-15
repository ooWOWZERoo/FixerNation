# Customer Hub (Sales CRM): operations runbook

Written 2026-11-15 for the person who runs the site (cPanel browser Terminal, no SSH, no pm2). Plan and rules: `sales-crm-update-requirements.md`. Every command starts with its full `cd`, as the deploy rules require. On cPanel, activate Node first, in the same command:

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server
```

## 1. The one switch

The setting `crm_v2_enabled` turns the whole Hub on or off. Off means every `/api/crm/*` route answers 404 and the three nightly CRM jobs do nothing. **Off deletes nothing**: the data stays, the older admin pages (quotes, contacts, invoices) keep working, and the payment hooks do nothing instead of recording. It is read on every request, so it takes effect on the next click. A test (`server/test/crm-hardening.test.js`) turns it off and on around real data and proves this.

```bash
source /home/fixernat/nodevenv/repositories/fixernation/server/24/bin/activate && \
  cd /home/fixernat/repositories/fixernation/server && \
  node scripts/set-crm-enabled.js --status
```

Use `--off` or `--on` in place of `--status`. **If something looks wrong in the Hub, `--off` first, then look.**

## 2. The nightly jobs (cPanel Cron Jobs; `server/scripts/setup-cron-jobs.sh` installs them, safe to re-run)

| When (server time) | Script | What it does | Log (`/home/fixernat/logs/`) |
|---|---|---|---|
| 03:40 | `reconcile-crm-classification.js --apply --only-if-enabled` | Re-derives Suspect / Prospect / Customer from paid purchases. A safety net for a payment hook that was missed. Never demotes a Customer: it writes a "needs review" event instead. | `cron-crm-reconcile.log` |
| 06:50 | `crm-daily-attention.js --apply --only-if-enabled` | Works out the Needs Attention list and records each new item once. Emails the owner digest only if `crm_attention_email` is `true` (off by default). | `cron-crm-attention.log` |
| 07:10 | `crm-renewals.js --apply --only-if-enabled` | Makes renewal and expansion deals. Does nothing unless `crm_renewal_generator` is also `true`. Running it twice makes the deals once. | `cron-crm-renewals.log` |
| 08:00 | `quote-expiring-reminder.js` | Emails a customer when a quote is about to expire. Skips a quote a newer revision has replaced. Not CRM-gated: it runs with the Hub off. | `cron-quote-reminder.log` |
| 02:30 | `backup-nightly.js` | The nightly database and uploads backup. The CRM tables are in it. CRM files are under `uploads/crm-private/`, so they are in it too. | `cron-backup-nightly.log` |

**How to tell a job ran:** open its log: each run prints one summary line (counts only, no names or emails). The file's modified time (`ls -l --time-style=long-iso /home/fixernat/logs/cron-crm-*.log`) should be from this morning. **Run one by hand** with the command from the table, first without `--apply` (a dry run that changes nothing and prints what it would do), then with it.

**What failing looks like:**
- *A log is stale (older than a day)*: the cron line is missing. Run `setup-cron-jobs.sh` again, then `crontab -l | grep crm`.
- *"Unknown column" or "doesn't exist" in a log*: an alter script has not been run. Run the missing one (section 4), then re-run the job.
- *The log is fine but the Hub shows nothing new*: the Hub is off, or (renewals) `crm_renewal_generator` is not `true`. Both are deliberate and print a line saying so.
- *A job prints a count of exceptions*: that is a finding, not a failure. Open Customer Hub > Reports > Reconciliation.

## 3. Reports and exports

Customer Hub > **Reports** has six reports, each with its dates and its definition on the page. Everyone with a CRM role sees the numbers. **Download CSV is CRM Admin only**, the file holds summary numbers (no contact, account or deal names), and each download writes an audit row (`crm_report_exported`). To see who exported what: the audit viewer, entity type `crm_report`.

## 4. Database scripts, in the order they were added (each safe to re-run; alter scripts go BEFORE the Node restart)

1. `alter-create-crm-core.js` (phase 1: accounts, deals, stages, labels)
2. `alter-create-crm-execution.js` (phase 3: tasks, notes, files, meetings, checklists, Needs Attention)
3. `alter-create-crm-quotes.js` (phase 4: quote revisions, acceptance evidence, quote events, the `purchases.quote_id` foreign key)
4. `alter-create-crm-growth.js` (phase 6: engagement and attribution)

Phase 7 added **no** database change. Fresh installs get everything from `server/db/schema.sql`.

## 5. Rolling back one phase

Rolling back never drops a table. Code goes back with `git revert` of that phase's commit, a pull, the rsync, and a Node restart; the extra columns and tables stay and are ignored. In order of safest first:

- **Hub misbehaving:** `set-crm-enabled.js --off` (section 1). Nothing else needed.
- **Phase 7 (Reports):** revert its commit. No data was added.
- **Phase 6 (renewals, engagement, attribution):** set `crm_renewal_generator` to anything but `true` to stop new renewal deals. Deals it already made stay; close or delete them by hand.
- **Phase 4b to 4d (revisions, evidence, Won handoff):** reverting the code makes the accept page stop asking for a name; the saved names and hashes stay. A quote already marked replaced would then accept again, so before reverting, list replaced quotes: `SELECT id, quote_number FROM quote_requests WHERE version_status = 'superseded'`.
- **Phase 4a (billing hardening):** code only, revert the commit. Check afterwards that no card quote is waiting on a payment.
- **Phases 1 to 3:** do not revert the code. Switch the Hub off instead; the hooks in the payment path then do nothing.

## 6. Known limits (measured on 2026-11-15 with about ten times today's data on a throwaway MariaDB: 45,000 contacts, 5,000 quotes, 3,000 deals, 12,000 stage changes, 200,000 campaign sends)

Every list, the Overview, the deal page and the six reports answer in under 120 ms except two, which are fine today and have a known next step:

| Screen | At 10x data | Why | Do this when |
|---|---|---|---|
| Quotes without a deal | about 350 ms | Matching a quote to its contacts compares the lower-cased, trimmed email, which cannot use an index. It scans the contacts table once per row shown. | Contacts pass about 100,000 (about 1 second). Add an indexed generated column holding the normalized email and compare on that. |
| Account timeline | about 160 ms | It gathers every person's campaign sends. Indexed; cost grows with an account's size. | Nothing needed. |

Today's real size (about 4,500 contacts) is a tenth of the test, so both are a few milliseconds. No index script was needed.

## 7. Who can do what (short form; the full matrix is in the requirements doc)

CRM Admin: everything, including settings, roles, merges, reopening a deal, accepting a quote for a customer, and exports. Sales: see everything, edit their own and unowned deals. Read-only: see everything except files, change nothing. A site user (teacher, parent, student) never reaches any of it. `is_fne_staff` grants nothing here.

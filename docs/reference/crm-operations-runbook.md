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
| 06:50 | `crm-daily-attention.js --apply --only-if-enabled` | Works out the Needs Attention list and records each new item once. Emails the owner digest only if `crm_attention_email` is `true` (off by default). Also makes one review task per live trial that is ending, well used or stalled (once per trial per reason, ever): OFF until `node scripts/crm-daily-attention.js --trial-tasks on` (setting `crm_trial_review_tasks`); until then it prints what it would make and writes nothing. Needs `alter-create-crm-trial-review-tasks.js`; without the table it says so and skips. Also adds the "Onboarding" checklist (template in Hub Settings) to each deal that is Won with a paid, non-trial purchase, once per deal ever: OFF until `node scripts/crm-daily-attention.js --onboarding on` (setting `crm_onboarding_auto`); until then it only counts. Needs `alter-create-crm-onboarding.js`. | `cron-crm-attention.log` Also makes one follow-up task per quote that was sent and not accepted after the set number of days (G20, off until `--quote-followups on`). |
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

Customer Hub > **Reports** has fourteen reports (the original six, plus eight added in gap G9: pipeline by state and product, forecast by month, sale velocity, quote conversion, trial to paid, procurement blockers, coverage, renewals and expansions), each with its dates and its definition on the page. Everyone with a CRM role sees the numbers. **Download CSV is CRM Admin only**, the file holds summary numbers (no contact, account or deal names), and each download writes an audit row (`crm_report_exported`). To see who exported what: the audit viewer, entity type `crm_report`.

## 4. Database scripts, in the order they were added (each safe to re-run; alter scripts go BEFORE the Node restart)

1. `alter-create-crm-core.js` (phase 1: accounts, deals, stages, labels)
2. `alter-create-crm-execution.js` (phase 3: tasks, notes, files, meetings, checklists, Needs Attention)
3. `alter-create-crm-quotes.js` (phase 4: quote revisions, acceptance evidence, quote events, the `purchases.quote_id` foreign key)
4. `alter-create-crm-growth.js` (phase 6: engagement and attribution)

5. `alter-crm-trial-flag-and-quote-index.js` (review fixes B7-B16: `purchases.is_trial_flag`, filled from each purchase's product, and a composite quote index; run it before the restart, the Customer rule reads the column)
6. `alter-add-quote-acceptance-snapshot.js` (review fix S10: `quote_requests.acceptance_document_snapshot`; the app works without it and records the hash only)
7. `scrub-crm-merge-audit.js` (review fix S12, optional: removes the removed person's name and email from old merge audit rows; counts only unless `--apply`)
8. `alter-create-crm-trial-review-tasks.js` (gap G3: the `crm_trial_review_tasks` ledger that keeps the daily job from making a trial's review task twice; run it before the restart)

Phase 7 added **no** database change. Fresh installs get everything from `server/db/schema.sql`.

**Audit log:** Customer Hub > Hub Settings > "Read the audit log" (CRM Admin only; the page is `admin-crm-audit.html`). **Erasing a person:** deleting a contact that has CRM notes, tasks, files or meetings asks a CRM Admin to confirm and then erases them together (files from disk too); the audit log keeps counts only. **`stderr.log`:** database error messages can include an email address; the file is not cleaned by the app, so clear it now and then (cPanel File Manager, or `: > /home/fixernat/repositories/fixernation/server/stderr.log` after a restart).

## 5. Rolling back one phase

Rolling back never drops a table. Code goes back with `git revert` of that phase's commit, a pull, the rsync, and a Node restart; the extra columns and tables stay and are ignored. In order of safest first:

- **Hub misbehaving:** `set-crm-enabled.js --off` (section 1). Nothing else needed.
- **Trial review tasks (gap G3):** `node scripts/crm-daily-attention.js --trial-tasks off` stops new ones. Tasks already made stay; finish or delete them by hand (deleting one does not bring it back, because the ledger row stays).
- **Onboarding checklists (gap G4):** `node scripts/crm-daily-attention.js --onboarding off` stops new ones. Checklists already added stay; remove steps by hand on the deal (they do not come back, because the ledger row stays).
- **Quote follow-up tasks (gap G20):** `node scripts/crm-daily-attention.js --quote-followups off` stops new ones. Tasks already made stay; a finished or deleted task is not made again (the ledger row stays). The number of days is on Hub Settings ("A follow-up task is made for a sent quote after", default 5). Quotes sent more than 60 days ago are never given a task, only listed on Needs Attention.
- **District reorder requests (gap G5):** there is no cron job. Requests are made by district administrators on `district-admin-renew.html` and decided on the Customer Hub's Reorder requests page. To stop new ones, remove the menu link in `district-admin-nav.js` (the routes still answer); a request already waiting stays until staff decide it or the district cancels it. Before `alter-create-crm-repeat-requests.js` has run, both pages say "not available yet".
- **Refund and dispute flags (gap G21):** nothing runs on a schedule; flags come from Stripe's `charge.refunded` and `charge.dispute.created` events (add both to the existing webhook endpoint in the Stripe dashboard) or are raised by hand on the Refunds page. To stop Stripe flags, remove those two events in Stripe; flags already raised stay. A confirmed full refund takes the purchase out of the Customer Hub's paid counts; to undo a mistaken confirm, ask a developer (there is no un-confirm button on purpose, so the audit trail stays honest). Needs `alter-create-crm-refunds.js` BEFORE the Node restart, because the Customer rule reads the table. A refund Stripe reports for a payment that matches no purchase is audited as `crm_refund_unmatched`.
- **Phase 7 (Reports):** revert its commit. No data was added.
- **Phase 6 (renewals, engagement, attribution):** set `crm_renewal_generator` to anything but `true` to stop new renewal deals. Deals it already made stay; close or delete them by hand.
- **Phase 4b to 4d (revisions, evidence, Won handoff):** reverting the code makes the accept page stop asking for a name; the saved names and hashes stay. A quote already marked replaced would then accept again, so before reverting, list replaced quotes: `SELECT id, quote_number FROM quote_requests WHERE version_status = 'superseded'`.
- **Phase 4a (billing hardening):** code only, revert the commit. Check afterwards that no card quote is waiting on a payment.
- **Phases 1 to 3:** do not revert the code. Switch the Hub off instead; the hooks in the payment path then do nothing.

## 6. Known limits (measured on 2026-11-15 with about ten times today's data on a throwaway MariaDB: 45,000 contacts, 5,000 quotes, 3,000 deals, 12,000 stage changes, 200,000 campaign sends)

Every list, the Overview, the deal page and the original six reports answer in under 120 ms (the eight added later have not been timed on the large test set) except two, which are fine today and have a known next step:

| Screen | At 10x data | Why | Do this when |
|---|---|---|---|
| Quotes without a deal | about 350 ms | Matching a quote to its contacts compares the lower-cased, trimmed email, which cannot use an index. It scans the contacts table once per row shown. | Contacts pass about 100,000 (about 1 second). Add an indexed generated column holding the normalized email and compare on that. |
| Account timeline | about 160 ms | It gathers every person's campaign sends. Indexed; cost grows with an account's size. | Nothing needed. |

Today's real size (about 4,500 contacts) is a tenth of the test, so both are a few milliseconds. No index script was needed.

## 7. Who can do what (short form; the full matrix is in the requirements doc)

CRM Admin: everything, including settings, roles, merges, reopening a deal, accepting a quote for a customer, and exports. Sales: see everything, edit their own and unowned deals. Read-only: see everything except files, change nothing. A site user (teacher, parent, student) never reaches any of it. `is_fne_staff` grants nothing here.

Since 2026-11-15 the same roles also apply to a few older admin pages, with the Hub on or off: **admin accounts** (invite, edit, reset, delete) are CRM Admin only and a new admin starts as Read-only (set their role in Hub Settings); **accepting a quote for the customer** is CRM Admin only; **editing or sending a quote** needs Sales or CRM Admin, **changing a sent quote's price** is CRM Admin only (and audited), and an accepted quote's price cannot change. Everything else on the older pages is still open to every admin (see the punch list).

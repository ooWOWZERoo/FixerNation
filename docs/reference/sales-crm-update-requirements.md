# Sales CRM update (Customer Hub): gap analysis and phased plan

Written 2026-11-14. **Nothing here is built and nothing is confirmed.** Source spec: `FNE_Customer_Hub_CRM_PRD_v4.md` (the owner's file, outside the repo). Code read for this plan: the quote, accept, checkout, invoice, newsletter, auth, audit, mailer, automation and cron code, plus `docs/reference/database-schema-live.sql` (the 2026-11-14 production snapshot; drift against code is in `schema-drift-2026-11-14.txt` and does not touch any table this update uses, except two harmless index differences on `purchases` and `quote_requests`).

Per CLAUDE.md: requirements first, owner confirms the decisions in section 5, then one phase per release (a fresh session per phase). Every phase needs a CHANGELOG entry, the video check on commit, and push and deploy steps with full `cd` paths. Anything customer-visible also needs a draft release note and a how-to video; the staff-only CRM screens need neither.

## 1. Scale and shape of the data (why the plan is lighter than the PRD)

The first draft of this plan used the snapshot's `AUTO_INCREMENT` values, which are the highest id ever used, not row counts. The real counts from the 2026-11-14 preflight are: **4,540 contacts (27 of them `@example.com`), 6 quotes, 21 purchases (15 owned by `@example.com` contacts), 3 invoices, 4 admin users, 20 districts, 30 schools, 3 demo invitations, 2 support tickets.** The 2026-09-05 go-live cutover deleted every test purchase and quote and kept contacts. So this is a very small sales operation today: the useful part of the CRM is the workflow going forward (leads, deals, follow-ups, quotes), not reporting on history. Section 6 says what to defer, and section 1b adds a checkpoint after Phase 3.

## Status (2026-11-14)

- **Decisions D1 to D14 (section 5): confirmed by the owner as recommended ("Accept all").** Where a recommendation was a question, the recommended answer stands: Sales can see everything and edit only their own deals (D1); a NULL-amount manual purchase never counts until the owner confirms it (D3); the `closed` quotes become Inactive until the owner says won or lost (D5); AI is deferred (D8); the Phase 6 deferred list stays deferred (D9).
- **Phase 0: done.** Test baseline recorded (`cd server && npm test`: 1,002 pass, 0 fail, 0 skipped, about 16 seconds, on 2026-11-14). `server/scripts/report-crm-preflight.js` is written (read-only, counts only); the owner ran it on production and the output is below. The stale CLAUDE.md lines (admin accounts, where `requireSiteAuth` lives) are corrected.
- **Phase 1: built 2026-11-14, not yet deployed** (the API and data foundation; there are no new screens, those are phase 2). Eight `crm_*` tables and the extra columns (`scripts/alter-create-crm-core.js`), the one Customer rule (`lib/crm-classification.js`), staff roles and the off switch (`lib/crm-permissions.js`, setting `crm_v2_enabled`), the account, contact, deal and settings routes under `/api/crm`, small after-the-fact hooks in the purchase, invoice, card-quote and quote-request code (`lib/crm-hooks.js`: never throw, never change a response, do nothing while the switch is off), the reassign step when an admin who owns CRM records is deleted (D13) and the refusal to delete a contact who is on a deal, a backfill (`scripts/backfill-crm-core.js`, dry run by default) a nightly reconcile (`scripts/reconcile-crm-classification.js`, cron line in `setup-cron-jobs.sh`) and the switch script (`scripts/set-crm-enabled.js`). Verified on a throwaway real MariaDB (both alter runs, the backfill twice with identical results, every route over HTTP, the admin reassign) and by 51 new tests (suite: 1,053 pass, 0 fail). Deploy steps are in the CHANGELOG entry.
- **Phase 2: built 2026-11-14, not yet deployed** (screens and the small API gaps; see the CHANGELOG entry). Eight `admin-crm-*.html` pages and the Customer Hub nav group, the old contacts page's label column and filter, quotes-without-a-deal and make-a-deal-from-a-quote, a manual Suspect (added **Unsubscribed** unless staff tick the box, so a lead is never put on the newsletter without consent), contact and account merge (CRM Admin only), the duplicate review list, an Overview endpoint, and deal-list filters (`overdue`, `staleDays`, `sort`). Checked on the local MariaDB stack for CRM Admin, Sales and Read-only; Kanban drag verified in Chromium (touch uses the "Move to" menu). Not built, by design: tasks, notes, files, meetings (phase 3), quote versions and the won hand-off (phase 4), email and AI (phase 5). **Stop here: the plan's checkpoint comes after phase 3.**
- **Phase 3: built 2026-11-14, not yet deployed** (tasks, notes, files, meetings, procurement checklists, Needs Attention, timeline; the access matrix is in section 6, written before the code). Eight new tables (`scripts/alter-create-crm-execution.js`), seven route files, a daily job (`scripts/crm-daily-attention.js`), two pages (Tasks, Needs Attention), shared panels on the deal, account and contact pages, a checklist templates card on Hub Settings, and the account, contact and delete rules around them (merges move the new items; a contact with notes, tasks, files or meetings cannot be deleted). Checked by 37 new tests (suite: 1,112 pass) and a Playwright spec on the local stack for CRM Admin, Sales and Read-only, at phone width and in dark mode. **Follows the plan loosely:** tasks use a due *day*, not a time; the daily job records what it has seen and sends an owner digest only if the owner switches on `crm_attention_email` (off by default); files live under `UPLOADS_DIR/crm-private/`, which `.htaccess` blocks; the timeline counts a demo once from the quotes and support requests that came from it (there is no separate demo events table). **Not built:** quote versions and the won hand-off (phase 4), email and AI (phase 5). **Stop here: the checkpoint comes now.** Confirm, trim or drop phases 5 to 7 once the pipeline, tasks and timeline have been used for real deals.
  - **Where it follows the plan loosely:** new quotes made after the backfill are not given a deal automatically (that is phase 4b); re-running the backfill picks them up, and phase 2's "quotes without a deal" list will show them. Contact merge and account merge are not built (only archive); the matrix lists merge as CRM Admin only and phase 2 adds it. Quote versions, `quote_requests.revision_number` and the other phase 4 quote columns are not added yet; only `contact_id` and `opportunity_id` are.

- **Phase 4a: built 2026-11-14, not yet deployed** (billing hardening only; code, no schema change). The owner confirmed the 4a spec in Phase 4 below: alert staff only on a double payment (no auto-refund), reuse one open card purchase per quote, a failed PO acceptance undoes everything. 14 new tests in `server/test/quote-billing-hardening.test.js` (nine fail on the old code); suite 1,126 pass. **Not built:** 4b (quote integration, the `purchases.quote_id` foreign key, revisions, acceptance evidence), 4c (Won handoff), 4d (procurement view). Concurrency itself (two requests at the same instant) rests on the database's row lock and is not provable in the SQLite tests; the replay and retry cases are.

- **Phases 4b, 4c, 4d: built 2026-11-14, not yet deployed** (committed together with 4a at the owner's request, after 4a was deployed). Spec and the owner's four answers are in section 6, "4b to 4d spec". Built as specified, with these choices worth knowing: the quote event for "page opened" is stored as `page_opened` (a test forbids the word "viewed" in CRM code); there is no `expired` event (expiry is computed, never stored); a revision replaces the old quote when it is **sent**, not when it is made; the Won handoff closes the deal under the admin's name (the acceptance function takes `skipDealClose`), while a customer's own acceptance closes it as the system; the evidence hash covers the four content-profile sections as they read at the moment of accepting. **Verified:** 28 new tests (suite 1,154 pass), the alter script run twice and its orphan check on real MariaDB, a fresh install from `schema.sql`, and a scripted end-to-end run on the local stack. **Not verified:** the Stripe test-mode run of a card quote, and the screens in a browser (the three pages were syntax-checked and their data checked over HTTP, not clicked through). **Next:** phase 5 (email and AI) starts with a spike and should begin in a fresh session after the owner's checkpoint.

- **Phase 5a (email spike): GO, 2026-11-15** (the owner's run on the real host passed every check: TLS login in 416 ms, a 90-second session held with 18 pings, a second login, 83 MB, about 7 messages a month in the `sales@` inbox; results in section 6 of `docs/reference/crm-email-sync-spike.md`). Earlier note, software side: (`docs/reference/crm-email-sync-spike.md`). `imapflow` and `mailparser` are pure JavaScript (no native addon, Node 20+), a session worked end to end against a real IMAP server, and the UIDVALIDITY rule was proven by rebuilding a folder under it (which also found and fixed a bug in the first draft). Built: `scripts/spike-crm-imap.js` (read only, counts only), `lib/crm-mail-sync-state.js`, 7 tests. No schema or setting changed; nothing is installed on the server except a scratch folder the owner deletes. **Next:** the 5b decisions (which folders, who may read, the student-data rule) before any schema.

- **Overview status outlines (built 2026-11-15, owner's idea, not a numbered phase):** red, yellow or green outline plus a chip with its own shape and words on five Overview boxes (My tasks today, Needs attention, Overdue next steps, Needs a decision, Deals with no next step). Rules live in `crm-status.js` and are tested against the server's Needs Attention rule list so the two cannot drift. Hard rules: never on a contact, a label or a pipeline total (it would read as hot, warm and cold); colour is never the only signal; "yellow" is the theme's gold token (the orange-brown warning token is too close to red); an empty task list is grey, not green; thresholds are fixed and explained by one legend line, not settings.

- **Phase 6 spec: confirmed 2026-11-15** (section 6, "Phase 6 spec"). The owner took all four recommendations: renewal deals appear **120 days** before a paid group license ends; an **Expansion** deal is made as well when **90% or more of the seats are registered**; first-touch source travels in a **first-party cookie like the affiliate link** (one privacy-policy bullet to approve); the panel shows student counts with **"fewer than 10"** below 10. Value on a renewal deal starts as last term's amount (stated in the spec; the owner may veto at review). Deferred list unchanged.
- **Phase 6: built 2026-11-15, staged, not committed or deployed** (the engagement card on deals and accounts, `scripts/crm-renewals.js` and `lib/crm-growth.js`, "How they found us" on contacts via the `fn_attr` cookie set by `referral.js`; one alter script, `alter-create-crm-growth.js`). **Verified:** 43 new tests (suite 1,211 pass, 0 fail); the alter script's first run and second run on a real MariaDB (13 changes, then 0); the generator on a real MariaDB (report, apply, apply again: two deals, then none; off until `crm_renewal_generator` is true); a real cookie set by `referral.js` in the browser, read by the real newsletter route, shown on the contact page (first touch kept, latest replaced); the card on a deal and an account in the browser; all three CRM roles and a signed-out request by curl. **Not verified:** the Stripe-side and site-auth/checkout form paths over HTTP (tests only check those routes call the recorder; the newsletter and quote-request routes were run), phone width, a real production dry run (production has 0 qualifying purchases, so it will report zero deals), and the privacy-policy bullet needs the owner's and lawyer's approval. **Not covered by design:** card checkout attribution (Stripe webhook has no cookie).

- **Review follow-up, 2026-11-15:** a full PRD-versus-build review is in `docs/reference/sales-crm-punch-list.md` (numbered S, G, B, V items). S1-S5 are fixed and tested: admin-account routes need CRM Admin and a new admin starts Read-only; accept-for-customer is CRM Admin only on the concierge route too; quote edit and send honour the role, a sent quote's price is CRM Admin only and every price change is audited, an accepted quote cannot be re-priced; the accept link (`accept_token`) is never returned to the browser (`has_accept_link` instead); a re-priced quote replaces its open card purchase instead of reusing the old amount. New action `edit_quote_price`; older routes use `requireCrmRole`, which works with the Hub off.
- **Phase 7: built 2026-11-15, not yet deployed** (spec and the owner's two answers in section 6, "Phase 7 spec"). **Reports:** Customer Hub > Reports (`admin-crm-reports.html`, `routes/crm-reports.js`, `lib/crm-reports.js`): funnel and stage conversion, weighted pipeline, win and loss, time in stage, source to paid, and reconciliation, each with its definition and dates on the page; CSV export for a CRM Admin only, summary numbers only, one audit row per export. **Hardening:** a test that fails on any CRM route not declared with `requireAuth` then `requireCrm` (84 routes reviewed, none missing) and that every signed-out request is 401 with the Hub on or off; a rollback drill (Hub off: all 84 routes 404, nothing written or deleted, older admin routes and hooks as before; back on: same data); a performance pass on a throwaway MariaDB at about ten times today's data (everything under 120 ms except Quotes without a deal at about 350 ms, written up with its next step in the runbook, so **no index script was needed**); and `docs/reference/crm-operations-runbook.md` (the switch, every cron job and its log, database scripts, per-phase rollback, known limits). **No database change.** `admin-nav.js` v35 and `admin-shell.js` v8 on every admin page. **Verified:** 17 new tests (suite 1,228 pass); the page loaded in headless Chromium at desktop and phone width with no console errors and the Download buttons present; the six reports against 10x data. **Not verified:** the exports opened in a real spreadsheet, and the reports against real production data (it has no qualifying purchase yet, so most read zero). **Left in the plan:** phase 5b to 5d (email) only; the D9 deferred list stays deferred.

### Preflight output (run on production, 2026-11-14)

```text
1. Size
    4540  newsletter_contacts
       6  quote_requests
      21  purchases
       3  invoices
       4  admin_users
      30  schools
      20  districts
       2  support_requests
       3  public_demo_invitations

1b. Test and internal rows (the 2026-09-05 go-live reset cleared purchases and quotes, but contacts were kept)
      27  contacts with an @example.com address (QA and demo)  (the backfill should skip these)
       0  quotes from an @example.com address
      15  purchases owned by an @example.com contact

2. Contacts: duplicate and untidy emails
       0  contacts whose email differs only by case or spaces from another contact (extra rows)  (the unique index already stops exact duplicates; this is the normalized check)
       0  emails with leading or trailing spaces
     110  emails not already lowercase
  subscription status (must be untouched by the CRM): Subscribed = 4481, Unsubscribed = 59
       5  contacts with a purchase but in no group

3. Quotes
  status: converted = 5, contacted = 1
  origin: admin = 6
       5  quotes with a send date
       5  quotes accepted
       0  quotes with no quote number (inbound, never priced)
       4  quotes that match exactly one contact by normalized email
       2  quotes that match NO contact  (these go to the exceptions report)
       0  quotes that match MORE THAN ONE contact  (ambiguous: reviewed, never auto-linked)
       0  quotes from a group demo

4. purchases.quote_id (before any foreign key)
       3  purchases that carry a quote_id
       0  of those, quote_id points at no quote (orphans)  (must be 0, or fixed, before a foreign key)
       0  quotes that have more than one purchase  (card clicks make extra pending purchases; no unique key)
       0  quotes whose purchases are all still pending and number more than one

5. Purchases against the draft Customer rule (D3)
  payment_status: paid = 18, pending = 3
  payment_method: manual = 15, po = 4, stripe = 2
  product_type: group_license = 20, single_license = 1
       0  QUALIFYING (paid, amount > 0, not a trial)
      15  paid with a NULL amount (manual entries)  (review list: you confirm each before it counts)
       1  paid with a zero amount, not a trial  (never a Customer on its own)
       3  trial-like purchases (any of: trial product, lesson limit, trial end date)
       2  trial-like purchases marked paid  (the column default is paid; these must not become Customers)
       0  trial-like purchases marked paid WITH an amount > 0  (a paid trial: look at these by hand)
       1  trial purchases with a trial product but no lesson limit and no end date  (the trial-detection gap found in the code)
       3  pending purchases
       0  purchases tied to an invoice that is paid while the purchase is not  (payment drift)
       0  purchases tied to an invoice that is unpaid or cancelled while the purchase is paid  (payment drift the other way)
  invoice status: unpaid = 2, paid = 1
       0  invoices with no purchase attached

6. Account links for qualifying purchases (D4)
       0  qualifying purchases with a school_id
       0  qualifying purchases with NO school_id  (the organization stays "unresolved, needs review")
       0  ...of those, a school_domain that matches a school (explicit collation)  (schools and districts are latin1, everything else utf8mb4)
      11  schools with no district

7. Projected classification (a first look, not the final backfill)
       0  contacts that would be CUSTOMER (a qualifying purchase of their own)
       4  contacts that would be PROSPECT (a quote request, no qualifying purchase)
    4536  contacts that would stay SUSPECT
       7  contacts with only trial, zero-amount, NULL-amount or pending purchases (not Customer; check by hand)

8. Staff and owners
       4  admin accounts  (all become CRM Admin in Phase 1)
       1  admin accounts without an email
       1  site users flagged FNE staff (Community only; grants no CRM access)
       2  support tickets with an assigned admin

9. Demo hand-off
  demo invitation status: ended = 2, active = 1
       0  tickets from a group demo
```

### What the preflight showed

Section 1b lists what it changes in the plan.

## 1b. What the 2026-11-14 preflight changed

1. **Customer starts at zero.** No purchase passes the D3 rule today. The 15 paid purchases with no amount are manual entries, and 15 purchases belong to `@example.com` contacts, which very likely means they are the same QA rows (the script did not prove that). The other six are one zero-amount paid purchase, two unpaid PO purchases and three trial-like ones. So on day one every contact is Suspect or Prospect, and Customer can only be proven by tests with made-up rows, and in production by one `@example.com` purchase created and removed (CLAUDE.md's curl practice). If real customers paid outside the platform before go-live, they need the "Set Customer with evidence" override that is already in the access matrix; no new workflow.
2. **Prospects: 4.** Six quotes, all `origin = admin` (none from the public form), five sent and accepted, one contacted. Four match one contact; **two match no contact**. The likely cause is the known gap (editing a contact's email does not update the quote), so these two go to the exceptions report and the owner links them by hand. The backfill makes 6 opportunities (D5): five Won (payment shown separately), one at Proposal / Quote Sent or Qualified by its send date.
3. **Open question on the five accepted quotes:** only 3 purchases carry a `quote_id`. Phase 1's dry run must list accepted quotes with no purchase pointing at them, so the owner can say whether a purchase is missing or the link was never set. Nothing is written until that is understood.
4. **Test rows are 27 contacts, 15 purchases, 0 quotes.** The backfill creates no accounts or opportunities from `@example.com` rows, and the Overview and reports leave them out through one shared helper (an address pattern, not a new column).
5. **110 stored emails are not lowercase.** All matching uses `LOWER(TRIM())`; stored emails are never rewritten (it would not change the unique index, and nothing needs it).
6. **No duplicate contacts and no orphan `quote_id`:** nothing to clean before the `purchases.quote_id` foreign key. Do not add a unique key (card clicks can still make several purchases per quote).
7. **Payment drift: none today** (no invoice and purchase disagree). **Trial-detection gap: 1 real row** (a trial product with no lesson limit and no end date); Phase 1's predicate treats a trial product as a trial regardless, and the row is listed for the owner. One paid, zero-amount, non-trial purchase is also listed (never a Customer on its own).
8. **Staff:** 4 admins, one with no email. A role assignment screen and any "assigned to me" email need an email, so Phase 1 shows that admin as "no email on file". One FNE-staff site user (Community only; no CRM access).
9. **Schools:** 11 of 30 have no district; account hierarchy is optional, so they become stand-alone accounts. Account-level Customer is unresolved for everyone (there are no qualifying purchases to resolve).
10. **Demo hand-off:** 3 invitations (2 ended, 1 active), no group tickets or quotes yet. D14 is cheap now and tests itself with the next real demo.

**Recommendation (not a change to D1-D14):** with 6 quotes and no paid sale on record, add a checkpoint after Phase 3. By then the owner will have used the pipeline, tasks and timeline for real deals; Phases 5 to 7 (email sync, reports, hardening) then get confirmed, trimmed or dropped based on what actually hurt. Phases 4a to 4d protect checkout and acceptance and stay in either way.

## 2. What the PRD assumes versus what the code does

| PRD assumption | What the code and schema show | Effect on the plan |
|---|---|---|
| Staff roles exist or can be reused (CRM Admin / Sales / Read-only) | `admin_users` has 4 rows (one without an email) and **no roles**. Every route is `requireAuth` only; any admin can invite, edit and hard-delete other admins. The JWT carries only `{userId, username}`. `site_users.is_fne_staff` is a Community flag, not a CRM role. The Oct 2026 "CRM Roles & Assignments" is a read-only card showing a contact's customer role, not staff ownership. (CLAUDE.md's "single admin account" and `middleware/siteAuth.js` are stale.) | Roles are new. Access matrix first (section 4). Owner columns are nullable FKs to `admin_users` with `ON DELETE SET NULL`, the existing pattern. Admin deletion needs a reassign step. |
| Contacts have no owner, stage or CRM fields | Correct. `status` is just Subscribed / Unsubscribed; `source` is free text with about 14 writers. | Additive columns only, as the PRD says. Subscription code untouched. |
| `quote_requests` has no `contact_id`; `purchases.quote_id` has no FK | Confirmed. The link is the email string only. Editing a contact's email does not update the quote, and `createPurchaseFromQuote` then creates a duplicate contact. Several purchases can share one `quote_id` (every card click creates a new pending purchase). | Backfill by normalized email; record ambiguity; **do not make `quote_id` unique**. FK only after an orphan check. |
| Won hands off to invoice, purchase and license "exactly once" | Purchases and seats come from one function (`createPurchase`, `routes/newsletter.js:608`) with **no idempotency**. The PO quote path claims the quote with `UPDATE ... WHERE accepted_at IS NULL` but outside a transaction with the purchase and invoice creation, so a mid-way failure leaves a converted quote with a dead token. The card webhook updates without `AND accepted_at IS NULL`. "Latest purchase for this quote" lookups use `ORDER BY id DESC` and can pick an abandoned duplicate. | Phase 4 starts with a hardening step in billing code. Needs its own confirmation under CLAUDE.md's access-control rule before anyone codes it. The CRM never writes purchases or invoices itself: it calls the existing functions. |
| An invoice marks a paid sale | **Card-paid quotes and Stripe cart orders create no invoice.** Only PO paths create one. | "Paid" must come from `purchases`, not `invoices`. |
| A paid, non-trial purchase is easy to identify | `payment_status` defaults to `paid` on the column and in `createPurchase`. Manual purchases are created `paid` with a **NULL amount**. Trial detection is inconsistent: `isTrial` in the serializer uses `trial_lesson_limit`, the expiry cron uses `trial_lesson_limit IS NOT NULL`, conversion uses `trial_expiration_date`, and a trial from a quote whose product has no limit gets neither. Nothing handles refunds or disputes; `payment_status` is never set back after a Stripe refund. Cancelling an invoice leaves payment status alone. | One shared SQL predicate for "qualifying paid purchase" (D3). Rows with a NULL amount go to a reconciliation list, not straight to Customer. Refund handling is "flag for review", as the PRD already says. |
| `schools` and `districts` use a different collation | Confirmed: those two tables are latin1; the other 115 are utf8mb4. Integer FKs are fine; string joins (`purchases.school_domain` to `schools.domain`) need an explicit `COLLATE`. | Link accounts by `school_id` / `district_id` (ints). Where only a domain exists, join with explicit collation and log ambiguity. |
| Audit table can be reused | `school_audit_log` is generic (`actor_type`, `entity_type`, `entity_id`, JSON before/after) but has `purchase_id` and `school_domain` columns that mean nothing for CRM events, and the school views filter by `entity_type` (as they already do for affiliates). Actor spellings are inconsistent (`admin` vs `admin_user`). | Reuse it with `crm_`-prefixed entity types and one actor spelling; add those types to the school-view exclusion list (D6). |
| Hosting.com IMAP/SMTP, background sync | Outbound is one nodemailer transport in `lib/mailer.js` (and a test fails if any other file creates one). **No IMAP library and no mail parser are installed.** No in-process scheduler and no pm2: everything long-running is a cron script. | Phase 5 begins with a feasibility spike. Sending stays in `mailer.js`. |
| AI triage and drafts | No LLM is called anywhere today. The only AI is OpenAI's free moderation endpoint, off by default. | Provider, privacy terms and retention are the owner's call; no code until chosen (D8). |
| Opportunity/stage and quote status separate | Yes. `quote_requests.status` is `new / contacted / converted / closed`; "expired" is computed, never stored; `converted` does not mean paid (a PO quote is converted while its invoice is unpaid). | Matches the PRD. Do not touch the enum. |
| Existing contact screen can host the new views | `admin-newsletter.html` (1,410 lines) loads **all** contacts at once with no pagination and filters in the browser. | New screens need server-side pagination. The old page stays and gains a classification column and filter. |
| No Hot/Warm/Cold today | Confirmed: nothing in routes, lib or the contact/quote/dashboard pages uses it. | Nothing to remove. Add a test that fails if those labels appear in CRM code. |

## 3. Reuse, modify, new

**Reuse unchanged:** `newsletter_contacts` (identity, subscription), `quote_requests` and the public accept flow, `quote_content_profiles`, `purchases`, `license_products`, `license_seats`, `invoices` and their numbering, `schools`, `districts`, the school and district admin tables, `public_demo_*` (invitation id is already on tickets and quotes), `program_use_snapshots`, `license_utilization_alerts`, `campaigns` and `email_automations` (via `fireAutomation`), `support_requests` and its messages, affiliates and commissions, `lib/mailer.js`, `lib/audit.js`, `settings`, the cron script pattern, and the node:sqlite test pattern (`server/test/crm-contact-email-duplicate.test.js` is the template).

**Modify (additive, nullable, reversible):**
- `newsletter_contacts`: `crm_classification` (default `suspect`), `assigned_admin_id`, `last_contacted_at`, `crm_source`, `classification_updated_at`.
- `quote_requests`: `contact_id`, `opportunity_id`, `created_by_admin_id`, `revision_number`, `supersedes_quote_id`, `version_status`, acceptance-evidence columns.
- `admin_users`: `crm_role`.
- `purchases`: FK and index on `quote_id`, only after the orphan check.
- `school_audit_log` consumers: exclude `crm_*` entity types from the school and district views.
- `admin-nav.js` / `admin-shell.js`: one CRM group, behind a flag, hidden by role.
- `admin-newsletter.html`: classification column and filter; Suspect / Prospect / Customer replaces nothing that exists.
- Billing code (Phase 4 only, with its own sign-off): transactional PO claim, guarded webhook update, stored Stripe session on the purchase, `quote_id`-based lookups.

**New tables (logical; names follow the PRD):** Phase 1: `crm_accounts`, `crm_account_contacts`, `crm_opportunities`, `crm_opportunity_contacts`, `crm_pipeline_stages`, `crm_opportunity_stage_history`, `crm_loss_reasons`, `crm_classification_events`. Phase 3: `crm_tasks`, `crm_notes`, `crm_attachments`, `crm_appointments`, `crm_procurement_templates`, `crm_opportunity_checklist_items`. Phase 4: `crm_quote_events`, optionally `crm_quote_line_items`. Phase 5: `crm_mailboxes`, `crm_mailbox_grants`, `crm_mailbox_sync_state`, `crm_email_threads`, `crm_email_messages`, `crm_ai_triage_and_drafts` (only if D8 is yes). Phase 6: `crm_reviews`, custom fields and tags (only if D9 keeps them). Each is created by a new idempotent `server/scripts/alter-create-crm-*.js` (check `information_schema` first, as the existing alter scripts do), and added to `schema.sql` and `SCHEMA.md`. All use utf8mb4 and unsigned int keys to match `newsletter_contacts` and `admin_users`.

**New code:** `lib/crm-classification.js` (the one predicate and the reconcile function), `lib/crm-permissions.js` (role checks used by every `/api/crm/*` route), `lib/crm-audit.js` (thin wrapper over `audit`), `routes/crm-*.js`, `crm-*.html` pages with `crm-common.js`, backfill and report scripts (dry run by default, `--apply`), and one new cron script per background job.

## 4. Access matrix (draft, confirm before Phase 1 code)

Today every admin can do everything. Rule for the update: **existing admins become `crm_role = admin` in the migration, so nothing changes for anyone until the owner assigns a lighter role.** The role gates only the new `/api/crm/*` routes and CRM screens; old routes stay as they are until a separately approved change. Site users never get CRM access, and `is_fne_staff` grants nothing here.

| Action | CRM Admin | CRM Sales | CRM Read-only |
|---|:-:|:-:|:-:|
| View accounts, contacts, opportunities, quotes, timelines | all | all (D1 option: own and unassigned only) | all |
| Create / edit accounts, contacts, opportunities, notes, tasks | yes | yes | no |
| Move stage, close won / lost | yes | own deals | no |
| Reopen a closed deal | yes | no | no |
| Promote Suspect to Prospect (with reason) | yes | yes | no |
| Set or override Customer | yes (evidence + reason) | no | no |
| Override a qualification score or probability on a deal | yes | no | no |
| Edit global stages, probabilities, rules, templates | yes | no | no |
| Merge or archive accounts and contacts | yes | no | no |
| Send quote, create draft quote | yes | yes | no |
| Change pricing on a sent quote | yes | no | no |
| Mark invoice paid, record PO received | existing rules (any admin today) | not via CRM | no |
| Mailbox: connect, grant access | yes | no | no |
| Mailbox: read and reply | granted mailboxes only | granted mailboxes only | no |
| Attachments and e-signature evidence | yes | on deals they can edit | no |
| Export | yes, audited | no | no |
| Audit viewer, assign roles | yes | no | no |
| Delete a contact | existing route (refuses if purchases or invoices) | no | no |

Server-side check on every route and every job. A deleted admin's records go to "unassigned" (`SET NULL`) and show in Needs Attention.

## 5. Decisions for the owner (each with a recommendation)

- **D1. Staff roles.** Add `admin_users.crm_role` (`admin` / `sales` / `readonly`), the 4 existing admins default to `admin`. Do Sales see only their own and unassigned records, or everything? *Recommend: everything is visible, only the owner can edit (smallest team, simplest rule).*
- **D2. Classification storage.** Store `crm_classification` on the contact, derive it from facts through one function, log every change in `crm_classification_events`. Suspect is the default; Prospect needs a recorded event; Customer is derived, never typed. *Recommend yes.*
- **D3. What counts as a qualifying paid purchase.** `payment_status = 'paid'`, `amount_cents > 0`, the product is not a trial (`license_products.is_trial = 0` and no `trial_lesson_limit` / `trial_expiration_date` on the purchase), and the purchase is not converted-from-trial credit only. Purchases with a NULL amount (manual entries) go to a review list for the owner to confirm one by one. *Recommend yes; the owner reviews the NULL-amount list once.*
- **D4. Account-level Customer.** A school or district is a Customer only when a qualifying purchase has a resolved `school_id` (the `backfill-purchases-school-id.js` script exists for older rows); otherwise "unresolved, needs review". *Recommend yes.*
- **D5. Opportunity backfill.** One opportunity per existing quote (36 rows), no others. Stage only from evidence: `new` becomes New Inquiry; a quote with `quote_sent_at` becomes Proposal / Quote Sent; `contacted` with no send date becomes Qualified; `converted` becomes state Won (payment shown separately); `closed` becomes state Inactive with reason "closed before CRM" until the owner says won or lost. Values come from the quote amount; expected close stays blank. *Recommend yes; the owner reviews the closed ones.*
- **D6. Audit.** Reuse `school_audit_log` with `crm_` entity types and `admin_user` as the actor type. *Recommend yes; the alternative, a new `crm_audit_log`, is cleaner but duplicates the writer.*
- **D7. Email (Phase 5).** Run a feasibility spike first: confirm IMAP host, port and TLS from `.env` and the host, that a cron-run Node script can hold an IMAP session (imapflow and mailparser are the usual libraries; neither is installed), and message volume. Secrets encrypted with a key held only in `server/.env`, never in git. Replies go out through `mailer.js` with a per-mailbox transport; the "no other transport" test is extended, not removed. *Recommend: spike first, decide after; start with one mailbox, read-only sync.*
- **D8. AI features.** No LLM exists in the stack. Choose the provider, the contract and the retention policy, or defer all of FR-AI. Drafts are always human-sent, student data never enters a prompt. *Recommend defer AI until email sync has run stably for a month.*
- **D9. Scope of Phase 6.** Keep: trial and demo engagement panel, renewal and expansion opportunity generator, and attribution fields on contacts. Defer until there is demand: custom-field engine, tags, reviews and testimonials, line-item quotes, a scored qualification model, customer-health score. *Recommend defer the second list.*
- **D10. Feature flag.** A `settings` key (`crm_v2_enabled`, read with `getSetting`), because `lib/feature-flags.js` is per-school and does not fit. Off hides the nav group and every CRM page and route returns 404. Data stays. *Recommend yes.*
- **D11. Billing hardening (Phase 4a).** Confirm the four fixes in section 7 before they are coded. They change checkout and acceptance behavior, so they need their own matrix and test list.
- **D12. Legal wording on acceptance.** Typed name, title, timestamp, terms version and a document hash are stored as evidence, and the page does not say "legally binding" until a lawyer reviews it (as with the existing legal drafts). *Recommend yes.*
- **D13. Admin deletion.** Change `DELETE /admins/:id` to ask who inherits the deleted admin's contacts, deals and tasks. *Recommend yes, in Phase 1.*
- **D14. Demo as a pipeline event.** A demo invitation (and the tickets and quotes tagged with its id) shows on the account timeline as a "Demo" event. The group's name stays staff-only. *Recommend yes, Phase 3.*

## 6. Phases

Each phase ships as its own release, dark behind `crm_v2_enabled` until the owner turns it on. "Tests" are `node:sqlite` route tests in `server/test/` unless noted; production checks use `curl` with a cookie jar and `@example.com` data.

### Phase 0. Reconcile and baseline (no feature code)
- **Do:** write this document's decisions into a confirmed state. Write a **read-only** preflight script, `server/scripts/report-crm-preflight.js`, that the owner runs on cPanel and that prints counts only (no names or emails in the output): duplicate contacts by lowercased and trimmed email; quotes matching exactly one, none or several contacts; `purchases.quote_id` values with no quote; purchases that are `paid` with a NULL or zero amount; trial-like purchases marked paid; purchases with no `school_id`; contacts with a purchase but no group; quote status counts. Run `cd server && npm test` and record the baseline (the backlog says about 1,015 passing). Correct the stale CLAUDE.md lines (admin accounts, `siteAuth.js` location).
- **Gate:** owner has answered D1 to D14 and has the preflight numbers. Nothing in production changed.
- **Acceptance:** preflight output saved in the requirements doc; test baseline recorded.

### Phase 1. Sales data foundation
- **Migrations:** `alter-create-crm-core.js` (the eight Phase 1 tables, stable unique `stage_key`, indexes the PRD lists), `alter-add-crm-columns.js` (contact, quote and admin columns, all nullable or defaulted, no FKs that can fail on legacy data until step 2), seed script for stages and loss reasons. Each reruns as a no-op.
- **Backfill scripts** (dry run by default, `--apply` to write, counts logged, ambiguity written to an exceptions report): contact-to-quote by normalized email, one-to-one only; accounts from existing `schools` and `districts` and unambiguous quote `school` text; opportunities per D5; classification per D2 and D3; `crm_account_contacts` from `school_license_admins` and purchase links. Existing `status` is never read for writing.
- **Code:** `lib/crm-classification.js` (predicate, reconcile, event writer), `lib/crm-permissions.js`, `routes/crm-accounts.js`, `crm-contacts.js`, `crm-opportunities.js`, `crm-settings.js`; hook into `createPurchase`, the invoice paid/unpaid route and the Stripe webhook **only to call reconcile after the existing work finishes** (read-only with respect to money; failures are logged and never block the payment path). Nightly reconcile cron as the safety net so a missed hook self-heals. Admin deletion reassign step (D13).
- **Scope set by the preflight (section 1b):** backfill skips `@example.com` rows; 6 opportunities; 2 unmatched quotes and any accepted quote with no purchase go to the exceptions report, nothing guessed; Customer is proven by synthetic tests, not production data.
- **Risks:** a hook in a payment route is the one regression danger (wrap in try/catch, after commit); backfill touching 4,790 contacts (dry run first, owner reads the counts); duplicate contacts created by the existing email-change gap (report them, do not auto-merge).
- **Tests:** classification table (trial, $0, NULL amount, paid, pending, refunded-by-hand, converted trial); one contact in two accounts; backfill idempotent on a second run; subscription `status` byte-identical before and after; role matrix for every new route (readonly cannot write, sales cannot override); no `hot|warm|cold` strings in CRM files; payment routes still return the same responses with the hook failing.
- **Acceptance (PRD section 22, domain/data items):** every contact reads Suspect, Prospect or Customer; trial and $0 never Customer; multiple accounts per contact; Customer persists after license expiry; quote acceptance alone does not create a Customer.

### Phase 2. Core CRM screens
- **New pages:** `crm-overview.html`, `crm-accounts.html` (list and 360), `crm-contacts.html` (server-paginated, filters by classification, owner, account, last contacted), `crm-opportunities.html` (table first, then Kanban with stage history, days in stage, next step with owner and due date, win and loss prompts). Saved filters as URL-stored queries. All pages use `fnEscape()` and `data-` attributes, and the admin-nav version bumps listed in CLAUDE.md.
- **Modify:** nav group (flagged and role-aware), classification column and filter in the old `admin-newsletter.html`, owner picker.
- **Reuse:** the quote, order and invoice pages are linked from the 360 views, not rebuilt.
- **Risks:** Kanban drag on touch devices (table view is the fallback); forecast double counting (sum one opportunity value only, never quote versions).
- **Tests:** stage move writes history and an audit row; next step required past Qualified unless overridden with a reason; probabilities editable by admin only; pagination and filter queries; keyboard operation of stage move; Playwright smoke on the local stack for the three main screens.
- **Acceptance:** a staff user creates a Suspect, qualifies it as Prospect with a reason, adds a buying committee, opens an opportunity and moves it through stages; Customer and Prospect counts on the Overview equal the SQL counts.

### Phase 3. Sales execution
- **New:** tasks (today and overdue queue), notes, attachments (stored under `UPLOADS_DIR` with `upload-safety.js` type checks, served only through an authenticated route), appointments with `.ics` through `mailer.js`, procurement checklists, the Needs Attention rules (each explainable, snoozable, with a link to the fix), and the account timeline as a query over existing tables (quotes, purchases, invoices, support tickets, demo invitation events, campaigns, notes, tasks). Daily cron script for overdue and stale rules, idempotent.
- **Phase 3 access matrix (written before the code, 2026-11-14).** Every new route is `requireAuth` plus `requireCrm(<action>)` and answers 404 while `crm_v2_enabled` is off. The role check is the first gate; the "subject" check is the second: a **subject** is the thing a task, note, file, meeting or checklist belongs to (a deal, an account or a contact). "Can write the subject" means: CRM Admin always; Sales on a deal they own or nobody owns yet (`canEditDeal`), and on any account or contact; Read-only never.

  | Action | CRM Admin | CRM Sales | CRM Read-only |
  |---|:-:|:-:|:-:|
  | See tasks, notes, meetings, checklists, the timeline and Needs Attention | all | all | all |
  | Create or edit a task, add or edit a meeting, add or tick a checklist item | any subject | subjects they can write | no |
  | Complete or reopen a task assigned to them | yes | yes, even on a deal that is not theirs | no |
  | Hand a task to another staff member | yes | yes, on subjects they can write | no |
  | Delete a task | any | tasks on subjects they can write | no |
  | Add a note | any subject | subjects they can write | no |
  | Edit or delete a note | any | only notes they wrote (and only on a subject they can still write) | no |
  | See the file list, download a file | any | files on deals they can edit, and on any account or contact | **no** (files can hold POs and contracts) |
  | Upload a file | any subject | deals they can edit, any account or contact | no |
  | Delete a file | any | files they uploaded, on a subject they can write | no |
  | Send, update or cancel a meeting invitation (`.ics`) | any subject | subjects they can write | no |
  | Apply a procurement checklist to a deal | any deal | deals they can edit | no |
  | Edit the procurement checklist templates | yes | no | no |
  | Snooze or dismiss a Needs Attention item | any | items on deals they can edit, and their own tasks | no |
  | Daily cron job | not a person: reads, records "first seen" events, and sends the optional owner digest only when the setting `crm_attention_email` is `true` (off by default) | | |

  Hard rules that go with it: a file is never at a public URL (stored under `UPLOADS_DIR/crm-private/` with a random name, blocked from `/uploads/` by Express and by `.htaccess`, and served only by `GET /api/crm/files/:id/download` after the checks above); a file's type comes from its bytes (`lib/upload-safety.js`), SVG and HTML are refused, the size cap is 15 MB; the original filename is metadata only, sanitised; a meeting can invite only CRM staff with an email on file and contacts who are on that deal (or the account or contact it belongs to), never a typed address; the timeline carries no student-level data (support requests show their reference, category and status, never the subject or the message), and shows a demo only as "Demo" with its dates, never the group's name; a quote is never called "viewed".
- **Risks:** timeline query cost (indexes on `(contact_id, created_at)` and `(account_id, state)`; page by 50); never claim a quote was viewed unless a server-side view event exists (none until Phase 4).
- **Tests:** attachment type from bytes, path traversal, per-role access; overdue rule fires once and not twice on a second cron run; snooze and dismiss persist; timeline never includes student-level data.
- **Acceptance:** every rule links to evidence; tasks cannot be orphaned; permissions enforced on files.

### Phase 4. Quotes and commercial conversion
- **4a. Billing hardening (own sign-off, D11, ships first and alone).** Make the PO claim, purchase and invoice one transaction; add `AND accepted_at IS NULL` to the webhook update; store the Stripe session id on the purchase; look purchases up by `quote_id` instead of "latest". Tests reproduce each failure first (mid-way failure, replayed webhook, double card click).
  **4a spec, drafted 2026-11-14 for the owner's sign-off (D11); no code until confirmed.** Read from `routes/quote-accept.js`, `routes/checkout.js` (webhook), `routes/newsletter.js` (`createPurchase`), `routes/admin-concierge.js` and `routes/invoices.js`. **No schema change:** `purchases.stripe_session_id` already exists. No alter script, no new column, no new setting; the Customer rule and the CRM are untouched.

  *What goes wrong today, and the fix for each:*

  | # | Today | Fix | Buyer sees |
  |---|---|---|---|
  | 1 | **PO accept is not all-or-nothing.** `acceptQuoteViaPO` claims the quote (`accepted_at`, status `converted`), *then* creates the purchase and seats (own transaction), *then* the invoice (another). A failure between steps leaves a converted quote with no invoice (or no purchase) and a token that now answers "already accepted", so the buyer cannot retry and staff must repair it by hand. | Claim, purchase, seats, invoice and the purchase-to-invoice link become **one transaction** (`createPurchase` gains an optional caller-supplied connection; its after-commit work, the account claim and the CRM hook, runs after the whole thing commits). Any failure rolls back everything, including the claim, so the token still works. Emails and the staff alert stay after the commit and stay best-effort. | On failure: "Something went wrong, nothing was submitted, please try again." Never a half-accepted quote. |
  | 2 | **Card webhook can run twice.** It reads `accepted_at`, then updates without `AND accepted_at IS NULL`. Two near-simultaneous deliveries (Stripe retries) both pass the read and both send the set-up email, the sales alert and the automation. | The update becomes `... WHERE id = ? AND accepted_at IS NULL`; only the delivery whose `affectedRows` is 1 continues. The purchase is flipped to paid in the same step. A replay returns `received: true` and does nothing. | Nothing changes. |
  | 3 | **Money arrives for a quote that is already accepted** (PO chosen in one tab, a card checkout opened earlier in another; or a late webhook). Today the webhook silently skips it: the card was charged, no purchase flips, nobody is told. | Skip the work as today, but write a `payment_on_accepted_quote` audit row and send the sales alert ("a card payment of $X arrived for quote Q, which was already accepted by PO; review and refund in Stripe if it is a duplicate"). **Staff refund by hand in Stripe; the code never refunds.** | Nothing. |
  | 4 | **Every card click makes a new pending purchase with seats**, and nothing ties the Stripe session to it. Abandoned clicks pile up as pending purchases that show on the Purchases page. | `POST /accept` for card first looks for this quote's open card purchase (`quote_id`, `payment_method = 'card'`, `payment_status = 'pending'`, nothing paid) and **reuses it**; otherwise it makes one. After Stripe creates the session, the session id is saved on that purchase (`stripe_session_id`). The webhook finds its purchase by session id first, then falls back to `metadata.purchaseId` (covers sessions opened before this release). | Nothing. |
  | 5 | **"Latest purchase for this quote" can be the wrong one.** `ORDER BY id DESC LIMIT 1` is used by the admin-invite step of `/accept/invite` (`quote-accept.js:356`) and the concierge page (`admin-concierge.js:66`), so an abandoned later card click hides the paid purchase and the invite attaches the new admin to the wrong purchase. (`invoices.js` takes the first purchase that has a `quote_id`; it is safe because they all share one quote.) | One helper, `lib/quote-purchase.js` `purchaseForQuote(quoteId)`: paid first, then one that has an invoice, then newest. Both call sites use it. A test greps the code so the old pattern cannot come back. | Nothing. |
  | 6 | Card quote webhook trusts the amount. | The webhook compares `session.amount_total` with `quoted_amount_cents`; a mismatch **does not block** (the money is real) but writes an audit row and the staff alert says so. | Nothing. |

  *Access matrix for 4a.* Nothing about who may do what changes; it makes the same actions safe to repeat.

  | Action | Who | Rule after 4a |
  |---|---|---|
  | Accept by PO (public page) | anyone holding a valid, unexpired, unaccepted token | all-or-nothing; a second click or a retry after a failure never creates a second purchase or invoice |
  | Accept by PO for a customer (concierge) | any admin (`requireAuth`, as today) | same function, same guarantee; audit row as today |
  | Start card payment (public page) | anyone holding a valid token | at most one open card purchase per quote; a second click returns a new Stripe session for the same purchase |
  | Card webhook | Stripe only (signature check, unchanged) | each quote is accepted once however many times Stripe delivers; extra money is reported, never silently dropped |
  | Mark PO received, mark invoice paid | existing rules, unchanged | not touched in 4a |

  *Tests (written first, each reproduces the failure on the current code, then passes):* a PO accept where the invoice insert throws leaves `accepted_at` NULL, no purchase, no seats, and the token still accepts on the retry; two concurrent PO accepts make exactly one purchase and one invoice; the card webhook replayed twice (and run concurrently) sends one set of emails and flips one purchase; a card webhook on a quote already accepted by PO flips nothing and raises the alert and audit row; three card clicks leave one pending purchase and the webhook flips that one; a webhook for a session opened before this release (no stored session id) still finds its purchase through `metadata.purchaseId`; a $0 quote still accepts and activates immediately; a legacy quote with no `contact_id` still accepts by card and by PO; the invite step picks the paid purchase when an abandoned later one exists; the existing 1,112-test suite stays green; plus the Stripe test-mode e2e (cart, quote card, quote PO) on the local stack before it is deployed.

  *Out of scope for 4a, on purpose:* the `quote_id` foreign key, quote versions, `crm_quote_events`, acceptance evidence, "viewed" events and the Won handoff (4b to 4d); the refund and dispute handling the plan lists as "flag for review"; the cart checkout and trial-conversion webhook paths (they already guard by `stripe_session_id`).

  *Rollback:* it is code only. Revert the commit and restart the Node app; no data to undo.

  **4b to 4d spec, written 2026-11-14 (owner answers: contact-only link on the public form; buyer types name, title optional; only CRM Admin accepts for a customer; a customer's own acceptance moves the deal to Won).** Built together and committed together at the owner's request.

  *Schema (one idempotent script, `scripts/alter-create-crm-quotes.js`, run BEFORE the restart):* `quote_requests` gains `revision_number` (default 1), `supersedes_quote_id` (self link, SET NULL), `version_status` (`current` / `superseded`, default `current`), `created_by_admin_id`, and the acceptance evidence `acceptance_name`, `acceptance_title`, `acceptance_terms_version`, `acceptance_document_hash`, `acceptance_recorded_at`, `acceptance_recorded_by` (`buyer` / `staff`). New table `crm_quote_events` (`created`, `sent`, `superseded`, `accepted`, `page_opened`). `purchases.quote_id` gets an index and a foreign key to `quote_requests(id)` **ON DELETE SET NULL** (never cascade), added only if the orphan check finds none; otherwise the script lists the ids, skips the key and says so. A quote's "expired" is computed, never stored, so there is no expired event.

  *4b rules.* (1) A quote's `contact_id` is set when it is created by the public form (exactly one contact with that email, else left empty), by staff, and by copy; an admin-made quote may also name a deal (`opportunityId`), which needs a CRM role that can edit that deal. The public form never creates an account or a deal. (2) **Revise** = a new quote (new number, `revision_number + 1`, `supersedes_quote_id` set, same deal and contact, same pricing as a starting point). Only a **sent, unaccepted, current** quote can be revised, and only one open revision at a time. The old link keeps working **until the revision is sent**; sending it marks the old one `superseded`, and sending is refused if the old one was accepted meanwhile. A superseded link shows a clear "replaced by a newer quote" page and cannot be accepted. If a card checkout opened on a superseded quote is paid anyway, the money is real: the quote is accepted, and staff get an alert and an audit row saying so. (3) **Events:** written by `lib/crm-quote-events.js` through `lib/crm-hooks.js` (never throws, off while the Hub is off). "Viewed" is recorded only when the public accept page asks the server for a valid, open quote, at most once an hour per quote, with no IP, no agent and no token, and is labeled **approximate** everywhere (an email scanner that runs scripts could trigger it). (4) **Acceptance evidence (D12):** the accept page asks for the signer's full name (required) and title (optional) for both PO and card. The server stores them with the time, the terms version (setting `quote_terms_version`, default `1`) and a SHA-256 of exactly what the buyer was shown (quote number and revision, product, seats, term, amount, valid-until, school domain, the four content-profile sections, terms version). PO: saved in the same statement that claims the quote. Card: saved when the buyer presses the button, before Stripe. No IP address is stored. When staff accept for a customer the record says `staff`. The page never says "legally binding" (lawyer review pending, as with the legal drafts). (5) Forecast: a deal's value is the deal's own amount; quotes, revisions and purchases are never summed, so two revisions of one quote count once. (6) Superseded quotes drop out of the Needs Attention "quote about to run out" rule and the dashboard's expiring count.

  *4c rules (Won handoff).* The CRM never inserts a purchase, invoice or license. (1) **Customer accepts or pays on their own** (PO, or the card webhook): after the acceptance commits, the quote's open deal is closed Won by the system (history: "Quote accepted by the customer"), once, never throwing. (2) **Staff close a deal Won** from the deal page. If a linked quote is already accepted, the deal just closes. If a current, sent, unaccepted quote is linked, a **CRM Admin** may tick "Also accept this quote for the customer by purchase order", with the PO number (required above $0) and the signer's name; the handoff then calls the existing `acceptQuoteViaPO` (same purchase, seats, invoice and emails as a customer's own PO acceptance) and then closes the deal. Sales and Read-only cannot. (3) **Repeating the call returns the first result**: the quote is claimed once; a second request finds it accepted, creates nothing, closes the deal if it is still open, and returns the same purchase and invoice. (4) A deal closed Won with no accepted quote is still allowed (a phone deal handled elsewhere), exactly as today. (5) Payment state is shown next to the deal state, never inferred from it; accepting a quote never makes a contact a Customer (that stays `lib/crm-classification.js`, paid purchase only).

  *4d rules (procurement view).* The deal page gets a Procurement card from the deal's quotes' purchases: PO number on file, **PO promised and not received** (PO method, number on file, `invoices.po_received_date` empty), **invoice unpaid**, **license pending**, each with a link to the invoice or order, plus the quote events including the approximate "page opened". Pure display; it changes nothing.

  *Access matrix (new or changed actions).*

  | Action | CRM Admin | CRM Sales | CRM Read-only |
  |---|:-:|:-:|:-:|
  | See quotes, revisions, events, procurement | yes | yes | yes |
  | Make a quote for a deal; revise a quote (existing admin quote routes) | yes | on deals they can edit | no (superseded 2026-11-15, punch list S3: Read-only is refused on every quote write; re-pricing a sent quote is CRM Admin only; an accepted quote cannot be re-priced) |
  | Accept a quote for a customer when closing Won | **yes** | **no** | no |
  | Close Won without accepting, move stage, reopen | as in phase 2 | as in phase 2 | no |
  | Anyone with the link: view, accept by PO or card | token holder, signer name required | | |

  *Tests (written to fail first where they touch existing behavior):* alter script twice (no change the second time) and the orphan-check skip; public form links one matching contact and never a deal, never fails if the columns are missing; admin create with `opportunityId` (role gate), copy keeps buyer and deal only when the email is unchanged; revise rules (only sent and unaccepted, one open revision, new number); send of a revision supersedes the old one and the old link is refused with the "superseded" answer, accepted-meanwhile refuses the send; paid-on-superseded raises the alert; evidence required by both accept paths, hash changes when the price changes, stored in the same step as the claim, `staff` when concierge; viewed event once an hour and carries no token or address; auto-Won once for PO and card, not for a lost or inactive deal, repeat does nothing; handoff: Admin only, creates exactly one purchase and one invoice, repeat returns the first result, accepted-elsewhere just closes, expired quote refused, quote of another deal refused; procurement flags; two revisions roll up to one forecast value; classification stays Prospect until the paid purchase; the superseded quote leaves Needs Attention; the old suite stays green.

- **4b. Quote integration.** Set `contact_id` and `opportunity_id` when a quote is created (public form, admin create, copy); `revision_number` and `supersedes_quote_id` for revisions; a superseded quote's token is refused with a clear page; `crm_quote_events` for issued, sent, accepted, declined, expired, superseded (a "viewed" event only from a logged server request to the accept page, labeled approximate; no tracking pixel). Acceptance evidence fields (D12). Add the `purchases.quote_id` FK after the orphan check, and an index.
- **4c. Won handoff.** Closing a deal Won calls the existing accept or purchase path; it never inserts purchases or invoices itself; it shows payment state next to deal state. A repeat of the same call returns the first result.
- **4d. Procurement view** on the opportunity: PO promised and not received, invoice unpaid, license pending.
- **Risks:** this is the highest-regression phase (public accept page, Stripe, PO, licensing). Keep the existing routes and responses; add behavior behind new columns; run the whole existing suite plus the e2e checkout flow in Stripe test mode.
- **Tests:** legacy quote with no `contact_id` still accepts by card and by PO; replay each webhook twice, one purchase; $0 quote path; stale-token page; two quote revisions roll up to one forecast value; classification stays Prospect until the paid webhook.
- **Acceptance:** PRD section 22 workflow items on quotes, acceptance and Won handoff.

### Phase 5. Email and AI
- **5a. Spike (one session, no schema):** the facts in D7, a test connection from cPanel with a read-only mailbox, UIDVALIDITY handling proof, and a go or no-go.
- **5b. Sync (read-only first):** `crm_mailboxes` (encrypted secret), grants, per-folder sync state keyed `(mailbox, folder, uidvalidity, uid)`, threads by `Message-ID` / `References` / `In-Reply-To` (not subject), contact binding by normalized address with a review queue for ambiguous matches, sanitized HTML, attachments stored like Phase 3. A cron script every few minutes with a lock so runs do not overlap; lag and failure counters shown to admins. Never log passwords or bodies.
- **5c. Reply and send** through `mailer.js` with a per-mailbox transport, a send-status record and a retry guard that cannot double-send; the Conversations screen and the drawer on account, contact and opportunity pages.
- **5d. AI (only if D8 says yes):** triage labels and up to three reply drafts, review required, sent only by a person, prompts stripped of personal and financial data, outputs access-controlled and expiring.
- **Risks:** shared-host limits on long cron runs; credential handling; prompt injection from email bodies; reply echo duplicates. Phase 5 is the only phase that may fail its spike and be reshaped (for example, a shared-inbox forwarding address instead of IMAP).
- **Tests:** same message in two mailboxes stays two rows; UIDVALIDITY reset resyncs without duplicates; two similar subjects never merge; a reader cannot open a mailbox they were not granted; send retry is idempotent; AI path cannot call send.
- **Acceptance:** PRD section 22 communications items.

### Phase 6. Education intelligence and growth (scope per D9)
- Trial and demo panel on the opportunity from `program_use_snapshots`, `purchases`, `license_seats` and `public_demo_*`, with source and window labeled and missing data shown as unknown, never zero. Renewal and expansion generator from expiring paid licenses with a unique key per source purchase so it cannot duplicate (`crm.purchase.renewal_due`). Attribution fields on contacts (first and latest source, UTM, landing page) filled by the existing public forms, with no joins on IP. Everything in the deferred list stays out until asked for.
- **Tests:** renewal generator run twice makes one opportunity; unknown versus zero; no student-level field in any payload.
- **Acceptance:** a customer can hold a renewal and an expansion at once and stays Customer.

**Phase 6 spec, written 2026-11-15 for the owner's confirmation. No code until confirmed.** Three features, nothing else. Not built, by design (D9): custom fields, tags, reviews and testimonials, line-item quotes, a scored qualification model, a customer-health score. Where this spec says "proposed", the owner's answer is in the status line at the top.

*Read this first: what production has today.* The 2026-11-14 preflight found **0 qualifying paid purchases** (15 are paid with no amount, entered by hand). So the renewal generator will find nothing on day one; its dry run will list how many expiring licenses it left out because the amount is unknown, which is the owner's cue to confirm those purchases on the existing review list. That is correct behavior, not a bug.

**Feature 1. Engagement panel ("Trial and demo engagement")**

*What it is.* One read-only card on the deal page and the account page, three labeled sections. Each section names its **source** and its **date window** on screen. A value the system does not have is `null` in the payload and **"Unknown" on screen, with the reason**; a real zero is a real zero. Nothing is added up across sources, and nothing is scored.

| Section | Source (tables) | Window shown | Unknown when |
|---|---|---|---|
| Licenses | `purchases`, `license_seats` (counts by status only) | as of today; start and end dates of each license | no purchase in scope; a purchase with seats bought but no seat rows; a trial with no end date |
| Program use | `program_use_snapshots` (written on the 1st of each month by `snapshot-program-use.js`) | the latest three saved months, each labeled with its month and the date it was saved | the school has no snapshot row; the account has no school or district link; the table is missing |
| Demo | `public_demo_invitations` (dates, status only), `public_demo_events` (counts), plus the quotes and support tickets tagged with the invitation | the invitation's own start and end dates | no invitation is tied to this deal or account (the section says so and shows nothing); events cannot be read |

*Scope (which rows are "this deal / this account").* Deal: purchases on the deal's quotes, plus purchases whose `school_id` is the account's school; the account's school (or, for a district account, its schools) for program use; demo invitations on the deal's quotes. Account: purchases of the account's school or district schools, and of its members; program use for those schools; demo invitations from quotes and tickets that belong to its deals and members (the same rule the timeline already uses, one shared helper). An account with no school and no district link shows program use as **Unknown: "no school is linked to this account"**, with a link to the account page to fix it.

*What is deliberately not on it.* Student and teacher names, ids or emails (seat counts only; `invited_email` is never selected); a student count under 10 (shown as "fewer than 10", proposed; the same small-group idea the district Program Use Report uses; a teacher count is shown because staff already see who bought); the group's name on a demo (staff-only label never selected); a login history, a time spent, a score or a quiz result (none is read). Demo events are **counts the site recorded**, so the wording is "None recorded", never "no visits".

*Payload:* `GET /api/crm/opportunities/:id/engagement` and `GET /api/crm/accounts/:id/engagement`, `requireAuth` plus `requireCrm('view')`, 404 while `crm_v2_enabled` is off. Every metric is `{ value, unknownReason }` with exactly one of the two set. A test lists the allowed keys so a student-level field cannot slip in.

**Feature 2. Renewal and expansion generator**

*What it does.* A daily cron script finds paid licenses that are about to end and makes one deal for each, so a renewal is never missed and never made twice.

*Which purchases count (the source rows):* `lib/crm-classification.js` `QUALIFYING_SQL` (paid, amount above zero, not a trial: the one Customer rule, reused, never re-written), `product_type = 'group_license'` (a single teacher's license has no school account to hang a deal on), `license_status` not `cancelled` or `suspended`, and `expiration_date` from **30 days ago** up to **today plus the lead time** (proposed 120 days; the 30-day look-back is so a missed cron run or a late renewal is still caught). A purchase paid with a NULL or zero amount is **never** a source; the dry run counts them as "left out: amount unknown" and lists nothing else about them. A purchase is **skipped, with the reason counted**, when: it already has its deal (the unique key); a **later** qualifying group license exists for the same school (same `school_id`, or the same `school_domain` when there is no id) with a later expiration, meaning it was already renewed; the school has **no live CRM account** (`crm_accounts.school_id`, not archived; the generator never makes an account, the backfill does); or the account already has an **open renewal deal, or one won within the last 90 days**, made by staff (so the generator never works against a person).

*What it writes (and only this).* One `crm_opportunities` row, its stage-history row, the buyer as the deal's primary contact and committee member, and one audit row (actor `system`, entity `crm_opportunity`). It **never** writes a purchase, invoice, license, seat, quote, contact label or any email. Deal fields:

| Field | Renewal deal | Expansion deal |
|---|---|---|
| Name | `Renewal: <account name>` | `Expansion: <account name>` |
| Type, stage, state | `renewal`, Qualified, open | `expansion`, Qualified, open |
| Owner | the account's owner, or nobody (it then shows in Needs Attention) | same |
| Value | the source purchase's amount, labeled as last term's amount in the deal's source field; staff replace it when they quote (proposed) | **blank** (a guess is worse than a blank) |
| Expected close | the license's expiration date | same |
| Next step | "Check in about renewing (license ends YYYY-MM-DD)", due in 7 days | "Talk about more seats (N of M in use)", due in 7 days |
| `renewal_of_purchase_id` | the source purchase | the source purchase |
| `generated_key` | `crm.purchase.renewal_due:<purchaseId>` | `crm.purchase.expansion_due:<purchaseId>` |

*Expansion trigger (proposed):* the same source purchase, in the same window, and **90% or more of its seats are registered** (`license_seats.status = 'registered'`, counts only). A customer can hold a renewal and an expansion at once; both leave the contact's label alone (the generator never reads or writes `crm_classification`).

*Never twice.* `crm_opportunities.generated_key` is a **unique** column (NULL for deals people make). The insert is guarded by the key, and a duplicate-key error from a second concurrent run is caught and counted as "already made". Closing or losing the deal keeps the key; only deleting the deal frees it.

*How it runs:* `scripts/crm-renewals.js`, **report only by default**; `--apply` writes; `--only-if-enabled` (what cron runs) does nothing unless `crm_v2_enabled = true` **and** the setting `crm_renewal_generator = true` (off until the owner has read a dry run on production, the same way `crm_attention_email` is off by default). The thresholds (120 days, 30-day look-back, 90% seats, 90-day won guard) are constants in `lib/crm-growth.js`, with no settings page. Output is counts only, no names or addresses. Cron: daily at 07:10, added to `setup-cron-jobs.sh`.

**Feature 3. Attribution on contacts**

*What is stored.* On `newsletter_contacts`, two touches, each five columns: `first_touch_source`, `_medium`, `_campaign`, `_landing`, `_at` and `latest_touch_source`, `_medium`, `_campaign`, `_landing`, `_at`. `source` is `utm_source`, else the **host** of an outside referring site, else `direct`; `medium` is `utm_medium`, else `referral` when there is an outside referrer, else `none`; `campaign` is `utm_campaign`; `landing` is the **path** of the first page of the visit (no query string, no fragment). **First touch is written once and never changed** (compare-and-set on `first_touch_at IS NULL`); latest touch is replaced by each newer form submission **that carries a touch**, and a submission with no touch changes nothing (a "direct" visit never erases a campaign). The existing `source` ("Homepage", "Quote Request") and `crm_source` columns are **not touched**: they say which form, these say which visit.

*How it travels (proposed).* The same pattern as the affiliate cookie: `referral.js` (already loaded on 117 public pages, none for students) also sets a first-party cookie `fn_attr` (30 days, `SameSite=Lax`, `Secure` on https, JSON with a `f` and an `l` touch) **only** on a page load that carries a `utm_*` parameter or an outside referrer. The server reads it off the form's own request; **no form changes, and the browser sends nothing extra in any form body**. A new `lib/attribution.js` parses it strictly (length caps; `utm` text limited to letters, digits and `_ . - + : /` and space; landing path limited to path characters; the referrer is already a host) and `recordAttribution()` writes the columns, never throwing and never blocking the form (a missing column is quiet, like the CRM hooks). **No IP address, user agent or device id is read or stored, and nothing is joined on either.**

*Which forms.* The ones where a visitor becomes a contact: the homepage newsletter signup (`routes/newsletter.js`), the public quote request (`routes/contact.js`; the second insert in that file is staff-made and is not attributed), site sign-up (`routes/site-auth.js`) and the purchase-order checkout (`routes/checkout.js`). **Card checkout is not covered:** its contact is made by the Stripe webhook, which has no cookie, and carrying the cookie through Stripe metadata means touching the payment path; a possible follow-up. An existing contact who submits again gets a new **latest** touch (and a first touch only if they never had one). Admin, import, affiliate, district-assignment and system inserts are never attributed. Contacts that exist today show "Not recorded": the system never guesses a first touch from `source`.

*Where it shows.* A read-only "How they found us" card on the contact page (first and latest touch, each with its date), through `esc()`. Contact merge keeps the **earlier** first touch of the two (a contact with none takes the other's) and the **newer** latest touch. No export, no filter, no report yet (phase 7 reads "source to paid"). Nobody can edit attribution by hand.

*Limits, said plainly.* The cookie is set by the visitor's browser, so anyone can forge it: attribution is **advisory**. It never decides access, a price, a classification, a commission or an affiliate credit (the affiliate system is separate and untouched). It misses visitors who block cookies, switch browsers, or sign up on a device other than the one they first visited on. Visitors whose browser still holds the old cached `referral.js` begin to be recorded once their copy refreshes. **The privacy policy needs one more bullet** under "Cookies and browser storage" (kept for 30 days, says where a visit came from, is used for FNE's own sales follow-up and is never shared); that is legal wording and goes in as a draft for the owner and lawyer to approve.

**Access matrix**

| Action | CRM Admin | CRM Sales | CRM Read-only |
|---|:-:|:-:|:-:|
| See the engagement panel (deal or account) | yes | yes | yes (counts only, no file or person detail) |
| See "How they found us" on a contact | yes | yes | yes |
| Edit attribution by hand | no | no | no |
| Work, edit, win or lose a generated deal | as any deal (phase 2 rules) | own or unowned deals | no |
| Run the renewal script, switch `crm_renewal_generator` | server operator only (cPanel Terminal), not a web action | | |
| A visitor's form submission records a touch | anyone on a public form (server-validated cookie, never a form field) | | |

**Schema (one idempotent script, `scripts/alter-create-crm-growth.js`, run BEFORE the restart; also in `db/schema.sql` and `SCHEMA.md`):** `crm_opportunities.generated_key VARCHAR(64) NULL` plus unique index `uq_crm_opp_generated_key`; ten attribution columns on `newsletter_contacts` plus `idx_contacts_first_touch_source`; no new table. Each step checks `information_schema` first, so a second run changes nothing. Rollback: switch the generator setting off, revert the code; the columns can stay.

**Risks and how each is handled**

1. *A generator that makes noise.* Off until the owner reads a dry run; unique key; skips staff-made renewals; never makes accounts; counts only in output.
2. *Student data in a payload.* Seat counts by status only, snapshot counts only, floor of 10 on students, a key-whitelist test on every payload.
3. *Zero shown for unknown.* Every metric carries `unknownReason`; the screen prints "Unknown" and the reason; tested for each source being absent.
4. *Privacy.* Cookie wording needs approval; no IP or user agent; nothing sent in a body; the cookie is advisory and untrusted.
5. *Stored script injection through UTM text.* Whitelist characters at write, `esc()` at read, a test with `<script>` in a UTM value.
6. *Counting twice.* The generator counts a renewal and an expansion as two deals on purpose; the forecast sums deals, never purchases, and neither touches the Customer rule.
7. *Deploying code before the columns.* The contact page and the form hooks tolerate a missing column; the generator refuses to run without its key column.

**Test list.** Real routes and real SQL (`node:sqlite`) from `test/helpers/crm-env.js`: engagement unknown versus zero for each of the three sources absent and present; student floor; payload key whitelist (no email, no label, no student field); the role matrix (Read-only can read, a 404 while the hub is off); demo section never carries the group's name; generator selects only qualifying group licenses (trial, NULL amount, $0, pending and single-teacher rows are left out, the amount-unknown ones counted), window edges, already-renewed skip, no-account skip, open staff renewal skip; run twice makes one deal (and two concurrent runs make one); renewal plus expansion both open and the contact still Customer; dry run writes nothing; `--only-if-enabled` honors both switches; attribution parse (hostile input, oversize, wrong shape, `<script>`), first touch written once, latest replaced only by a real touch, no touch changes nothing, each public form records it, a missing column never fails the form, nothing in `source` or `crm_source` changes, merge rule; a grep test that no attribution code reads an IP header; the old suite stays green. Then a Playwright check on the local stack (CRM Admin, Sales, Read-only) of both pages and the contact card.

**Acceptance.** A customer can hold a renewal and an expansion at once and stays Customer; running the generator twice changes nothing the second time; every number on the panel says where it came from and from when, and an unknown is never a zero; a contact's first touch survives a later campaign.

**Deploy shape.** Alter script (twice, second is a no-op) before the restart; restart; rsync the three admin pages, `crm-panels.js` and `referral.js` (plus the privacy page once the wording is approved); re-run `setup-cron-jobs.sh` for the new cron line; then, **after the owner has read a dry run on production**, set `crm_renewal_generator` to `true`.

### Phase 7. Reporting and hardening
- Funnel, stage conversion, weighted pipeline, win and loss, source to paid, time in stage, reconciliation to `purchases` and `invoices`; each metric shows its definition and date window. Access review of every new route, rollback drill (flag off, data intact), performance pass on the timeline and list queries, operations runbook for the cron jobs.
- **Tests:** report totals equal SQL over distinct opportunities and purchases (fan-out guard test with a contact in two accounts and a deal with three quote revisions); export is audited and admin-only.
- **Acceptance:** PRD section 22 workflow and reporting items.

  **Phase 7 spec, 2026-11-15 (owner's answers: all six reports; exports hold summary numbers only).** One page, **Customer Hub > Reports** (`admin-crm-reports.html`, `routes/crm-reports.js`, `lib/crm-reports.js`, mounted at `/api/crm/reports`). Every report states its definition and its date window on the page. The window defaults to the last 90 days and is picked from presets (30 days, 90 days, 365 days, this year, all time) or two dates. No new table and no new setting; test addresses (`@example.com`) are left out everywhere, as on the Overview.

  | Report | Counts | Window applies to | Definition |
  |---|---|---|---|
  | Funnel and stage conversion | deals | the day the deal was created | For each stage, how many of those deals **reached that stage or a later one** (from the stage history, so a deal that skipped a stage still counts), and the share that went on to the next stage. Beside it: how many of those deals are now won, lost, inactive and still open. |
  | Weighted pipeline | open deals | **none: it is as of now** (said on the page) | Gross is the sum of the deal values, weighted is each value times its probability (a CRM Admin's override, else the stage default), by stage and by owner. Deals with no value are counted separately, never as zero. |
  | Win and loss | deals closed | the day the deal was closed | Won, lost and inactive counts and values; **win rate = won / (won + lost)**, inactive left out and shown; average won value; average days from created to closed for won deals; lost deals by reason; by owner. |
  | Time in stage | stage visits | the day the deal left the stage | Average and median days deals spent in each stage, from the history; plus, for open deals today, the average days so far in the current stage. |
  | Source to paid | deals | the day the deal was created | Deals grouped by their **Source** field (whatever staff typed; blank is "Not recorded"): deals, won, and deals with a **qualifying paid purchase** (the one Customer rule in `lib/crm-classification.js`) with the money from those purchases. Not first-touch marketing attribution (that is the phase 6 contact card). |
  | Reconciliation | exceptions | **none: all time** | Plain checks that the CRM and the money tables agree, each with a count and the first 20 internal ids: accepted quotes with no purchase; won deals with no accepted quote; accepted quotes whose deal is still open; purchases from a quote that is on no deal; an invoice and its purchase disagreeing on paid; Customers with no paid purchase behind them and no staff override; and paid buyers who are not yet labeled Customer. Green when every count is zero; never a score. |

  *Rules.* Every figure is one row per distinct deal or per purchase: quotes, revisions, committee members and accounts are never joined into a total, so a contact in two accounts or a deal with three quote revisions counts once (a test builds exactly that and compares the report with plain SQL). Revenue comes only from qualifying purchases (never from a quote, a deal value or an invoice). Nothing here writes to any table except one audit row per export. No hot, warm or cold wording, no scores, and no colour as the only signal.

  *Access matrix.* See the numbers: CRM Admin, Sales and Read-only (same as the Overview, decision D1). **Export (CSV): CRM Admin only**, and every export writes an audit row (`crm_report_exported`, entity type `crm_report`, with the report key and window, no figures). An export holds **summary numbers only**: stage, source, owner, reason and month labels with counts, amounts and percentages. No contact, account or deal name, no email, no ids (the Source label is staff-typed text and is capped at 64 characters; a cell that starts with `=`, `+`, `-` or `@` is prefixed so a spreadsheet never runs it). Signed out is refused (401) and the whole page and API answer 404 while the Hub is off.

  *Hardening in the same release.* (1) **Access review:** a test walks every router under `/api/crm` and fails if any route lacks `requireAuth` before a `requireCrm(<action>)` gate, so a future route cannot be added unguarded. (2) **Rollback drill:** a test turns the Hub off and on around real data and proves every CRM route answers 404 while off, nothing is deleted, the older admin routes (quotes, contacts, invoices) and the money hooks behave as before, and everything returns when it is back on. (3) **Performance pass:** the list, timeline, overview and report queries are timed on the throwaway MariaDB with about ten times today's volume; an index script is added only if a query needs one. (4) **Runbook:** `docs/reference/crm-operations-runbook.md`: every cron job (what it does, how often, how to check it ran, how to run it by hand, what failing looks like), the on and off switch, and how to roll back each phase.

  *Tests.* Each report equals plain SQL over distinct deals and purchases (the fan-out guard); window edges (first and last day, an empty window); test addresses excluded; zero data returns zeros and nulls, never a crash or a divide by zero; export is CRM Admin only (Sales and Read-only refused, signed out 401), audited, free of names and ids, and safe against spreadsheet formulas; the access review; the rollback drill; the page's static rules (escaping, versions, vocabulary).

## 7. Cross-cutting risks

1. **Payment-path hooks** (Phase 1 reconcile, Phase 4 billing): always after commit, never able to fail a checkout; a nightly reconcile covers misses.
2. **Public repo:** no real contact data, prices in negotiation or credentials in code, tests or docs; QA uses `@example.com`.
3. **Cascade deletes:** new child tables choose `SET NULL` or `CASCADE` on purpose, and the contact-delete route also refuses a contact that has opportunities until they are reassigned.
4. **Admin and site-user ID spaces** never mix; every owner column points at `admin_users`.
5. **Cache-bust versions** for shared admin assets are bumped on every HTML reference.
6. **Migrations** run on cPanel with the nodevenv prefix, alter scripts before the restart; production is never touched by a script that has not had a dry run the owner has read.
7. **Parallel-session schema conflicts** (see memory): a new phase must not assume an undeployed earlier phase's columns.
8. **Demo hand-off:** CRM reads `demo_invitation_id` but never exposes a group's name outside staff screens.

## 8. Deploy shape (per phase, to be filled in each release)

Push from the Mac with `git push`; on cPanel, pull in `/home/fixernat/repositories/fixernation`, rsync the changed static files into `/home/fixernat/public_html`, `npm install` only if `server/package.json` changed (Phase 5 will), run the alter and backfill scripts (dry run, then `--apply`) with the nodevenv prefix before restarting the Node app, re-run `setup-cron-jobs.sh` when a phase adds a cron line, then check production with curl.

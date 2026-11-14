# Sales CRM update (Customer Hub): gap analysis and phased plan

Written 2026-11-14. **Nothing here is built and nothing is confirmed.** Source spec: `FNE_Customer_Hub_CRM_PRD_v4.md` (the owner's file, outside the repo). Code read for this plan: the quote, accept, checkout, invoice, newsletter, auth, audit, mailer, automation and cron code, plus `docs/reference/database-schema-live.sql` (the 2026-11-14 production snapshot; drift against code is in `schema-drift-2026-11-14.txt` and does not touch any table this update uses, except two harmless index differences on `purchases` and `quote_requests`).

Per CLAUDE.md: requirements first, owner confirms the decisions in section 5, then one phase per release (a fresh session per phase). Every phase needs a CHANGELOG entry, the video check on commit, and push and deploy steps with full `cd` paths. Anything customer-visible also needs a draft release note and a how-to video; the staff-only CRM screens need neither.

## 1. Scale and shape of the data (why the plan is lighter than the PRD)

The first draft of this plan used the snapshot's `AUTO_INCREMENT` values, which are the highest id ever used, not row counts. The real counts from the 2026-11-14 preflight are: **4,540 contacts (27 of them `@example.com`), 6 quotes, 21 purchases (15 owned by `@example.com` contacts), 3 invoices, 4 admin users, 20 districts, 30 schools, 3 demo invitations, 2 support tickets.** The 2026-09-05 go-live cutover deleted every test purchase and quote and kept contacts. So this is a very small sales operation today: the useful part of the CRM is the workflow going forward (leads, deals, follow-ups, quotes), not reporting on history. Section 6 says what to defer, and section 1b adds a checkpoint after Phase 3.

## Status (2026-11-14)

- **Decisions D1 to D14 (section 5): confirmed by the owner as recommended ("Accept all").** Where a recommendation was a question, the recommended answer stands: Sales can see everything and edit only their own deals (D1); a NULL-amount manual purchase never counts until the owner confirms it (D3); the `closed` quotes become Inactive until the owner says won or lost (D5); AI is deferred (D8); the Phase 6 deferred list stays deferred (D9).
- **Phase 0: done.** Test baseline recorded (`cd server && npm test`: 1,002 pass, 0 fail, 0 skipped, about 16 seconds, on 2026-11-14). `server/scripts/report-crm-preflight.js` is written (read-only, counts only); the owner ran it on production and the output is below. The stale CLAUDE.md lines (admin accounts, where `requireSiteAuth` lives) are corrected.
- **Phase 1:** not started. Start it in a fresh session. The preflight changes its scope in the ways listed in section 1b.

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
- **Risks:** timeline query cost (indexes on `(contact_id, created_at)` and `(account_id, state)`; page by 50); never claim a quote was viewed unless a server-side view event exists (none until Phase 4).
- **Tests:** attachment type from bytes, path traversal, per-role access; overdue rule fires once and not twice on a second cron run; snooze and dismiss persist; timeline never includes student-level data.
- **Acceptance:** every rule links to evidence; tasks cannot be orphaned; permissions enforced on files.

### Phase 4. Quotes and commercial conversion
- **4a. Billing hardening (own sign-off, D11, ships first and alone).** Make the PO claim, purchase and invoice one transaction; add `AND accepted_at IS NULL` to the webhook update; store the Stripe session id on the purchase; look purchases up by `quote_id` instead of "latest". Tests reproduce each failure first (mid-way failure, replayed webhook, double card click).
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

### Phase 7. Reporting and hardening
- Funnel, stage conversion, weighted pipeline, win and loss, source to paid, time in stage, reconciliation to `purchases` and `invoices`; each metric shows its definition and date window. Access review of every new route, rollback drill (flag off, data intact), performance pass on the timeline and list queries, operations runbook for the cron jobs.
- **Tests:** report totals equal SQL over distinct opportunities and purchases (fan-out guard test with a contact in two accounts and a deal with three quote revisions); export is audited and admin-only.
- **Acceptance:** PRD section 22 workflow and reporting items.

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

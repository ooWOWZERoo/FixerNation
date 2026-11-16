# Sales CRM punch list (from the 2026-11-15 PRD-versus-build review)

Source: four read-only reviewers compared the build with `FNE_Customer_Hub_CRM_PRD_v4.md` and `sales-crm-update-requirements.md`; the security items were then confirmed in the code. Each item has one number. Status: **DONE** (fixed and tested), **OPEN** (not started), **DECIDE** (needs the owner), **DEFERRED** (already parked by D9 or phase 5, listed so nothing is lost).
Severity: H high, M medium, L low. "Where" is the file to start in.

## A. Security and access (the old admin routes never check the CRM role)

| # | Sev | Item | Where | Status |
|---|---|---|---|---|
| S1 | H | Inviting, editing, resetting and deleting admin accounts needs only a login; a new admin defaults to CRM Admin. Gate on CRM Admin, default a new admin to Read-only, audit each action. | `routes/auth.js` | DONE |
| S2 | M-H | Accept-a-quote-for-the-customer (concierge) has no role check, so any admin can create the purchase, invoice and license. CRM Admin only. | `routes/admin-concierge.js` | DONE |
| S3 | M | `PUT /quotes/:id` and `/send` skip the role matrix and write no audit. Read-only blocked; price or product changes on a sent quote CRM Admin only; no price change once accepted; audit price changes. | `routes/contact.js` | DONE |
| S4 | M | `GET /quotes` (and the PUT, send, revise and copy replies) return `accept_token`, which alone accepts by PO. Stripped from every admin reply. | `routes/contact.js` | DONE |
| S5 | M | Re-clicking Card after a re-price reuses the old pending purchase with the old amount and seats, but Stripe charges the new price. Refresh the purchase from the quote. | `routes/quote-accept.js` | DONE |
| S6 | M | No rate limit on the quote-token endpoints (`/accept`, `/accept/invite`, card); a non-string `poNumber` or `inviteEmail` gives a 500; a token holder can make the site email any address. Done: per-address limits (lookup 60 and accept 20 per 10 minutes, invite 5 an hour), text-only checks, email format check, PO number capped at 100 characters. Left as is: the invite is still single-use per quote and only within 7 days, so a token holder can send one email to one address. | `routes/quote-accept.js` | DONE |
| S7 | L-M | Timeline file entries and the deal's signer name and title go to Read-only; the matrix denies Read-only any file list. Done: file entries on the timeline follow the Files rule (Read-only none, Sales only deals they own or nobody owns); Read-only gets no signer name or title on the deal page. | `lib/crm-timeline.js`, `routes/crm-opportunities.js` | DONE |
| S8 | M | Staff-made and public quote requests insert the contact as Subscribed; the Hub's own rule says manual contacts start Unsubscribed. Also anyone can subscribe another person's email through the public form. Done: (owner's choice: Unsubscribed for both) a quote request, public or staff-made, creates a NEW contact as Unsubscribed; an existing contact's status is never changed. | `routes/contact.js` | DONE |
| S9 | L | `/uploads/%63rm-private/...` skips the `app.js` block (Apache blocks it in production). Move `CRM_FILES_DIR` outside the web root or match the decoded path. Done: a decoded, case-folded, normalized check (`isPrivatePath`) runs before `express.static`, so `%63rm-private`, `CRM-Private`, `%2f` and `..` spellings are all refused; the Apache rule is unchanged. | `app.js` | DONE |
| S10 | M | Acceptance evidence is a hash only: no stored snapshot of the terms, so a later price edit cannot be disproved; viewing evidence is not audited. Done: the exact text the buyer was shown is stored beside the hash (`acceptance_document_snapshot`, new column, written only once the alter script has run); a CRM Admin can open the full record from the deal page, each look is audited, and the page says whether the stored text still matches its hash. Quotes accepted before this keep the hash only. | `lib/quote-evidence.js` | DONE |
| S11 | M | No audit viewer, though the matrix has `audit_view` and the runbook says to use one. Done: a CRM Admin-only read-only audit log (`admin-crm-audit.html`, `/api/crm/audit`, linked from Hub Settings): the Customer Hub's own rows, newest first, filtered by what, who, record and dates, paged, no export, opening it is not logged. | new route and page | DONE |
| S12 | L | Erasure: a contact with notes, tasks, files or meetings cannot be deleted; meetings have no delete route; merge audit rows keep the removed person's name and email; `stderr.log` can hold emails from MySQL errors. Done: a CRM Admin can delete a meeting (cancel it first if its invitation is still on calendars); a CRM Admin can erase a person together with their notes, tasks, files (also from disk) and meetings after a confirmation, logged as counts only; merge audit rows no longer copy the removed person's name and email, and `scripts/scrub-crm-merge-audit.js` (dry run by default) cleans the old ones. NOT fixable in code: `stderr.log` can hold addresses from database errors; the owner should clear it on a schedule (see the runbook). | `routes/newsletter.js`, `crm-contacts.js` | DONE |
| S13 | L | Card click saves the signer name before payment, any token holder can overwrite it until paid, and the deal page shows "Accepted by" for an unpaid quote. Done: the deal page shows who accepted only once the quote is accepted; replacing the signer on an unpaid quote is still allowed (a typo) but is audited with the old and new name. Left as is: a link holder can still change the name until payment. | `quote-accept.js`, `crm-opportunities.js:171` | DONE |
| S14 | L | A merge leaves the kept contact's subscription unchanged (an unsubscribe on the removed duplicate is lost); a failed daily digest is never retried. Done: a merge keeps the more restrictive subscription status (an unsubscribe or bounce on the duplicate carries over; a kept unsubscribe is never turned back on); a digest that could not be sent (mail down, owner without an address) is taken back out of 'first seen' so the next daily run mails it, without flooding when the digest is first switched on. | `crm-contacts.js`, `crm-attention.js` | DONE |
| S15 | L | Superseded-quote race (status read outside the transaction); webhook raises a duplicate-payment alert on every retry when no purchase is found; "accept an unsent draft" allowed by a CRM Admin; card-purchase license dates run from the first click, not from payment. Done: a revision sent between the buyer's read and the PO claim now blocks the claim itself and the buyer is told it was replaced; a Stripe retry of a payment that found no purchase no longer raises a new 'duplicate payment' alert (the winning delivery records its session); nobody, CRM Admin included, can accept a quote that was never sent; a card purchase's license term is re-dated to the day the payment arrives. | `quote-accept.js`, `checkout.js` | DONE |
| S16 | L | Virus scan on uploads, key rotation for the future mailbox secret (needed before phase 5b). | `lib/upload-safety.js` | DEFERRED to phase 5 |

## B. Silent gaps (in the PRD, neither built nor listed in D9)

| # | Item | PRD | Status |
|---|---|---|---|
| G1 | Account-level Customer and the "unresolved, needs review" state (D4 was confirmed, never built); account filter by Suspect, Prospect, Customer | §8 rule 4, ACC | DECIDE |
| G2 | Needs Attention rules: quote unanswered after N days, expected close passed, trial ending, trial with high use, PO promised but not received; thresholds configurable | ACT-05 | OPEN |
| G3 | Review tasks for trial near expiry, high adoption and stalled activation | FR-TRIAL-03 | OPEN |
| G4 | Onboarding checklist after Won and paid | FR-WON-03 | OPEN |
| G5 | Repeat-order flow (tokenized) | FR-RENEW-02 | DECIDE |
| G6 | Qualification criteria and the "what is missing" output (D9 defers only the score) | FR-QUAL-01, 03 | DECIDE |
| G7 | Saved views: 5 of 8 missing (PA Districts, Trials Ending Soon, Expected This Quarter, Unpaid Won Deals, Renewals) | FR-VIEW-01 | OPEN |
| G8 | Overview cards: 6 of 12 missing (expected closings, open quotes, unpaid invoices, renewals due, win rate, unread); Customers tile says contacts only | FR-REP-01 | OPEN |
| G9 | Report breadth: pipeline by state, source, product, account type; quote conversion; procurement blockers; trial-to-paid; renewal and expansion; activity coverage; expected close by period; sale velocity | FR-REP-02, OPP-07 | OPEN |
| G10 | "Source to paid" is grouped by a staff-typed Source, not by contact attribution; the Phase 6 promise of attribution to revenue was dropped without a note | FR-ATTR-01 | DECIDE |
| G11 | A Customers & Renewals screen (at-risk renewals, expansion pipeline, onboarding rollups) | §17 | OPEN |
| G12 | Calendar view for tasks and meetings; meeting time zone, URL, attendance | ACT-03, §17 | OPEN |
| G13 | Quote events: declined and delivered never recorded; no decline flow | QUOTE-03 | OPEN |
| G14 | Task fields: priority, source, reminder, quote link; note edit history | ACT-01, 02 | OPEN |
| G15 | Procurement template omits COI, board approval, contract; no per-item owner or attachments | PROC-01 | OPEN |
| G16 | `last_contacted_at`, `started_on`, `ended_on` exist but nothing writes them; one primary contact per account not enforced | FR-CON-01, 02 | OPEN |
| G17 | Account duplicate review by domain; account rollups (customer status, paid purchases) | ACC-03, 05 | OPEN |
| G18 | Engagement trend and usage alerts on the engagement card | FR-TRIAL-01 | OPEN |
| G19 | Settings: classification rules page; contact and account filters by organization, buying role, engagement | §17 | OPEN |
| G20 | Event runner: `crm.*` automation events with idempotent keys (`trial.expiring`, `quote.sent` follow-up and so on) | §20 | DECIDE |
| G21 | Refund detection: Stripe refunds never change `payment_status`, so the "needs review" flag only fires on a manual change | §8 rule 7 | DECIDE |
| G22 | Prospect import and the ambiguous-match review queue | FR-CON-05 | OPEN |

## C. Bugs and data quality

| # | Sev | Item | Where | Status |
|---|---|---|---|---|
| B1 | M | Contact merge loses a manual Prospect label and deletes the removed contact's classification history (FK cascade). Done: the history moves to the kept contact and a Prospect label is carried over (recorded as `merge_kept_label`) | `routes/crm-contacts.js` | DONE |
| B2 | M | Overview counts include `@example.com` deals; Reports exclude them; the page says test addresses are left out. Done: the Overview uses the Reports' test-address rule for every deal figure and list | `routes/crm-overview.js` | DONE |
| B3 | M | "Paid amount" covers only quote-linked purchases; direct card revenue shows as zero and Reconciliation says "None"; grouped by deal date, not payment date. Done: Source to paid keeps its by-deal groups and adds three lines for every qualifying paid purchase bought in the window (by purchase date), split into on a deal's quote and on no deal | `crm-reports.js` | DONE |
| B4 | M | Renewal and expansion deals mix into every funnel, win rate and weighted figure; no report splits by deal type. Done: the five deal reports take `?type=` (new_business, renewal, expansion, cross_sell; blank means all) with a Deal type picker on the page, the label and CSV say which type was counted, and the funnel always shows the mix of types created in the window | `crm-reports.js`, `routes/crm-reports.js` | DONE |
| B5 | M | `alter-create-crm-core.js` adds the column, then the index and FK as a second step; if that fails the next run skips both. Done: each column, index and foreign key is checked and added on its own, so a re-run finishes a partial run | `scripts/alter-create-crm-core.js` | DONE |
| B6 | M | Backfill matches accounts by name only (two "Lincoln Elementary" in different states merge); skips any district matching `/demo/i`. Done: a name match uses the quote's state to tell same-named schools apart and lists an ambiguous one for a person instead of guessing; only real demo districts are skipped | `scripts/backfill-crm-core.js` | DONE |
| B7 | L-M | Two quote chains on one deal can both be accepted; a revised price leaves the deal's forecast amount stale. Done (owner chose: allow and flag; follow the price when untouched): a second accepted quote is allowed, audited (`crm_opportunity_more_quotes_accepted`) and shown as a notice on the deal page, and the deal value becomes the total only if it still equalled the first sale; sending a revision, or re-pricing a sent quote, moves the deal value to the new price only while the value is exactly the old price (a typed value, an empty value and a closed deal are never touched) | `lib/crm-hooks.js`, `routes/contact.js` | DONE |
| B8 | L | Funnel counts a reopened Won deal as having reached Won; stage reach depends on the current `sort_order`. Done: Won counts only deals that are Won now (so the row equals "Now won"); a reopened deal keeps the earlier stages it passed through. The dependence on today's stage order is stated in the report's definition rather than removed (history stores no rank) | `crm-reports.js` | DONE |
| B9 | L | Renewal suppression too broad (any later license at the same school); generator ignores district-level accounts and purchases with only a school domain. Done: a later license counts as the renewal only if it ends more than 90 days after this one; a purchase with only a domain finds its school through `schools`; a school with no account of its own uses its district's account (one open renewal deal per account still holds, so two schools in one district give one deal at a time) | `crm-growth.js` | DONE |
| B10 | L | Overview "My tasks" and "Needs attention" show `owner=me` only: unowned items and Read-only users see "nothing". Done: both boxes take a new `me_or_none` filter (yours plus unowned), a Read-only login sees everyone's with no colour chip, and the headings say which view it is | `admin-crm-overview.html`, `routes/crm-attention.js`, `routes/crm-tasks.js` | DONE |
| B11 | L | A staff-made quote promotes a Suspect to Prospect with no actor or reason. Done: the staff quote route passes the admin and a reason, which land on the label history (the public form still passes none: the person asked for the quote) | `contact.js`, `crm-hooks.js` | DONE |
| B12 | L | `won_no_purchase` fires for phone deals and generated renewals; Needs Attention capped at 200 rows each. Done: the rule needs a deal with at least one quote; a rule that has more than 200 items reports the true number and the page says "showing the oldest 200 of N" | `crm-attention.js` | DONE |
| B13 | L | Student floor tests enrolled students only, so 10 enrolled with 1 active can show; account scope includes purchases by any member contact. Done: each student number has its own floor (a real zero still shows); a purchase found through a member contact counts only if it has no school or a school in this account | `crm-engagement.js` | DONE |
| B14 | L | `candidateContactIds` and `/review/duplicates` do not scale (OR plus LOWER(TRIM()), loads every contact). Done: the nightly candidate list is three plain reads and a set lookup (no join); the duplicate review reads id, name and email once, keeps the grouping 30 seconds (a new or merged contact shows at once) and reads full rows only for the page shown. Still reads every contact's name and email per rebuild: fine at this size, revisit past about 50,000 contacts | `crm-classification.js`, `crm-contacts.js` | DONE |
| B15 | L | `is_trial` is read from the live product, so editing a product can change old Customer status; composite index `(opportunity_id, revision_number)` missing; tests never run the alter scripts and there is no rollback test for schema changes. Done: `purchases.is_trial_flag` is frozen the first time the CRM looks at a purchase and the Customer rule reads it; the composite quote index is added; the new alter script is re-runnable (tested against a fake MariaDB, including a half-finished run); a test fails if any CRM alter script drops, renames, rewrites or deletes anything, so the old code can run against the new schema. Not done: the alter scripts are not run on a real MariaDB in the tests (no database server in the suite) | `scripts/alter-crm-trial-flag-and-quote-index.js`, `crm-classification.js` | DONE |
| B16 | L | `PUT` on a deal has no compare-and-set; "next step" can be blanked after a stage move. Done: the write only lands if the deal's stage and state are still what was read, and (when the page sends `expectedUpdatedAt`, both edit dialogs do) nobody saved in between, else 409 `changed` and the page reloads; blanking the next step on an open deal past Qualified is refused unless `overrideReason` is sent (the same rule as a stage move) | `crm-opportunities.js` | DONE |

## D. Verification not yet done

| # | Item | Status |
|---|---|---|
| V1 | Stripe test-mode run of card checkout after phase 4a (and again after S5) | OPEN, owner |
| V2 | Browser click-through of the phase 4 pages (quote card, procurement card, Won handoff, Revise) | OPEN |
| V3 | Open a Reports CSV export in a real spreadsheet | OPEN, owner |
| V4 | Owner review of the 15 NULL-amount purchases | OPEN, owner |
| V5 | Publish or keep draft: release note `quote-signer` | OPEN, owner |

## E. Already parked (listed so nothing is lost)

| # | Item | Status |
|---|---|---|
| E1 | Phase 5b-5d: mailbox sync, conversations screen, threading, AI triage and drafts (FR-MAIL-01..04, FR-AI-01..04) | DEFERRED, awaits owner decisions (folders, mailbox access, student-data rule, AI provider) |
| E2 | D9 list: line items, reviews, customer health, custom fields and tags, a scored qualification model | DEFERRED |

## Suggested order

1. S1-S15 and B1-B16 (done; S16 stays deferred to phase 5).
2. Deploy and check (changelog entry: two small alter scripts, then restart; one optional scrub script), and the V items that need you.
3. G2, G1 and G7-G9 as one "reporting and attention" phase after the owner picks from the DECIDE items.
4. Phase 5 when the owner answers the open email questions.

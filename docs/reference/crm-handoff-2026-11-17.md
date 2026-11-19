# Customer Hub (Sales CRM): hand-over note, 2026-11-17

Written at the end of a long working session so a fresh session can pick up cleanly. Read this first, then `docs/reference/sales-crm-punch-list.md` (the source of truth, one row per item with the owner's decisions and the limits of each build) and `docs/reference/crm-operations-runbook.md` (what runs when, switches and rollbacks).

## Where things stand

- The whole 2026-11-15 review punch list is built, tested (1,476 tests) and **deployed to production**: S1 to S15, B1 to B16, G1 to G22. Nothing from it is uncommitted or unpushed. The only untracked files in the folder (`docs/sales/`, `fne_logo_scales.png`) are not CRM work and were deliberately left alone.
- Production was checked with `curl` after each deploy (pages load at the new versions; every new route answers 401 when signed out, not 404). **Nobody has seen the signed-in screens built after G8 in a real browser except the owner's quick look on 2026-11-17 ("all looks fine").** Every screen was otherwise checked by tests and syntax only.
- Latest versions of shared assets: `admin-common.css v23`, `admin-nav.js v40`, `admin-shell.js v13`, `crm-common.js v3`, `crm-common.css v3`, `crm-panels.js v4`, `admin-common.js v18`, `district-admin-nav.js v15`, `release-notes.js v15`.

## What the owner still has to do (none of it is code)

1. In Stripe (Developers, Webhooks, the existing endpoint) add the events `charge.refunded` and `charge.dispute.created`. Until then refunds and disputes are only flagged by hand (G21).
2. Switches in `scripts/crm-daily-attention.js` (run without `--apply` first to read the counts; each is `... --<name> on|off|status`): `--onboarding` is **ON**; `--quote-followups` and `--trial-tasks` are **off**.
3. Two customer release notes are drafts until read and published: `district-reorder-request` and `quote-decline` (`release-notes.js`).
4. Help videos: **C1** (District Admin tour) needs re-recording (narration says five menu pages, there are seven). A "Renew or change seats" video for the District Admin portal has not been made. D1 (Accept your quote) now shows an unmentioned "Decline this quote" link (still correct; optional one-line mention on its next re-record).
5. Paid purchases with no amount recorded (15 at last count) never count as Customer sales until a person confirms each on the existing review list. Renewals, expansion and revenue screens look empty until then. That is correct behaviour, not a fault.
6. Optional: `node scripts/backfill-crm-people-started-on.js` (report first, `--apply` to write) fills start dates for people already on accounts (G16).

## What was built, in one line each (details in the punch list)

G1 account labels (Customer, Prospect, Suspect) with a Needs review flag; G2 more Needs Attention rules with settable thresholds; G3 trial review tasks; G4 onboarding checklist after a Won and paid deal; G5 district reorder and seat-change requests (portal page plus a Reorder requests hub page; staff approve, staff price and send the quote; the CRM never writes a purchase); G6 qualification answers on a deal; G7 saved deal views; G8 Overview cards; G9 eight more reports; G10 Source to paid by first and latest visit; G11 Customers and renewals screen; G12 Calendar (drag to reschedule), meeting time zone, join link, attendance; G13 quote decline flow, send-failed and expired quote events; G14 task priority, source, reminders, quote link, note history; G15 COI, board approval and contract steps, step owners and files; G16 last contacted, left dates, one primary contact; G17 duplicate accounts by website address and paid-purchase rollups; G18 engagement trend and usage alerts; G19 filters and the read-only "How labels are decided" page; G20 quote follow-up task; G21 refund and dispute flags; G22 prospect import with a review queue.

## Rules that held all the way through (do not erode them)

- The Customer rule lives in ONE place (`lib/crm-classification.js`, `QUALIFYING_SQL`: paid, more than $0, not a trial, not a confirmed full refund). Nothing else decides who a Customer is.
- The CRM never writes a purchase, invoice, license or seat. Where money moves, it calls the existing code or only raises a flag for a person.
- No score and no hot, warm or cold anywhere (a test fails if they appear). "At risk" and alerts are lists of facts with reasons. Unknown is never shown as zero.
- Anything automatic is off until the owner has read a report (`--apply` and a switch), is idempotent (a ledger row claimed before the write), and never emails a customer by itself.
- Old installs stay usable: every new column or table is read defensively, and each feature says "not available yet" until its alter script has run. Run alter scripts BEFORE restarting the Node app.
- Escape everything that came from outside the keyboard (`esc()` / `fnEscape()`); no CDN or text-to-speech; test addresses (`@example.com`) are left out of every count.

## How the owner likes to work (also in the memory notes)

Design questions come as short multiple-choice questions with a recommended option first, one gap at a time. For each gap: write requirements and the access matrix first for anything touching access or money, build it, test it, add a plain changelog bullet and a punch-list row, report the limits honestly, then "commit", then the push and deploy steps (full `cd /full/path` in every command block, alter scripts before the restart), then "deployed, check it" and a curl probe of production (unauthenticated only, and say what could not be checked).

## Update, later on 2026-11-17

Six of the ideas below, one bug and one design note were then done in a second session, as follow-ups F1 to F8: see section F of `docs/reference/sales-crm-punch-list.md` (not yet committed or deployed when this note was updated). Still not built: bounce handling (design only: `docs/reference/crm-bounce-handling-design.md`), a "not a duplicate" memory for people, and fuzzy matching of an existing person to an account on import.

## Ideas that were considered and not built

A "my checklist steps" list across deals (G15); a "not a duplicate" memory on the account duplicate review (G17); editable alert lines for the engagement card (G18); fuzzy organization matching and fuzzy duplicate detection (G17, G22); a separate reminder email with a time of day (G14); bounce handling after the mail server accepts a quote email (G13); a one-click undo for an import (G22).

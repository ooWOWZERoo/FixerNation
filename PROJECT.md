# Fixer Nation Education — Project Notes

Production site and admin backend for Fixer Nation Education, live at **fixernationeducation.com**, hosted on Hosting.com/cPanel. A real Node/Express + MariaDB application — not a demo. This file describes **current state** (every real page, feature, and business rule as of the date below) — for history of what shipped when, see `CHANGELOG.md`.

**Maintenance rule (standing convention — see `CLAUDE.md`/`AGENTS.md`):** update this file in the same commit as any change that adds/removes a page, changes a gating rule, or changes a known limitation. This file is what a new developer (human or AI) should read first to understand what the app actually does today — keep it honest.

*Last full rewrite: 2026-08-23, via a from-scratch code survey (not just prior notes) covering every HTML page and every `server/routes/*.js` file.*

**Current direction: v1** (teal/coral, serif headings). The `-v2` set (navy/amber, Second Step-inspired mega-nav) was an earlier alternate direction reviewed and decided against — those files are kept for reference but are frozen, not under active development, and are not described further in this doc.

## Architecture

- **Backend:** Node/Express (`server/`), MariaDB. Deployed via cPanel's "Setup Node.js App" at `repositories/fixernation/server`, mounted at `fixernationeducation.com/api` — all Express routes live under `/api/*`.
- **Frontend:** plain HTML/CSS/vanilla JS, no build step, no framework. Shared client-side includes (`nav.js`, `footer.js`, `site-auth.js`, `admin-common.js`/`admin-nav.js`, `school-admin-nav.js`, `cart.js`, `pdf-modal.js`) are injected via `<script src="...?v=N">` tags — bump the `?v=N` cache-bust on every page that references a shared file whenever that file changes (browsers cache these indefinitely otherwise).
- **Three independent JWT-in-cookie auth systems, deliberately never able to satisfy one another's middleware** (`server/lib/session.js`):

  | Cookie | Max age | Covers | Login route |
  |---|---|---|---|
  | `fn_session` | 24h | The single admin account (`admin_users`) | `server/routes/auth.js` |
  | `fn_user_session` | 30 days | `site_users` — teachers, school license admins, parents, community members, consumers | `server/routes/site-auth.js` |
  | `fn_student_session` | 8h (one school day) | `classroom_students` — PIN-based, no email at all | `server/routes/classroom-auth.js` |

  **Session invalidation** (site-user only): `site_users.session_invalidated_at` + a JWT `iat` check in `requireSiteAuth`. Set on password change/reset and on any admin action that revokes access (seat unregister, license suspend/cancel/delete-by-domain, both expiry crons) — closes the gap where `hasActiveLicense()` re-checks live but a still-valid 30-day cookie would otherwise keep working for non-license-gated pages (roster tools, classroom management, community). Admin (`fn_session`) sessions have **no revocation mechanism at all** — a pure JWT check, by deliberate lower-priority decision.
  **Known bypass, confirmed intentional (do not "fix" without asking):** an admin with an active `fn_session` in their browser sees full unlocked content on every public page in that same browser, independent of whatever the site-user nav shows — this occasionally reads as a contradiction during dogfooding but is by design.

- **File uploads:** `/api/uploads`, real files for book covers (legacy), curriculum videos/documents, blog images, avatars, community post attachments, Morning Boost audio clips.
- **Curriculum file serving:** never linked directly from `/uploads/` — always through `GET /api/curricula/:id/file?resource=<name>` (or `?doc=<index>`), which enforces the access matrix below and logs to `curriculum_downloads`. Rendered client-side via `pdf-modal.js` (PDF.js from cdnjs) — no native browser PDF viewer, no direct URL exposure.
- **Deploy workflow:** commit → push to GitHub (`github.com/ooWOWZERoo/FixerNation`, public repo — never commit real PII or secrets) → `./deploy.sh` in cPanel Terminal (git pull, rsync, npm install + migrations + restart-flag when `server/` changed). See `CLAUDE.md` for the exact command chain; schema changes to *existing* tables always need a manual one-off `server/scripts/alter-*.js` since `migrate.js` only ever runs `CREATE TABLE IF NOT EXISTS`.
- **`server/db/schema.sql` is a stale base snapshot, not the live schema.** Many now-load-bearing columns/tables (`purchases.license_status`/trial fields/`school_domain`/`invoice_id`/`quote_id`, `school_license_admins`, `school_audit_log`, `parent_student_invitations`, `site_user_audiences`, etc.) only exist via `server/scripts/alter-*.js` migrations layered on top. Don't trust `schema.sql` alone for "what tables/columns exist today."

## Licensing, checkout & quotes

**Five distinct ways a license or book gets purchased**, all real and live except where noted:

| # | Entry point | Route | Payment | Live today? |
|---|---|---|---|---|
| 1 | Cart (`cart.html`) — books + fixed-tier license products | `POST /api/checkout/create-cart-session` | Stripe Checkout | Coded, **blocked on real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`** — every card path throws at call time without them, no graceful fallback |
| 2 | Cart — Purchase Order | `POST /api/checkout/create-po-order` | None (PO) | **Live** |
| 3 | `licenses.html` standalone — flat single/group license | `POST /api/checkout/create-session` | Stripe Checkout | Stripe-blocked, same as #1 |
| 4 | `licenses.html` standalone — variable-seat / trial product | `POST /api/checkout/create-session` | Stripe Checkout | Stripe-blocked, same as #1; confirmed working end-to-end against **Stripe test-mode keys** via the e2e suite |
| 5 | Quote acceptance (`accept-quote.html`) | `POST /api/quote-accept/accept` | Card or PO | PO branch live; card branch Stripe-blocked |

PO is explicitly the designed fallback so "a school isn't blocked waiting on their business office" — it's the only checkout path guaranteed to work with zero external configuration.

**License data model:** `purchases` (one row per order line — `product_type` book/single_license/group_license/membership; `payment_status` paid/pending; `license_status` pending/scheduled/active/expiring_soon/suspended/cancelled/expired/converted; `school_domain` — a real, normalized email domain, distinct from `quote_requests.school`'s free-text display name) → `license_seats` (single_license = 1 seat pre-filled with buyer's email; group_license = N unassigned seats; a signup matching a seat's `invited_email`, and for group licenses matching the school domain too, auto-claims it) → `license_products` (admin-editable catalog; flags for `call_for_quote`, `variable_seats`, `is_trial`/`trial_days`/`trial_lesson_limit`, `auto_assign_group_id`). Access (`hasActiveLicense()`) requires a `registered` seat AND a license status not in pending/expired/cancelled/suspended AND not past `expiration_date`.

**Quote lifecycle:** a quote starts one of two ways — inbound request (`POST /api/contact/quote`, from the public site) or **admin-initiated outbound outreach** (`POST /api/contact/quotes`, a "+ New Quote" button on `admin-quotes.html`). Outbound quotes open the **exact same modal** used to view/edit any quote — same pricing tabs, tiers, school domain, status, notes, content profile — just with the contact fields (name/email/school/phone) blank and editable instead of pre-filled from an inbound request; those contact fields are editable on every quote now, not only new ones. A not-yet-created quote is transparently inserted (`origin='admin'`, tagged "Outbound" in the list) the first time it's saved or sent. Either way: admin builds & sends from `admin-quotes.html` (tier/add-on-seats/term/discount, custom price override, sets `quoted_school_domain` separately from the free-text school name, and picks a **Quote Content Profile** — see below) → buyer opens `accept-quote.html?token=` → accepts by card or PO. The **PO branch claims the quote atomically** (`UPDATE ... WHERE accepted_at IS NULL`) before creating anything, closing a double-submit race that used to create duplicate purchases/invoices. A quoted **trial** product is always forced to `single_license`/1 seat on acceptance (a `group_license` only creates unassigned seats, which can never be self-claimed — this was a real shipped bug, fixed). PO acceptance creates a real `unpaid` invoice and forces `license_status='pending'` until PO-received (below); auto-registers the buyer as a school admin if a matching `site_users` row exists; supports a single-use, 7-day, unauthenticated co-admin invite (`POST /api/quote-accept/accept/invite`).

**Quote Content Profiles** (`quote_content_profiles` table) replaced a single global set of the 4 boilerplate email sections (What's Included / Lesson Package / Video Access / License Terms) with a library of named, reusable sets — e.g. "Standard" vs. "30 Days Free Trial" — managed from a card on `admin-quotes.html`. Every quote stores which profile it uses (`quote_requests.content_profile_id`) and always renders that profile's **current** content at send/resend time (live reference, not a snapshot) — editing a profile updates every quote using it immediately. Deleting a non-default profile reassigns any quotes using it back to the default rather than blocking the delete; the default profile itself can't be deleted. `GET/PUT /api/settings/quote` no longer exposes the 4 section fields — superseded entirely by this table.

**Invoicing — two deliberately independent gates, not one:**
- **Mark Paid/Unpaid** (`PUT /api/invoices/:id`) touches only `invoices.status` → cascades to `purchases.payment_status`. Pure bookkeeping. Fires `invoice_paid` on a fresh transition to paid. Cancelling an invoice never revokes already-granted access.
- **Mark PO Received** (`POST /api/invoices/:id/po-received`) touches only `purchases.license_status` (→ `active`, sets `effective_date`). This is the real content-access gate. No financial check at all.

A school can legitimately have full content access while its invoice is still `unpaid` (admin still chasing the check) or vice versa — this is intentional, documented business logic ("give access on receipt of signed PO paperwork; track money owed separately"), not a bug. Every `invoices` row is inherently PO-sourced — Stripe/card checkouts never create one. Deleting an invoice un-links (not deletes) its purchases.

## Memberships

Three member types (`consumer`, `service_provider`, `brand_ambassador`), each with admin-editable plans (`membership_plans` — price, billing interval, trial days, Stripe sync when keys are configured). **Confirmed effectively dead as a public checkout path**: the three public signup pages `join.html`/`service-providers.html`/`brand-ambassador.html` do not exist anywhere in the current codebase (removed in the 2026-08-22 scope cleanup, see Known limitations), so `POST /api/checkout/create-membership-session` and its full Stripe subscription/webhook machinery are unreachable from any live page today. **The only live path onto a membership is the admin manual grant** (`admin-memberships.html` → `POST /api/memberships/contacts/:contactId`), which creates a `purchases` + `contact_memberships` row with zero Stripe involvement by design. `contact_memberships.status` (trialing/active/past_due/cancelled/expired) persists across the whole lifecycle; every real charge (first or renewal) creates its own new `purchases` row, which is why membership revenue shows up in Orders/Financial Insights alongside book/license purchases.

## Curriculum & content

Curriculum resources are gated by a consistent server-side matrix (`server/routes/curriculum.js`'s `gateAccess()`, applied identically on `education-portal.html`, `lesson-detail.html`, `student-lesson.html`): overview/objectives/materials/video/resource *labels* stay public; **Student Handout** and **Classroom Poster** are viewable by anyone but download-gated; **Teacher Copy**, lesson-plan documents, and the **Quiz + Answer Key** require an active teacher license (or a curriculum-specific parent-access check) for both view and download. Admins always see everything, everywhere on the public site (see the auth bypass note above). Trial licenses get a metered preview (`trial_lesson_limit` curricula before `documents`/`quiz` get stripped even for them). Every gated file download is per-resource rate-limited (`download_limit`, 0 = unlimited) and logged to `curriculum_downloads` (teacher email × curriculum × resource type).

Blog posts (`blog_posts`) support multiple categories, SEO fields, real scheduling (`published=true` + a future `publishDate` stays hidden until that date — genuine scheduling, not just an on/off flag), and an optional `requiresMembership` flag that strips body/video server-side for non-members (note: this membership check, not a license check, is the actual gate on locked blog posts). The full 2026 Morning Boost content calendar (205 daily Theme/Series entries) lives in `morning_boost_calendar`, one-to-one linkable to a blog post; **Morning Boost Studio** (`admin-morning-boost.html`) batch-generates voice-over MP3s via ElevenLabs — coded and complete but **not live** until `ELEVENLABS_API_KEY` + a saved voice ID are configured (same deferred-but-complete pattern as Stripe). Image generation and video assembly for Morning Boost remain fully manual by design — no work started. The Morning Boost daily email (`admin-morning-boost-email.html`) is a full campaign system in its own right (config/schedule/history tabs, per-recipient open/click tracking, resend-to-failed) driven by a daily cPanel cron calling `server/scripts/send-morning-boost-email.js`.

## School-Admin portal

School license admins are `site_users` (`role='school_license_admin'`) linked to one or more group-license `purchases` via `school_license_admins` assignments, each carrying a **permission level**: `primary` (full access — invite, revoke, reports, co-admin visibility), `secondary` (can invite/manage but cannot revoke a seat/invitation or remove a teacher), `read_only` (view everything, write nothing). Enforcement is server-side and per-purchase (`blockIfReadOnly`/`blockIfCannotRevoke` in `server/middleware/schoolAdminAuth.js`, fail-closed by design) — **the frontend does no client-side gating by level**; a read-only or secondary admin sees every button and only gets blocked with a 403 toast after clicking.

School-admin accounts are created in exactly one way: **FNE-staff manual assignment** (`admin-school-admins.html` → `POST /api/admin/school-admins/assign`) — there's no self-service way for a school admin to add a peer. Teachers get onto a license two ways: an admin sends a single or bulk invite (lands on `school-invite-accept.html`), or a teacher self-registers (`education-schools.html` → `POST /api/school-registration/check`, exact email-domain match against a `purchases.school_domain`, capacity-checked transactionally) and gets nudged to notify their school admin if no seats/plan exist yet. Seats move `pending → registered → inactive/revoked`; revoking a seat or removing a teacher force-invalidates their session and, if they also held a co-admin assignment on that purchase, soft-deactivates that too with its own audit entry.

Pages: `school-admin-login.html`, `school-admin-dashboard.html` (stats + activity feed, read-only for all levels), `school-admin-roster.html` (the real merged teacher+seat management screen — `school-admin-teachers.html` and `school-admin-licenses.html` are now dead `<meta refresh>` redirect stubs into this one, kept only for old bookmarks), `school-admin-invitations.html` (send/bulk/resend/extend/revoke/delete + CSV template), `school-admin-org.html` (read-only license/plan/co-admin info — doesn't distinguish primary vs. secondary in its own UI, only "Full Access"/"Read Only"), `school-admin-reports.html` (utilization/teachers/invitations/activity-log tabs, CSV export, read-only for all levels).

## Teacher portal

`teacher-login.html` → `teacher-classrooms.html` (create/list classrooms — no license check to create one) → `teacher-classroom.html`, the main workspace: Students tab (add/CSV-import/reset-PIN/deactivate students, per-student parent invites — the *only* parent-linking path today, see Parent portal below), Assignments tab (assign lessons — **requires an active license**, 403 otherwise — and assign Brain Games — no license check), Progress tab (per-lesson completion summary). `teacher-classroom-progress.html` drills into one lesson × classroom: quiz scores, written reflections, CSV export, per-student quiz reset. `teacher-lesson-plans-browse.html`/`teacher-lesson-plans.html` let a teacher permanently add curricula to a personal library (capped at `teacher_lesson_plan_limit`, default 40, admin-configurable; **teacher-side removal doesn't exist** — only an FNE-internal endpoint can remove a selection).

## Student / classroom system

No email, ever, for a classroom-PIN student. A teacher's classroom has a `join_code`; a student registers with the code + a display name + a self-chosen PIN (`server/routes/classroom-auth.js`) and gets an auto-generated username; re-entering the same name with the matching PIN logs back into the same account instead of duplicating it. Students see only what's assigned to their specific classroom (`classroom_assignments` for lessons, `classroom_game_assignments` for Brain Games). Pages: `student-login.html`, `student-home.html`, `student-lesson.html` (full flow: overview, handout, video, pre/post reflection, one-attempt quiz, goal-setting), `student-game.html` (iframes the public brain-game page), `student-achievements.html` (goals + lesson history — no brain-game history, see below).

**Architectural gap, confirmed and explicitly deferred (product decision, not a bug to silently fix):** the brain-games XP/badge/streak system is built entirely on the `fn_user_session`/`site_users` cookie. Classroom-PIN students' `fn_student_session` is never checked anywhere in `brain-games.js`. A student playing a Brain Game only ever produces a bare completion timestamp (`student_game_completions`, via `student.js`) — no score, no XP, no badge, no streak, ever. This is a real, scoped-but-not-built product gap, not an oversight to patch reflexively.

## Parent portal

Per-child, teacher-initiated invites only — the old shared classroom-level `parent_code` self-join flow was removed outright. A teacher invites a parent to follow **one specific student** from `teacher-classroom.html`'s roster (`POST /api/classrooms/:id/students/:sid/invite-parent`); the parent accepts via `parent-invite-accept.html`, creating a `parent_classroom_links` row keyed by `(site_user_id, classroom_id, student_id)` — a parent with two kids in the same classroom gets two independent link rows/cards. `parent-portal.html` shows one card per linked child with **completion-status progress only** (no quiz answers, no reflections — deliberately teacher-only). `parent-lesson.html` shows a curriculum's public preview plus Teacher Copy/Student Handout/Classroom Poster only (no quiz, no lesson-plan docs). A parent can never see another parent's or another student's data — every route re-checks the specific link row.

## Social / community

Gated to `site_users` with an active license **or** active membership (`requireSocialAccess`) — classroom-PIN students have no access at all, and there's no bridge between the two auth systems. `social.html`: groups (admin-created; users self-serve join/leave public ones — no membership-approval workflow exists), a feed (text/image/video/file posts up to 5 files/100MB each, auto-embedded YouTube/Vimeo, hashtags, reactions, threaded comments, 15s unread-badge / 5s feed polling), and direct messages. `social-profile.html`: opt-in bio/email visibility and an opt-in showcase of up to 6 featured Brain Game badges. Admin moderation (`admin-social.html`) covers posts (soft-delete) and groups (create/edit/visibility-toggle/delete) via a separate `requireAuth` (staff) gate — **comment moderation exists as a real API** (`DELETE /api/social/comments/:commentId`) **but has no admin UI to reach it**, a likely oversight since post rows show comment counts with no way to act on them.

## Brain Games

Six public mini-games (`brain-memory-match.html`, `brain-number-sequence.html`, `brain-quick-math.html`, `brain-reaction-time.html`, `brain-simon-sequence.html`, `brain-stroop-challenge.html`) plus a hub (`brain-games.html`), a personal stats dashboard (`brain-games-progress.html`), and a badge showcase (`brain-badges.html`, with a bio-style opt-in privacy toggle for social visibility). Anyone can play anonymously in the browser, but scoring/XP/badges/streaks require a `site_users` login — anonymous play and classroom-PIN-student play both fall through to nothing being recorded (see the architectural gap above). Server-side (`brain-games.js`): real score recalculation with anti-tamper metric validation, an XP/level table (7 levels, Beginner→Master), 20+ badge-criteria types, and daily login-streak tracking. This system is a general engagement feature, not part of the SEL curriculum/licensing business.

## Admin backend

All under a single `fn_session` login (`admin-login.html`; new admins are invited via a 24h single-use token, `admin-accept-invite.html`, shared with password-reset), themed teal/coral/gold with a light/dark toggle persisted in `localStorage`.

**Content:**
- `admin-curriculum.html` — full curriculum CRUD, drag-and-drop reorder, bulk publish/unpublish/duplicate/delete, per-resource download limits, and a `.docx` quiz-import parser (fuzzy title matching against the curriculum catalog).
- `admin-blogs.html` — full post CRUD, reusable tag list, auto-slug, "Load From Morning Boost Calendar" prefill, and an auto-link-back to the calendar when a post is tagged "Morning Boost" with a publish date.
- `admin-downloads.html` — cross-curriculum download ledger (Teachers/Parents/Students tabs — Students is UI-only, student downloads aren't tracked at all), wildcard search, per-row and bulk-reset controls.
- `admin-morning-boost.html` / `-calendar.html` / `-email.html` — voice-over generation studio (ElevenLabs, not live), calendar-to-post linkage + batch draft creation, and the full daily-email automation (config/schedule/send-history, cron-driven).

**Sales & CRM:**
- `admin-newsletter.html` — the CRM core: contact CRUD, CSV import (upsert-by-email, blanks-only), purchase history, group-license seat assignment, contact groups, site-account actions (resend verification, password reset, delete).
- `admin-campaigns.html` — real-SMTP email campaigns, audience segmentation (status/source/group, opt-outs always excluded regardless of filter), open/click analytics, one-click follow-up drafts targeting non-openers/clickers.
- `admin-quotes.html` — the full quote pipeline described above (build/send/copy) plus admin-editable quote-email content sections and discount percentages.
- `admin-invoices.html` / `admin-invoice-print.html` — PO invoice list/resend/mark-paid/mark-PO-received/cancel/delete, and a print/PDF-via-browser single-invoice view.
- `admin-orders.html` — unified read-only order ledger merging real `purchases` with synthetic $0 rows for comped/pre-webhook memberships.
- `admin-licenses.html` — license product catalog CRUD **and** per-school license administration (domain search, seat count edit, status/date editing with automatic session invalidation on suspend/cancel, per-teacher grade-level and lesson-plan-library management).
- `admin-memberships.html` — membership plan CRUD (Stripe-synced when keys exist) and per-contact membership management (manual grant, status transitions, renewal reminder trigger).
- `admin-school-admins.html` — the only way a school-admin account/permission-level gets created or changed.

**System:**
- `admin-dashboard.html` — financial summary, sales-over-time chart, six computed insight metrics (MoM growth, quote-to-sale conversion, DSO, LTV, cancellation rate, revenue-by-category), content counts.
- `admin-analytics.html` — anonymous session-based visitor funnel/behavior tracking (sessionStorage-only session id, no purchase-tie-in by design).
- `admin-automations.html` — **the one significant WIP surface in the admin backend.** The real, working part is GET+PUT on a fixed set of 13 system-triggered email templates (see below) — enable/disable, edit subject/body/merge-tokens. Everything else the UI implies (a no-code automation *builder* with triggers/conditions/branching, Execution History, Analytics, Audit Log, Failure Center tabs) is decorative: "Save Automation" in the builder shows a toast and calls no API at all; the History/Analytics/Audit tabs are static "coming soon" blocks. The page's own Overview tab copy admits this ("wired in the next backend phase").
- `admin-social.html` — post/group moderation (see Social above).
- `admin-settings.html` — own password, 4 contact-routing emails, invoice branding, teacher lesson-plan limit, quote discount %/from-email, admin auto-refresh interval, and full admin-user management (invite/edit/delete/resend-invite/reset-password, with hard guards against self-delete and deleting the last remaining admin). **Minor gap:** `GET/PUT /api/settings/quote` supports 4 additional quote-section-text fields with no corresponding form inputs on this page — implemented but currently unreachable through the UI.

## Automations

**13 fixed system-triggered email types** (not a smaller "core six" — verified directly against `server/scripts/seed-email-automations.js`), each admin-editable (subject/body/on-off, and for the renewal reminder, days-before-`ends_at`) from `admin-automations.html`, fired through the single call site `fireAutomation()` (`server/lib/automations.js`), which swallows its own errors so a broken template/SMTP outage never blocks the purchase/invoice/seat action that triggered it:

`book_purchase_thank_you`, `membership_purchase_thank_you`, `membership_renewal_reminder`, `invoice_paid`, `payment_failed`, `membership_trial_started`, `license_seat_invite`, `school_license_expiring_soon`, `school_license_expired`, `trial_purchase_thank_you`, `trial_expired`, `trial_converted`, `quote_accepted`.

Four of these (`trial_expired`, `school_license_expiring_soon`, `school_license_expired`, `membership_renewal_reminder`) plus the daily Morning Boost email are driven by cPanel cron jobs, not live HTTP requests — the expiry crons also handle session invalidation for revoked access, not just the email.

## Known limitations

- **Proactive/outbound quoting and Quote Content Profiles are coded but not yet deployed** — needs `server/scripts/alter-add-quote-content-profiles.js` run + `./deploy.sh`. See `CHANGELOG.md`'s Unreleased section.
- **Stripe checkout isn't live** — every card-based path (cart, `licenses.html`, quote-accept card branch, membership subscriptions) throws at call time without real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` configured (no graceful fallback, unlike `membership-plans.js`'s admin sync which does guard). Confirmed working end-to-end against Stripe **test-mode** keys via the e2e suite. PO checkout is the only guaranteed-live path with zero external config.
- **ElevenLabs voice-over generation isn't live** — needs `ELEVENLABS_API_KEY` + a saved voice ID. Image generation and video assembly for Morning Boost are fully manual by design, not started.
- **The consumer/service-provider/brand-ambassador membership system has zero live public checkout** — its three signup pages were removed from the site entirely on 2026-08-22 as out-of-scope leftovers from a different project (fixernation.org); the only surviving path onto a membership is an admin manual grant. `join.html`/`service-providers.html`/`brand-ambassador.html`/`books.html`/`my-memberships.html` and all consumer-book content were removed in the same cleanup — FNE today is teacher/school/curriculum-licensing focused, not a consumer bookstore or membership site.
- **`server/routes/books.js` is still fully live but has no admin page of its own** (`admin-books.html` was removed with the rest of the consumer-book scope) — it survives only as a legacy purchase type in the CRM's "add purchase" flow (`admin-newsletter.html`) and a stat tile on `admin-dashboard.html`. Dead weight worth removing outright if book sales never come back into scope.
- **The Automations builder UI is mostly decorative** — see admin-automations.html above.
- **Comment moderation has no admin UI** despite a real backend endpoint existing.
- **Brain-games XP/badges/streaks are unreachable by classroom-PIN students** — architectural, scoped, explicitly deferred (see Brain Games above).
- **`programs.html`'s `?series=` deep link into `education-portal.html` doesn't actually pre-filter anything** — the portal builds its filter chips from live data and never reads the query string. Minor, cosmetic.
- **Renewal-reminder/expiry crons depend on the cPanel Cron Job staying configured**, with no alerting on a missed run. Verify manually with `node scripts/send-membership-reminders.js` if reminders seem to have stopped.
- **Email open-tracking is pixel-based and imprecise** (plain SMTP relay, not an ESP with delivery webhooks) — treat campaign/Morning-Boost open numbers as directional, not exact.
- **`-v2` pages are frozen** by original decision, not neglected.
- **Playwright e2e suite** (own `tests/` package, 51+ spec files, runs against live production) covers every admin page, all public flows, and all 4 site portals — see `tests/README.md`/repo memory for the QA-account seeding script and run pattern. Not wired into CI; run manually.

## Assets

- Author photo: `anthony.png` (about page).
- Any book-cover/trailer assets referenced by the old consumer-book pages were removed along with those pages in the 2026-08-22 scope cleanup — FNE no longer sells books directly.

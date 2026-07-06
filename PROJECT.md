# Fixer Nation Education — Project Notes

Production site and admin backend for Fixer Nation Education, live at **fixernationeducation.com**, hosted on Hosting.com/cPanel. A real Node/Express + MariaDB application — not a demo. For the full history of what's shipped, see **`CHANGELOG.md`**.

**Current direction: v1** (teal/coral, serif headings). The `-v2` set (navy/amber, Second Step-inspired mega-nav) was an earlier alternate direction reviewed and decided against — those files are kept for reference but are frozen, not under active development.

## Architecture

- **Backend:** Node/Express (`server/`), MariaDB database. Deployed via cPanel's "Setup Node.js App" at `repositories/fixernation/server`, mounted at `fixernationeducation.com/api` — all Express routes live under `/api/*`.
- **Frontend:** plain HTML/CSS/vanilla JS, no build step, no framework. Public pages and admin pages are separate flat files served statically from `public_html`.
- **Auth:** two independent JWT-in-cookie systems — `fn_session` for the single admin login, `fn_user_session` for public site-user accounts (teachers/schools). They never cross.
- **Email:** real SMTP via `nodemailer` (`server/lib/mailer.js`), currently a cPanel-hosted mailbox. No third-party ESP (SendGrid/Mailgun/etc.) — see the Known Limitations note on email tracking below.
- **File uploads:** `/api/uploads`, real files (not just filename references) for book covers, curriculum videos/documents, blog images.
- **Deploy workflow:** commit → push to GitHub (`github.com/ooWOWZERoo/FixerNation`, **public repo — never commit real PII or secrets**) → in cPanel Terminal: `git pull` in the git clone, `rsync` the static files into `public_html` (excluding `server/`, `api/`, `uploads/` — see `CLAUDE.md`), `npm install` if `server/package.json` changed, restart the Node app if any `server/` code changed. Schema changes to *existing* tables need a manual one-off migration script (see `server/scripts/alter-*.js` for examples) since `migrate.js` only ever runs `CREATE TABLE IF NOT EXISTS`.

## Public site pages (v1 = primary, `-v2` = frozen alternate)

| Page | v1 file | v2 file |
|---|---|---|
| Home | index.html | fixernation-redesign-v2.html |
| About | about.html | about-v2.html |
| Books listing | books.html | books-v2.html |
| Book detail — Kill the Bully | book-kill-the-bully.html | book-kill-the-bully-v2.html |
| Book detail — Your Past Doesn't Define You | book-your-past.html | book-your-past-v2.html |
| Book detail — Think with 5 Brains | book-5-brains.html | book-5-brains-v2.html |
| Book detail — How to Lie | book-how-to-lie.html | book-how-to-lie-v2.html |
| Join / Membership pricing (consumer) | join.html | join-v2.html |
| Service Provider memberships (v1 only) | service-providers.html | — |
| Brand Ambassador program (v1 only) | brand-ambassador.html | — |
| FN Network | fnnetwork.html | fnnetwork-v2.html |
| Ask The Fixer | askthefixer.html | askthefixer-v2.html |
| National Education Portal | education-portal.html | education-portal-v2.html |
| 2D Education - Schools | education-schools.html | education-schools-v2.html |
| Programs | programs.html | programs-v2.html |
| FN Blogs | blog.html | blog-v2.html |
| Lesson plan detail (v1 only) | lesson-detail.html?id=&lt;curriculumId&gt; | — |
| School license pricing / checkout (v1 only) | licenses.html | — |
| Shopping cart (v1 only) | cart.html | — |
| Self-service license management (v1 only) | my-license.html | — |
| Password reset (v1 only) | reset-password.html | — |
| Your Privacy Choices (v1 only) | privacy-choices.html | — |
| Contact Us (v1 only) | contact.html | — |

## Admin backend

| Page | File |
|---|---|
| Login | admin-login.html |
| Dashboard (+ Financial Insights) | admin-dashboard.html |
| Book product configuration (CRUD, Amazon format pricing) | admin-books.html |
| Curriculum builder (CRUD, resources, quiz, download-limit testing) | admin-curriculum.html |
| Blog builder (CRUD, multi-category, SEO fields, membership gating, scheduling, live on the public FN Blogs page) | admin-blogs.html |
| Morning Boost Studio (calendar-aware post prefill, ElevenLabs batch voice-over generation) | admin-morning-boost.html |
| Contacts Management — CRM (search/filter/sort, columns picker, purchases, site-account status) | admin-newsletter.html |
| Email campaigns (real SMTP send, open/unsubscribe analytics) | admin-campaigns.html |
| License products, school-domain lookup/management | admin-licenses.html |
| Membership plans (CRUD, Stripe sync, duration) + Members (browse/filter/grant, expiration) | admin-memberships.html |
| Automated emails (thank-yous, renewal reminder, payment-failed, invoice-paid, seat invite) | admin-automations.html |
| Invoices (PO orders, filter by status, resend, cancel/delete, print) | admin-invoices.html |
| Settings (own password, admin management, contact-form email routing for 4 forms, invoice branding) | admin-settings.html |
| Shared styles/logic | admin-common.css, admin-common.js (cache-busted as `?v=N` — bump N in every referencing page whenever either file changes) |

Admin styling uses FN's own brand palette (teal/coral/gold) with a light/dark theme, toggled from the topbar and persisted in `localStorage`. `admin-login.html` intentionally stays a fixed brand-teal gradient regardless of theme choice. The login/accept-invite/invoice-print pages have their own self-contained styles and don't participate in the shared theme.

Admin login is real (bcrypt-hashed password, JWT session) — there is no demo/seeded credential shown here on purpose; ask whoever manages the account.

## Licensing & checkout

Two ways to buy a school/teacher license, both live:

- **Purchase Order (PO)** — no card required. Buyer enters a PO number, the license activates immediately, FixerNation invoices the school afterward (`admin-invoices.html`). Fully live today.
- **Stripe card checkout** — coded and deployed but **not yet live**, blocked on the admin obtaining real Stripe API keys. See `CHANGELOG.md`'s Unreleased section for what's needed to turn it on.

A single admin-editable **license product catalog** (`admin-licenses.html`) backs both the cart (`cart.html`) and the standalone `licenses.html` flat-rate flow. Group licenses generate open seats a school fills with teacher emails; signing up with a matching email auto-claims a seat. Curriculum lesson documents and quizzes are gated behind an active seat — the overview/objectives/preview content stays public either way.

## Memberships

Three member types — Consumer, Service Provider, Brand Ambassador — each with one or more admin-editable **membership plans** (`admin-memberships.html`'s Plans tab), covering the 7 real tiers (Free w/ Book, Monthly/Annual Consumer, Monthly/Annual Service Provider, 2D Education Program registration, Brand Ambassador). Public checkout lives on `join.html` (consumer), `service-providers.html`, and `brand-ambassador.html`, each rendering its pricing cards from the plan catalog and posting to `/api/checkout/create-membership-session` — recurring plans open a Stripe subscription-mode Checkout session (with a trial period), the one-time 2D Education plan opens payment mode. Like license checkout, this is **not live** until real Stripe keys are configured; unsynced plans show "Contact Us to Sign Up" instead.

A contact can hold multiple memberships at once, tracked in a `contact_memberships` table (status: trialing/active/past_due/cancelled/expired) separate from `purchases` — visible on the CRM contact record and browsable/filterable/manually-grantable from `admin-memberships.html`'s Members tab. Every real charge becomes its own order: the first one after a trial ends and every renewal each create a new `purchases` row (via the `invoice.paid` webhook, keyed uniquely by Stripe invoice ID so retries don't double-count), while the `contact_memberships` record persists across the whole subscription lifecycle. This is why membership revenue shows up in Orders and Financial Insights the same as book/license purchases.

Each plan carries a `duration_days` (admin-set on `admin-memberships.html`) — for one-time plans (Free w/ Book, 2D Education registration) this is the real membership length; for monthly/annual plans Stripe governs actual billing, so it's only an estimate used for admin display and sizing the renewal-reminder window. A membership's `ends_at` is computed at signup/grant and re-anchored on every real renewal charge (clearing the reminder-sent flag so the next cycle gets its own reminder).

## Automations

A fixed set of six automated emails — book purchase thank-you, membership purchase thank-you (fires on every real charge, first and renewals), membership renewal reminder, invoice-paid confirmation, payment-failed/past-due, and license seat invite — fire from real events across `checkout.js`/`newsletter.js`/`invoices.js`. Each is admin-editable (subject/body with `{{mergeField}}` tokens, on/off, and — for the renewal reminder — how many days ahead of `ends_at` to send) from **`admin-automations.html`**, backed by a fixed `email_automations` table (`server/lib/automations.js`'s `fireAutomation()` is the single call site every trigger uses). Sending failures are swallowed and logged, never propagated — an SMTP hiccup must never block the purchase/invoice/seat action that triggered the email.

The renewal reminder and lapsed-membership expiry both run from **`server/scripts/send-membership-reminders.js`**, this project's first scheduled job — set up as a daily cPanel Cron Job (there's no in-process scheduler; cron survives Node app restarts, which an in-app timer wouldn't).

## Blog & Morning Boost

Blog posts (`blog_posts`) can belong to several categories at once (`blog_post_categories`, mirrors the existing per-post tag system) — the public FN Blogs page's category filter chips check against that full set, not a single value. Posts also carry SEO fields (alt text, meta description, focus keyword) and a `requiresMembership` flag: when set, `/api/blog/posts` strips the body/video server-side for any visitor without an active Fixer Nation membership (any plan) and returns a `locked: true` flag instead — `blog.html` shows a locked preview with a join link. A post with `published` on and a future Publish Date stays off the public site until that date, i.e. real scheduling, not just an on/off toggle.

The full 2026 Morning Boost content calendar (205 daily Theme/Series entries, imported from the step-sheet doc) lives in `morning_boost_calendar`. `admin-blogs.html` can pull any date's Theme/Series straight into a new post ("Load From Morning Boost Calendar"), and **`admin-morning-boost.html`** ("Morning Boost Studio") batch-generates a day's voice-over clips via the ElevenLabs API instead of pasting each script into ElevenLabs one at a time — **not live** until a real `ELEVENLABS_API_KEY` is set in `server/.env` and a voice ID is saved on that page, same deferred-but-complete pattern as Stripe. Automating image generation and video assembly (replacing the ChatGPT/Google-AI image step and the iMovie build) is intentionally deferred — no work has started there.

## CRM & campaigns

Contacts (`admin-newsletter.html`) support search/filter/sort/pagination, a user-configurable column picker, CSV import/export, contact groups, purchase history, and site-account status (registered/verified, resend verification, password reset, delete) — the latter surfaced directly on the contact record rather than a separate page, since a site-user account and a CRM contact are linked only by matching email (no formal foreign key).

Email campaigns (`admin-campaigns.html`) send for real via SMTP, always excluding unsubscribed contacts regardless of any audience filter. Per-campaign analytics (sent/opened/open rate/unsubscribed) are tracked via a `campaign_sends` log table — see the Known Limitations note below on why "opened" is directional, not exact.

## Known limitations

- **Email open-tracking is pixel-based and imprecise.** The SMTP setup is a plain relay (cPanel mailbox), not an ESP with delivery/open webhooks, so opens are tracked via an invisible 1×1 image — many clients block remote images (undercounts), and some (e.g. Apple Mail Privacy Protection) pre-fetch every image regardless of whether a human opened it (overcounts). Plain-text campaigns can't be tracked at all (no way to embed a pixel). Treat the numbers as directional.
- **Stripe checkout isn't live yet** — see Licensing & checkout and Memberships above.
- **ElevenLabs voice-over generation isn't live yet** — see Blog & Morning Boost above. Image generation and video assembly for Morning Boost remain fully manual by design (deferred, not started).
- **The renewal-reminder/expiry cron depends on the cPanel Cron Job staying configured** — if it's ever removed or misconfigured, reminders/expirations just silently stop (no alerting on a missed run). Verify with `node scripts/send-membership-reminders.js` in cPanel Terminal if renewal reminders seem to have stopped.
- **No automated tests.** All verification is manual (curl with cookie jars, or the browser) after each deploy.
- **`-v2` pages are frozen** by original project decision, not neglected.
- **`privacy-choices.html`'s "we don't sell/share data" framing reflects what's actually implemented today** — no third-party ad trackers, no data brokers, sessionStorage-only anonymous analytics. This isn't legal advice; if a real third-party data relationship is ever added, that page needs to be revisited. The analytics opt-out toggle on that page sets a real `localStorage` flag (`fnAnalyticsOptOut`) that `fnTrackEvent`/`fnTrackPageview` check before firing.
- Full change history lives in `CHANGELOG.md`, not inline in this file.

## Assets

- Book covers: `cover-kill-the-bully.png`, `cover-your-past.png`, `cover-5-brains.png`, `cover-how-to-lie.png` — pre-cut artwork with transparent backgrounds and built-in drop shadows.
- Book trailer videos: `trailer-kill-the-bully.mp4`, `trailer-your-past.mp4`, `trailer-5-brains.mp4` (no trailer for "How to Lie").
- Author photo: `anthony.png`.

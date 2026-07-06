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
| Join / Membership pricing | join.html | join-v2.html |
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
| Blog builder (CRUD, live on the public FN Blogs page) | admin-blogs.html |
| Contacts Management — CRM (search/filter/sort, columns picker, purchases, site-account status) | admin-newsletter.html |
| Email campaigns (real SMTP send, open/unsubscribe analytics) | admin-campaigns.html |
| License products, school-domain lookup/management | admin-licenses.html |
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

## CRM & campaigns

Contacts (`admin-newsletter.html`) support search/filter/sort/pagination, a user-configurable column picker, CSV import/export, contact groups, purchase history, and site-account status (registered/verified, resend verification, password reset, delete) — the latter surfaced directly on the contact record rather than a separate page, since a site-user account and a CRM contact are linked only by matching email (no formal foreign key).

Email campaigns (`admin-campaigns.html`) send for real via SMTP, always excluding unsubscribed contacts regardless of any audience filter. Per-campaign analytics (sent/opened/open rate/unsubscribed) are tracked via a `campaign_sends` log table — see the Known Limitations note below on why "opened" is directional, not exact.

## Known limitations

- **Email open-tracking is pixel-based and imprecise.** The SMTP setup is a plain relay (cPanel mailbox), not an ESP with delivery/open webhooks, so opens are tracked via an invisible 1×1 image — many clients block remote images (undercounts), and some (e.g. Apple Mail Privacy Protection) pre-fetch every image regardless of whether a human opened it (overcounts). Plain-text campaigns can't be tracked at all (no way to embed a pixel). Treat the numbers as directional.
- **Stripe checkout isn't live yet** — see Licensing & checkout above.
- **No automated tests.** All verification is manual (curl with cookie jars, or the browser) after each deploy.
- **`-v2` pages are frozen** by original project decision, not neglected.
- **`privacy-choices.html`'s "we don't sell/share data" framing reflects what's actually implemented today** — no third-party ad trackers, no data brokers, sessionStorage-only anonymous analytics. This isn't legal advice; if a real third-party data relationship is ever added, that page needs to be revisited. The analytics opt-out toggle on that page sets a real `localStorage` flag (`fnAnalyticsOptOut`) that `fnTrackEvent`/`fnTrackPageview` check before firing.
- Full change history lives in `CHANGELOG.md`, not inline in this file.

## Assets

- Book covers: `cover-kill-the-bully.png`, `cover-your-past.png`, `cover-5-brains.png`, `cover-how-to-lie.png` — pre-cut artwork with transparent backgrounds and built-in drop shadows.
- Book trailer videos: `trailer-kill-the-bully.mp4`, `trailer-your-past.mp4`, `trailer-5-brains.mp4` (no trailer for "How to Lie").
- Author photo: `anthony.png`.

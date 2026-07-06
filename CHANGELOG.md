# Changelog

All notable changes to the Fixer Nation Education platform (fixernationeducation.com), grouped by release. Dates are when each release was deployed to production.

> **Maintenance convention:** add a new release section at the top of this file every time a feature or fix is completed and deployed — see `CLAUDE.md` for the exact rule. Keep entries short and user/business-facing (what changed and why it matters), not a line-by-line diff.

## Unreleased / Known pending work

- **Incident (2026-07-04):** a deploy using `--delete-excluded` in the rsync command (meant to clean up two stray doc files exposed on production) instead deleted `public_html/api/`, the cPanel-generated proxy glue folder — this broke every API route, including admin and site login, until the Node app was stopped/started in cPanel to regenerate it. `--delete-excluded` has been removed from the documented deploy command in `CLAUDE.md` for good; stray doc files get deleted manually, one-off, from now on.

- **Stripe card checkout** (individual teacher license purchase on `licenses.html`, and the Stripe option in the cart/PO checkout flow) is coded and pushed but **not live** — blocked on the admin obtaining real Stripe API keys (`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`). Purchase Order (PO) checkout requires no Stripe keys and is fully live today.
- **Deeper bounce detection** — today's bounce/undelivered tracking only catches failures the mail server reports immediately at send time. Catching the far more common case (a bounce that arrives later as its own email) would need IMAP access to the sending mailbox, a bounce-message parser, and a periodic cron job — deliberately deferred as a second phase; ask if this becomes a real gap.
- **Migrate off plain SMTP to a real ESP** (SendGrid, Postmark, Amazon SES, etc.) with native delivery/open/bounce/complaint webhooks — this would replace the current pixel-and-click-tracking guesswork entirely with accurate, real-time data straight from the provider. Bigger infrastructure change (new account, API integration, likely a cost) — not started.
- No automated test suite exists yet.
- The `-v2` alternate design pages across the site are frozen/static by original project decision — not a bug, not scheduled for further work.

---

## Release 18 — 2026-07-06 — Automated emails + membership duration/expiration tracking

- **Six automated emails now fire on real events**, each admin-editable (subject, body, on/off, and reminder timing) from a new "Automations" page: book purchase thank-you, membership purchase thank-you (fires on every real charge — first purchase and every renewal), membership renewal reminder, invoice-paid confirmation, payment-failed/past-due notice, and license seat invite (when a school admin assigns a teacher's email to an open seat). All six use simple `{{mergeField}}` templates and fail silently on their own (an SMTP hiccup never blocks the purchase/invoice/seat action that triggered them).
- **Membership plans now track a real duration** (`duration_days` — e.g. 90 for the book-purchase perk, 30/365 for monthly/annual tiers) instead of just describing it in copy. Each membership's estimated expiration (`ends_at`) is computed at signup/grant and re-anchored on every real renewal charge, shown on the Members tab of `admin-memberships.html`.
- **A new daily cron job** (`server/scripts/send-membership-reminders.js`, run via cPanel Cron Job — this project's first) sends the renewal reminder to anyone within the configured window of their `ends_at`, and expires any membership whose date has passed with no renewal.
- Fixed a real bug surfaced while building this: `admin-memberships.html`'s status dropdown was wiping a membership's `ends_at` back to `NULL` on any status change other than cancel/expire (e.g. `past_due` → `active`) — it now only touches `ends_at` on an actual cancel/expire/reactivate transition.
- Also: the membership/subscription system from the previous session (Free w/ Book, Monthly/Annual Consumer + Service Provider tiers, 2D Education registration, Brand Ambassador — `join.html`, `service-providers.html`, `brand-ambassador.html`, `admin-memberships.html`, Stripe subscription checkout) is confirmed **deployed and live** — this changelog just never got a numbered entry for it at the time. Stripe checkout itself is still not live pending real API keys, same as license checkout.

## Release 17 — 2026-07-05 — Real Contact Us page, removed dead Reviews link

- **New "Contact Us" page**, wired to the footer "Contact" link that previously went nowhere (`href="#"`). Emails a newly admin-configurable "General Contact" address — same Settings card as the other contact-form routing.
- **Removed the dead "Reviews" footer link** (there's no reviews feature on the site) and fixed a books.html section that was mislabeled "Reviews" when it's actually about the included 90-day membership.

## Release 16 — 2026-07-05 — Your Privacy Choices page

- **New "Your Privacy Choices" page**, linked from the footer of every public page (previously a dead link buried under the Request a Quotation form). States plainly that Fixer Nation doesn't sell or share personal information with third parties, explains what actually is collected (contact info submitted directly, and anonymous session analytics with no persistent cookie), and includes a real request form (access / delete / opt-out) that emails a newly admin-configurable "Privacy Requests" address — same Settings card as the Ask The Fixer/Quote routing.
- **A real analytics opt-out toggle** on that page — flips a `localStorage` flag that every page's tracking call checks before firing, so a visitor can turn off anonymous session tracking entirely on their device, not just a symbolic toggle.
- Not legal advice — this reflects what's actually implemented in this codebase (no third-party ad trackers, no data brokers, sessionStorage-only analytics). If that ever changes, this page and its "we don't sell data" framing need to be revisited.

## Release 15 — 2026-07-05 — Configurable contact-form email routing, homepage rename

- **Settings now has a "Contact Email Routing" card**: the admin can set which inbox "Ask The Fixer" and "Request a Formal Quotation" submissions get emailed to, instead of it being hardcoded to `admin@fixernationeducation.com`. Both default to that same address until changed, so nothing changes unless an admin actually edits it.
- **Settings also has a new "Invoice Branding" card**: business name, tagline/footer line, and a logo upload, shown at the top and bottom of every printed/emailed invoice in place of the old hardcoded "Fixer Nation" text. No logo uploaded yet shows the same "FN" mark as before.
- **Homepage renamed from `fixernation-redesign.html` to `index.html`**, and the last leftover "redesign"/mockup wording (the browser tab title, and a placeholder line on the FN Blogs page) was cleaned up — every reference across the site, admin backend, and email-verification links now points to the new name. The bare domain root now resolves directly to the homepage. The frozen `-v2` alternate-design pages are intentionally left as-is (a prior, separate decision — not part of the live site).

## Release 14 — 2026-07-05 — Visitor Paths becomes a traffic funnel

- **Traffic Funnel** replaces the plain stat list at the top of Visitor Paths (`admin-analytics.html`) with a funnel-mapping-style visual: Visited the site → Explored content → Showed buying/contact intent, with the drop-off percentage between each stage called out directly. A date-range picker (7/30/90 days or custom) controls the window, defaulting to the last 30 days.
- A chip row breaks the "intent" stage down by the specific action (added to cart, requested a quote, asked the Fixer), so an admin can see not just how many visitors reached that stage but what they were about to do.
- There's deliberately no "purchased" stage — analytics sessions are anonymous by design with no link to a purchase record, so the funnel stops at intent, not conversion. The existing Top Entry Pages and Most-Opened Objects are unchanged.
- **The per-session "Visitor Path" modal is now a graphical journey map** instead of a plain text list: connected icon nodes showing exactly where a visitor entered, which pages they viewed, and which specific objects they interacted with (a book/product, a curriculum resource, adding to the cart, requesting a quote, Ask The Fixer) — color-coded by category (entry, engagement, buying/contact intent) so the shape of a visit is readable at a glance.

## Release 13 — 2026-07-05 — Admin visual redesign, with a light/dark theme

- **Full visual refresh of the admin backend**: moved off the old generic indigo/navy look to a palette drawn from Fixer Nation's own brand (teal, coral, gold), so the admin dashboard and the public site finally feel like one product. Flatter cards, pill-shaped nav highlights, and softer borders replace the old heavier drop shadows.
- **Dark theme**, toggled from a sun/moon switch in the topbar of every dashboard page. Defaults to the browser's system preference on first visit, then remembers your choice. Every color used across the shared admin stylesheet — cards, tables, pills, modals, buttons, chart bars — has a matching dark-mode value, not just an inverted filter.
- The admin login screen keeps a fixed brand-teal gradient regardless of the dashboard's theme setting (a deliberate exception, matching how most products treat their sign-in screen as a fixed brand moment).

## Release 12 — 2026-07-04 — Admin management, and invoice linking on the Dashboard

- **Admins (Settings)** got a full set of management controls per admin: resend a pending admin's invite email, send an active admin a password-reset link, edit their username/email, or delete their account. An admin can't delete their own account, and the last remaining admin can never be deleted — the site always keeps a way in.
- **Purchase Order Invoices Issued** on the Dashboard's Financial Insights now links out just like "Sales Today"/"Sales All-Time" do for orders: the paid/unpaid/cancelled counts are each a distinct link straight to a pre-filtered Invoices list. The stat label itself was renamed from "Invoices Issued" to "Purchase Order Invoices Issued" for clarity (all invoices on this site come from PO checkouts, not card payments).
- Invoices can now be filtered by status directly on `admin-invoices.html` via a dropdown, in addition to arriving pre-filtered from the Dashboard link.

## Release 11 — 2026-07-04 — Visitor path tracking and a real Insights section

- **New "Visitor Paths" dashboard**: anonymous, session-based tracking of how people navigate the public site — entry page, the sequence of pages visited, and key interactions (book views, add-to-cart, curriculum resource/quiz opens, quote requests, Ask The Fixer submissions). No names, emails, or IP addresses are stored — sessions are pseudonymous and reset when a visitor closes their browser tab. Click any recent session to see its full path.
- Replaced the static "Recommended Insights To Track Next" list on the Dashboard with a real, computed **Insights** section: month-over-month growth, quote-to-sale conversion rate, revenue by category (books vs. single-teacher licenses vs. school/group licenses), days sales outstanding, customer lifetime value, and invoice cancellation rate.

## Release 10 — 2026-07-04 — Bounce/undelivered tracking, click tracking, and per-campaign activity view

- **Bounce/undelivered classification**: a failed send is now recorded as "Bounced" (the mail server permanently rejected the address) or "Undelivered" (a temporary failure or connection issue) instead of one generic "failed" bucket.
- **Link-click tracking** for HTML campaigns: every link in the email body is rewritten to route through a tracking redirect, giving a second, independent signal that an email was actually opened (useful when images are blocked, since pixel tracking alone would miss it).
- **Per-campaign activity view**: click any campaign's subject to see exactly who opened, unsubscribed, bounced, or was undelivered — by email address, not the full recipient list.
- Added a reminder in the campaign composer that open/click tracking only works for HTML campaigns, and Bounced/Undelivered stat cards to the campaigns dashboard.

## Release 9 — 2026-07-04 — Orders dashboard, sales date range, and dashboard polish

- **New Orders dashboard** (`admin-orders.html`, nav link under Licenses): every purchase across every contact, newest first, with a date-range filter. The Financial Insights "N orders" figures on the main Dashboard now link directly into it (Sales Today → today's orders, Sales All-Time → everything).
- **Sales Over Time** now supports a custom start/end date range instead of a fixed 14-day window (still the default).
- **Dashboard sections are collapsible** — Financial Insights and Content can each be hidden, remembered per browser.
- **Campaigns can be duplicated** — a new "Duplicate" action creates a fresh Draft copy of any campaign's subject/body/format/audience, leaving the original's send history and stats untouched.
- Fixed the open-tracking pixel's reliability (some mail clients skip fetching images that are never rendered) and clarified in the campaign list/detail view that plain-text campaigns show "N/A" for opens rather than a misleading "0" — a plain-text email has no HTML to carry a tracking pixel at all.

## Release 8 — 2026-07-04 — Contacts column picker & campaign analytics

- **Contacts Management** (`admin-newsletter.html`): a "🔧 Columns" picker lets the admin choose which table columns to show or hide, remembered per browser. (Ascending/descending column sorting already existed and needed no changes.)
- **Email campaigns now track opens and unsubscribes per send.** A new `campaign_sends` table logs one row per (campaign, recipient) attempt. A tracking-pixel endpoint records opens on HTML campaigns; unsubscribe links now attribute the click back to the specific campaign that caused it. Campaign list, stat cards, and the View Campaign modal all surface Sent/Opened/Open Rate/Unsubscribed.
- Open tracking is pixel-based (plain SMTP has no delivery/open webhooks), so it's directional, not exact — flagged directly in the admin UI.

## Release 7 — 2026-07-04 — Financial Insights dashboard

- **Resend Invoice**: a new action on `admin-invoices.html` emails the invoice (line items + total) to the buyer again.
- **Financial Insights** section added to the main admin Dashboard: sales today/this week/this month/all-time, revenue collected vs. outstanding, average order value, a 14-day sales chart, best-selling item, invoices issued (with paid/unpaid/cancelled breakdown), quotes issued, and active customers in the last 30 days — plus a list of recommended future insights (month-over-month growth, quote-to-sale conversion, revenue by category, days-sales-outstanding, customer lifetime value, cancellation rate).
- "Request a Formal Quotation" submissions are now stored in the database (`quote_requests` table) — previously email-only with no record kept, so "Quotes Issued" is a real number.

## Release 6 — 2026-07-04 — Site-user accounts consolidated into the CRM

- Site-user account status (registered/verified, send password reset, delete account) now lives directly on the matching CRM contact's Edit modal instead of a separate "Registered Site Users" page in Settings — the two records are linked by email since there's no formal database relationship between them.
- Added an ad-hoc "resend verification email" action to every CRM contact row.
- Renamed the CRM page from "Newsletter CRM" to "Contacts Management."

## Release 5 — 2026-07-03 — Contact forms, curriculum resources, and checkout refinements

- "Ask The Fixer" and "Request a Formal Quotation" forms now actually send an email to `admin@fixernationeducation.com` — both were previously non-functional stubs that only showed a fake success message.
- Curriculum builder: replaced the free-text "Estimated Duration" field with structured Lessons/Weeks number fields, and added a distinct file upload per Included Resource (previously all resources pointed at one shared document).
- Lesson quiz: answer options are now lettered (A, B, C…) without revealing the correct answer inline; a separate Answer Key section lists correct answers at the bottom of the quiz.
- Admin invoices: added Cancel (soft, keeps any granted seats/licenses intact) and Delete (hard) actions.
- Cart checkout: school email is only requested for license-product purchases — a book-only order uses the logged-in customer's own account email instead.
- Fixed book-card action buttons (Details/Amazon/Add to Cart) rendering at unequal widths; they now wrap to two lines instead of truncating.
- Real Amazon per-format pricing (Kindle/Hardcover/Paperback) replaces the old generic bulk-pricing tiers on all 4 book detail pages — only formats that actually have a price show up.

## Release 4 — 2026-07-03 — Admin nav, licensing, and invoicing polish

- Alphabetized the admin sidebar nav and moved Settings to the bottom.
- Added "Call For Quote" pricing for license orders over 1,000 seats.
- Added an admin-invite system (email-verified, token-based) so a new admin can be added without sharing the single login.
- Regrouped the admin nav: Dashboard isolated at the top, a divider, then the content-management pages.
- Added invoicing for Purchase Order (PO) checkouts — auto-numbered invoices (`INV-00001` style), a printable invoice view, and Mark Paid/Unpaid that cascades to every purchase the invoice groups.

## Release 3 — 2026-07-03 — CRM overhaul, license catalog, and Purchase Orders

- Added phone, company, and notes fields to CRM contacts, plus a one-off script that imported a real 4,022-contact list from a Constant-Contact-style export.
- Overhauled the CRM contacts table: real search, filtering, sorting, and pagination (previously an unfiltered flat list).
- Added an admin-editable license product catalog (`admin-licenses.html`), a real shopping cart (`cart.html`, works across books and license products together), and a Purchase Order checkout path that grants access immediately without requiring a card.
- Added school-domain license lookup and management for admins — search a school's email domain to see their whole seat roster, adjust seat count, or delete the license entirely if they cancel.
- Full admin editing of customer accounts and licensing (not just add/delete): edit a purchase's notes/seat count, manually register or unregister a seat, edit a customer's name/email, or trigger a password reset on their behalf.

## Release 2 — 2026-07-02 to 2026-07-03 — Licensing & purchase-tracking foundation

- Added purchase/license tracking to the CRM: an admin can log a book, single-teacher-license, or group-license purchase against any contact; group licenses generate open seats that a school administrator fills with teacher emails, either from the admin CRM or self-service (`my-license.html`).
- Signing up with an email that matches a pending seat auto-claims it — the mechanic that drives license-based page access.
- Curriculum lesson documents and quizzes are now gated behind an active teacher license (public preview content — theme, objectives, overview — stays visible either way).
- Built (but not yet deployed — see Unreleased above) self-service Stripe checkout for individual teacher licenses.
- Bulk-imported 71 "Morning Boost" lesson-plan curricula as drafts, ready for review.

## Release 1 — 2026-07-02 — Real backend foundation

- Replaced the original browser-`localStorage`-only admin demo with a real Node/Express + MariaDB backend, hosted on Hosting.com/cPanel.
- Real JWT-cookie admin authentication (replacing a client-side-only demo login with a password visible in page source).
- Wired Books, Curriculum Builder, Blog, Newsletter CRM, and Email Campaigns admin pages to the real database-backed API.
- Real SMTP email sending for campaigns (previously simulated — "Send Now" just logged a fake timestamp).
- Public site-user accounts: sign up, email verification, log in/out, forgot/reset password — with a shared login/signup modal rolled out to every public page.
- Wired book detail pages to the real book records (price, stock status, description, cover, Amazon link).
- Assorted fixes: HTTPS redirect, cache-busting for shared admin JS/CSS, consistent admin nav labels, "View Site" links opening in a new tab.

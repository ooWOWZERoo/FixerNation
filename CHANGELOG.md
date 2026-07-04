# Changelog

All notable changes to the Fixer Nation Education platform (fixernationeducation.com), grouped by release. Dates are when each release was deployed to production.

> **Maintenance convention:** add a new release section at the top of this file every time a feature or fix is completed and deployed — see `CLAUDE.md` for the exact rule. Keep entries short and user/business-facing (what changed and why it matters), not a line-by-line diff.

## Unreleased / Known pending work

- **Stripe card checkout** (individual teacher license purchase on `licenses.html`, and the Stripe option in the cart/PO checkout flow) is coded and pushed but **not live** — blocked on the admin obtaining real Stripe API keys (`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`). Purchase Order (PO) checkout requires no Stripe keys and is fully live today.
- No automated test suite exists yet.
- The `-v2` alternate design pages across the site are frozen/static by original project decision — not a bug, not scheduled for further work.

---

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

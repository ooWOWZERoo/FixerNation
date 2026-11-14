# Sales and CRM update: kickoff notes for the planning session

Written 2026-11-14 at the end of the prospect demo work, so a fresh session can start planning without re-discovering what exists. **Nothing is decided and nothing is built.** The owner has said only that a big sales/CRM feature update is coming and that planning starts in a new session. What the update should do is for the owner to say; the first job of the session is to ask.

## How to run the session (the project's own rules)

1. **Requirements before code** for anything touching access control, billing or auth (CLAUDE.md). Write `docs/reference/sales-crm-update-requirements.md`: the owner's asks in their words, what is true today (read in the code), the access matrix (role x action), numbered decisions D1, D2 ... each with a recommendation, the phases, the tests that must exist, the risks. Get the decisions confirmed ("Accept all" worked well for the demo plan), then build one phase at a time, each its own release.
2. Check the earlier requirements docs below before proposing anything that overlaps them.
3. Every customer-visible change also needs a draft release note and a how-to video (CLAUDE.md). Admin-only changes need neither, but still need the CHANGELOG entry and the video check on each commit.
4. Give push and deploy steps with every release, with the full `cd /home/fixernat/...` paths and the nodevenv prefix; alter scripts run before the restart.
5. Start a fresh session per phase. This one's history is long.

## Questions to put to the owner first

- What is driving the update: closing deals faster, seeing the pipeline, following up with prospects, reporting, handing leads to salespeople or affiliates, something else?
- Who uses it: the owner alone, a small sales team, affiliates, district staff? (This decides the access matrix.)
- What hurts today in Quotes, Orders, Invoices, Newsletter contacts, Campaigns, Automations and the demo hand-off? Which screens do they actually open each day?
- What must a "deal" or "opportunity" be here (a quote? a purchase order? a district?), and does one organization have many contacts?
- What does success look like in a month (a number, a screen, a saved hour)?
- Anything outside the product, such as an existing CRM, email provider or spreadsheet, that this must read from or replace?

## What exists today (from file names, nav and schema; not read in full)

**Admin pages (Sales group in `admin-nav.js`):** Quotes (`admin-quotes.html`), Orders, Invoices (`admin-invoices.html`, print page), License Products, **Demo** (invitations per group, with tickets and quotes tagged by group), Support Inbox, Account Lookup, Classrooms and Parents, Errors, Help Content, School Admins, Districts, Affiliates, Curriculums. The Marketing and CRM group holds Newsletter (`admin-newsletter.html`, the contacts), Campaigns, Automations; Mission Control is pinned. Check the `SECTIONS` array in `admin-nav.js` for the real grouping.

**Routes (line counts):** `routes/newsletter.js` (1,234, contacts and groups), `routes/campaigns.js` (655), `routes/automations.js` (126, `fireAutomation` in `lib/automations.js` is the single call site for auto-emails), `routes/contact.js` (571, public quote form and the admin quote list), `routes/invoices.js` (377), `routes/affiliates.js` (1,302) with `affiliate-portal.js`, `quote-accept.js`.

**Tables:** `newsletter_contacts`, `contact_groups`, `contact_group_members`, `purchases`, `license_seats`, `quote_requests`, `invoices`, `campaigns`, `campaign_sends`, `campaign_link_targets`, `email_automations`, `automation_executions`, `affiliates`, `affiliate_applications`, `affiliate_commissions`, `territories`, `affiliate_territories`, `territory_requests`, `support_requests`, `public_demo_invitations`. `SCHEMA.md` and `server/db/schema.sql` are the references (the owner has uncommitted schema docs in the working tree: `SCHEMA.md`, `docs/reference/database-schema-*.sql`, `schema-drift-2026-11-14.txt`).

**Earlier requirements docs that bear on this (read before proposing):** `crm-record-of-truth-requirements.md` (the CRM is the record of who is on the platform; Community follows it; deleting a contact closes the account), `quote-added-seats-requirements.md`, `po-license-activation-requirements.md`, `invoice-bill-ship-to-requirements.md`, `seat-counts-requirements.md`, `affiliate-whole-state-requirements.md`, `morning-boost-recipient-group-requirements.md`, `district-dashboard-requirements.md`, `sales-demo-accounts.md`, `shared-demo-workspaces-requirements.md`, `security-and-access-rules.md`. The affiliate and territory history is in `docs/AFFILIATE_*_SPIKE.md`. The sales deck and demo run sheet are in `docs/sales/` (untracked, the owner's).

## Rules and gotchas that will shape the design

- **Two separate auth systems** (admin `fn_session` vs site-user `fn_user_session`); never mix them. Any new staff-facing sales role is a third kind of person: see the district-admin precedent (memory `fixernation-district-admin-role-pattern`) and write the access matrix first.
- **Deleting a CRM contact cascades** to `purchases`, `invoices` and `contact_group_members`, and a purchase takes its `license_seats`. The contact-delete route refuses a contact that owns a purchase or invoice, and deleting a contact with a sign-in account closes the account (`lib/account-closing.js`).
- **The CRM is the record of truth for who is on the platform** (Release 110 to 114): community membership follows it.
- **Set `payment_status` explicitly** on already-paid purchases (memory `fixernation-payment-status-drift-gotcha`).
- **Email**: all of it goes through `lib/mailer.js`; the demo guard depends on that. Campaign tracking is pixel and link based (bounce detection is shallow; moving to a real email provider is already a known backlog item).
- **Public repo**: never commit real contact data, names of prospects, prices-in-negotiation or credentials. The demo group names are staff-only for the same reason.
- **Demo to CRM link**: tickets and quotes from a group's demo carry `demo_invitation_id`, and Sales > Demo shows per-group visits, sign-ins, tickets and quotes. Any pipeline view should consider treating a demo invitation as a pipeline event.
- **No customer data in tests**: use `@example.com` addresses; real-SQL tests run on `node:sqlite` (keep SQL portable).
- Admin escaping rule: anything from outside the admin's keyboard goes through `fnEscape()`, and into `data-` attributes, never inline handlers.
- Production database is not reachable from the dev machine: read-only diagnostic scripts the owner runs on cPanel (like `scripts/check-original-demo-use.js`) are the pattern for checking real data before deciding.

## Open items from the demo work that belong in the owner's to-do list

Live try-out of a group invitation, and the workspace pool check with the leftover test invitation(s). Both are in `docs/BACKLOG.md`.

# Merging the two contact screens into one: requirements and inventory

Status: **draft for the owner's decisions (2026-11-23). Nothing here is built except phase 1's pop-up, which is a stepping stone.** Per the project's own rule, nothing that touches access, money or accounts is built before the access table (section 5) and the decisions (section 8) are confirmed.

## 1. The goal, in the owner's words

End with **one** contact screen going forward. The new Customer Hub contact page (`admin-crm-contact.html`, with its list `admin-crm-contacts.html`) should survive, and the older CRM page (`admin-newsletter.html`, called "CRM" in the side menu) should go. **Nothing may be orphaned**: no feature, process, flow or connection that works today may stop working, or stop being reachable, without an explicit decision.

How "100% sure" is achieved (section 7): every control, function, route and link on the old page is listed below with where it will live, and a test (built in phase 0, after this list is confirmed) fails if the old page or its routes gain or keep anything that is not on the list.

## 2. What exists today

### 2.1 The two screens

| | Older CRM page (`admin-newsletter.html`, 1,459 lines) | Customer Hub (`admin-crm-contacts.html` list, `admin-crm-contact.html` person) |
|---|---|---|
| API | `/api/newsletter/*` (`routes/newsletter.js`), `requireAuth` only | `/api/crm/contacts/*` (`routes/crm-contacts.js`), `requireAuth` + `requireCrm('<action>')` |
| Works with the Hub switch off | **Yes** | **No** (404 while `crm_v2_enabled` is not `true`) |
| Who may use it | any signed-in admin, including a Read-only CRM role | role matrix (`lib/crm-permissions.js`) |
| Loads | all contacts at once (about 4,000), filters and sorts in the browser | one page at a time, filters and paging on the server |

### 2.2 Everything on the older page (this is the list nothing may fall off)

**List (the table)**

| # | Feature | Today |
|---|---|---|
| L1 | Search by name, email, phone, company | browser-side |
| L2 | Filter by email group | browser-side |
| L3 | Filter by subscription status (Subscribed / Unsubscribed) | browser-side |
| L4 | Filter by source | browser-side |
| L5 | Filter by Customer Hub label (shown only when the Hub is on) | browser-side |
| L6 | Sort by name, email, company, signed up, source, status, role, grade levels | browser-side |
| L7 | Paging | browser-side |
| L8 | Column picker: Name, Email, Phone, Company, Address, Signed Up, Source, Status, Role, Grade Levels, Groups, plus the label column; remembered per browser | `localStorage` |
| L9 | Name links to the Customer Hub person page | link out |
| L10 | Row buttons: Purchases and Licenses, Edit, Unsubscribe or Resubscribe, Delete, Resend verification | see below |

**Toolbar**

| # | Feature | Notes |
|---|---|---|
| T1 | **+ Add Contact** | `POST /api/newsletter/contacts`; the Hub has its own **+ Add a person** (`POST /api/crm/contacts`, fewer fields) |
| T2 | **Manage Groups**: list, add, delete email groups | `GET/POST/DELETE /api/newsletter/groups`; groups feed Campaigns, Morning Boost, Licenses |
| T3 | **Import CSV**  (name, email, phone, company, address, signup date, source, notes, groups; creates missing groups; fills blanks only, never changes status or source, group membership only adds) | `POST /api/newsletter/contacts/import`. **A second importer exists in the Hub** (**Import people**, with Import review and undo). |
| T4 | **Export CSV** (respects the current filters; 14 columns including Grade Levels and Groups) | browser-side; has an e2e test (`crm-export-respects-filters`) |

**Edit Contact box (the "contact card")**

| # | Field or action | Today |
|---|---|---|
| E1 | Name, email (required), phone, company | `PUT /api/newsletter/contacts/:id` |
| E2 | Street, city, **state**, ZIP | same |
| E3 | Ship To name, company, street, city, state, ZIP (used on invoices) | same; see `invoice-bill-ship-to-requirements.md` |
| E4 | Source | same |
| E5 | Subscription status | same |
| E6 | Groups (search and pick many) | same |
| E7 | Notes (the contact's own free-text note, **not** the Hub's Notes panel) | same |
| E8 | **Site Account** block: whether the person has a sign-in account and whether it is verified | read |
| E9 | Resend verification email | `POST /contacts/:id/resend-verification` |
| E10 | Send a password reset to the site account | `POST /api/site-auth/site-users/:id/send-password-reset` |
| E11 | **Delete the site account** | `DELETE /api/site-auth/site-users/:id`; irreversible |
| E12 | **Roles and Assignments** (teacher, school and district administrator, seats, audiences; read-only) | `GET /contacts/:id/roles` |
| E13 | Add or edit also runs duplicate-email handling | `crm-contact-email-duplicate.test.js` |

**Row actions**

| # | Feature | Today |
|---|---|---|
| R1 | Unsubscribe or resubscribe (toggle) | `PUT` with a status |
| R2 | Delete the contact. **Refused** when the person owns a purchase or invoice (purchases and invoices cascade-delete with a contact; a purchase takes its seats) | `DELETE /contacts/:id`, 409 `contact_owns_purchases`; closes the sign-in account (`lib/account-closing.js`) |

**Purchases and Licenses box (per person)**

| # | Feature | Today |
|---|---|---|
| P1 | List the person's purchases and licenses, with the invoice link (`admin-invoice-print.html?id=`) | `GET /contacts/:id/purchases` |
| P2 | **+ Add Purchase** by hand (type, product, seats, dates, amount, payment status) | `POST /contacts/:id/purchases`; calls `crmHooks.purchaseChanged` |
| P3 | Edit a purchase | `PUT /purchases/:id` |
| P4 | Mark as Paid | `PUT /purchases/:id` (see the payment-status drift note in memory) |
| P5 | License dates | `PUT /purchases/:id/license-dates` |
| P6 | Delete a purchase | `DELETE /purchases/:id` |
| P7 | Seats: assign an email, register directly, free a seat, set a seat's audiences | `PUT/POST /purchases/:id/seats/...`, `PUT /seats/:id/audiences` |
| P8 | Purchases by school domain (also used by the Licenses page) | `GET/DELETE /purchases/by-domain` |

**Links out of the older page:** the person page, `admin-districts.html`, `admin-school-admins.html`, `admin-invoice-print.html`.

### 2.3 Everything the Customer Hub contact screens already do (so nothing is built twice)

List: tabs for Contacts, Possible duplicates, Import review and Imports (with undo); **Import people**; **+ Add a person**; label filters and counts; paging on the server. Person page: label and its history, Move to Prospect, Mark as Customer and release, Check again, **Merge into another**, **Owner**, Last contacted, the **Purchases and the Customer rule** table (read-only), Accounts, Deals, Quotes, and the Notes, Tasks, Meetings and Timeline panels (`crm-panels.js`). Edit-in-place today: **only the Owner**.

### 2.4 Gaps: on the older page, not on the Hub screens

L2 to L8 (group, source and status filters, column picker, role and grade columns), L10 (row buttons), T2 (groups), T3's group and address columns, T4 (export), E1 to E13 except Owner, R1, R2, P1 to P8. **This is the whole job.**

## 3. Every connection to and from the older page

**Pages and menus that open it:** side menu **CRM** (`admin-nav.js`), two buttons on `admin-dashboard.html` ("Manage Newsletter Contacts", "View All"), the new link on the contact page (phase 1 replaces it), and these end-to-end tests: `newsletter-subscribe`, `admin-newsletter`, `admin-crm-smoke`, `crm-export-respects-filters`.

**Other pages that call `/api/newsletter/*` (these keep working whatever happens to the older page, because the routes stay until each caller is moved):**

| Caller | Uses |
|---|---|
| `index.html` (public sign-up) | `POST /contacts` (public, rate-limited) |
| `lib/mailer.js` (every marketing email's link) | `GET /unsubscribe` |
| `admin-quotes.html` | `GET /contacts/search` |
| `admin-campaigns.html`, `admin-morning-boost-email.html`, `admin-licenses.html` | `GET /groups`, and contacts for campaigns |
| `admin-licenses.html` | `/purchases/by-domain`, `/purchases/:id`, `/seats/:id/audiences` |
| `admin-orders.html`, `admin-school-admins.html` | `GET /purchases` |
| `admin-dashboard.html` | `GET /contacts` |
| 16 server test files | contacts and purchases routes |

**Server behavior tied to the contact record that the merged screen must keep:** deleting refuses a buyer; deleting closes the sign-in account; a Community seat follows the CRM contact (`lib/community-members.js`); `touchByEmail` and the CRM hooks after a purchase; the Customer rule derives the label in one place (`lib/crm-classification.js`); the CRM never writes purchases itself except through the existing code.

## 4. Proposed end state

- **List:** `admin-crm-contacts.html` gains L2 to L8, T2 (as a button opening a groups box), T4, and the row actions. It keeps its tabs. One importer (decision D2).
- **Person:** `admin-crm-contact.html` gains an **Edit details** pop-up (E1 to E7, E9 to E12 where applicable), the subscription toggle (R1), Delete (R2), and a **Purchases and licenses** section or pop-up (P1 to P8), next to the read-only Customer-rule table it already has.
- **Seat and purchase management:** one home only. `admin-licenses.html` already manages seats by school domain; decision D3 says whether the person-level box moves into the person page or links to Licenses.
- **Retire:** `admin-newsletter.html` becomes a redirect to `admin-crm-contacts.html`, the **CRM** menu item and the two dashboard buttons point at the Hub list, and the four end-to-end tests are rewritten against the new screens. **Only after** every row of section 2.2 is proven live on the new screens (the project rule: never block an old path until its replacement is proven in production).
- **Hub switch:** the merged screens need the Hub on. Decision D7 says what happens if the Hub is ever switched off.

## 5. Access table (to confirm before any build)

Today the older routes only require sign-in, so a **Read-only** CRM role can edit and delete there. The merged screens should use the role matrix. Proposed (admin = CRM Admin, sales = Sales, ro = Read-only):

| Action | admin | sales | ro | Note |
|---|---|---|---|---|
| View a person, the list, export-free browsing | yes | yes | yes | |
| Edit details (E1 to E7), Owner | yes | yes | no | uses `write` |
| Subscription toggle (R1) | yes | yes | no | marketing choice, separate from the label |
| Add a person (T1) | yes | yes | no | |
| Manage groups (T2) and put a person in groups (E6) | yes | yes | no | groups drive campaigns |
| Import (T3) | yes | yes | no | as in the Hub today (`write`); undoing an import stays CRM Admin only (`erase`) |
| Export CSV (T4) | yes | no | no | summary-only export is CRM Admin only today (reports); a contact export carries every address and phone |
| Delete a contact (R2) | yes | no | no | irreversible; refused when it owns purchases |
| Site account: resend verification, password reset (E9, E10) | yes | yes | no | |
| Site account: delete (E11) | yes | no | no | irreversible |
| Purchases: add, edit, mark paid, dates, delete (P2 to P6) | yes | no | no | moves money and access; matches `requireCrmRole` rules for quotes and accept-for-customer |
| Seats (P7) | yes | no | no | grants and frees licenses |

## 6. Phases (each ends with everything still working)

0. **This document, confirmed, plus the guard test** (section 7). No behavior change.
1. **Edit details pop-up on the person page** (name, company, street, city, state, ZIP, phone: part of E1 and E2), so editing no longer leaves the Customer Hub. *Built 2026-11-23.* The email (it moves the sign-in account's email), ship-to, source, subscription, groups, notes and the account block are not in it yet; the person page links to the older page for those until phases 2 and 3 move them.
2. **List parity:** L2 to L8, row actions R1 and R2, T2, T4 on `admin-crm-contacts.html`.
3. **Account block and roles on the person page:** E8 to E12.
4. **Purchases and licenses on the person page:** P1 to P8 (or links to Licenses per D3).
5. **One importer:** T3 settled per D2.
6. **Retire:** redirect, menu and dashboard changes, rewritten tests, docs, release note and help videos re-checked.

Each phase is its own commit and deploy. The old page stays fully working until phase 6.

## 7. How we prove nothing is orphaned

1. A **feature map** (this file's tables) is turned into a small data file: every function name on `admin-newsletter.html`, every route in `routes/newsletter.js`, and every inbound link, each with a status (`stays on the old routes`, `moved to <screen> in phase N`, `dropped, reason`).
2. A **test** fails when the old page or the route file has a function or route that is not in the map, or when a row marked "moved" no longer has its replacement in the new screen's code. That means nothing can be quietly forgotten, and nothing can be added to the old page without a decision.
3. Phase 6 does not start until every row is `moved` and verified in production with `curl` and a signed-in walk-through by the owner.
4. The public and cross-page routes in section 3 are **never removed by this project**; only their last caller can retire them, and that is a separate decision.

## 8. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Is the target `admin-crm-contacts.html` (list) plus `admin-crm-contact.html` (person), with the old page redirecting? | Yes |
| D2 | Two importers exist (old: groups, address, signup date; Hub: review queue and undo). Which survives? | Hub importer, extended with the old one's columns (groups, address, signup date, notes) so nothing is lost |
| D3 | Purchases and seats: person page, or link to `admin-licenses.html`? | A **Purchases and licenses** pop-up on the person page for add, edit, mark paid, dates and delete; seat work stays in Licenses with a link, since Licenses already owns it by school |
| D4 | Roles for the table in section 5 (especially: Sales may not delete, export, or touch purchases) | As in section 5 |
| D5 | Today a Read-only role can edit on the old page. After the merge it cannot. OK? | Yes (this closes a hole) |
| D6 | Keep client-side "load everything" speed for search, or move to server paging only? | Server paging, as the Hub list already does |
| D7 | If the Hub switch is turned off, should the contact screens still work? | The merged contact screens work with the Hub off for viewing and editing (they must, or turning it off would lock staff out of contacts); Hub-only panels hide |
| D8 | Column picker (per browser) and the Role and Grade Levels columns: keep? | Keep the picker; add Role and Grade Levels as optional columns |
| D9 | Keep the "CRM" menu name, or rename the single screen "Contacts"? | Rename to **Contacts** under the Customer Hub group |

## 9. Risks to watch

- **Deleting a contact cascades** (purchases, invoices, group membership, seats): the merged delete keeps the refusal and the account closing.
- **Two sources of truth for the same fields** during phases 1 to 5 (both screens edit the same row): both write the same table, so there is no copy to drift; only the rules (who may edit) differ until phase 6.
- **Hub off** (D7).
- **Large list:** the old page's all-at-once load is fast for staff today; server paging must keep search quick (index on name, email, company).
- **Per-browser column choice** is lost when the page changes name; the new screen should read the old `localStorage` key once.
- **The four end-to-end tests** encode today's flows; they are the best checklist of what staff actually do, so they are rewritten rather than deleted.

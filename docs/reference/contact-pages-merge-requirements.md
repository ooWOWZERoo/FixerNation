# Merging the two contact screens into one: requirements and inventory

Status: **decisions D1 to D9 confirmed by the owner on 2026-11-23 (section 8). Phase 1 (the Edit details pop-up) is built; phases 0 and 2 to 6 are not started.** Per the project's own rule, the access table (section 5) is now the confirmed matrix and each later phase is built once, against it.

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
| R2 | Delete the contact. **Refused** when the person owns a purchase or invoice (purchases and invoices cascade-delete with a contact; a purchase takes its seats), and refused for a Fixer Nation staff account (`staff_account`). If the person has a sign-in account it is closed (`lib/account-closing.js`); when that removes a seat or a role the page asks first (`confirm_close`). When the person has CRM items (tasks, notes, files) a second prompt offers to erase them too, CRM Admin only (`contact_has_crm_items`) | `DELETE /contacts/:id`, 409 `contact_owns_purchases` |

**Purchases and Licenses box (per person)**

| # | Feature | Today |
|---|---|---|
| P1 | List the person's purchases and licenses, with the invoice link (`admin-invoice-print.html?id=`) | `GET /contacts/:id/purchases` |
| P2 | **+ Add Purchase** by hand. Types on the page: `book`, `single_license`, `group_license` (seat count and school domain for a group license). The `book` type loads `GET /api/books?all=true`; FNE sells no books, see D10 | `POST /contacts/:id/purchases`; calls `crmHooks.purchaseChanged` |
| P3 | Edit a purchase | `PUT /purchases/:id` |
| P4 | Mark as Paid | `PUT /purchases/:id` (see the payment-status drift note in memory) |
| P5 | License dates. **Not on the older page**: only `admin-licenses.html` calls this route, so it is not part of the merge | `PUT /purchases/:id/license-dates` |
| P6 | Delete a purchase | `DELETE /purchases/:id` |
| P7 | Seats on a person's group license: **assign an email, register directly, free a seat**. **Only the older page has these three** (the Licenses page does not call them). Setting a seat's audiences is Licenses-only and not part of the merge | `PUT /purchases/:id/seats/:seatId`, `POST .../register`, `POST .../unregister`; (audiences: `PUT /seats/:id/audiences`) |
| P8 | Purchases by school domain. **Licenses page only**; the older page does not use it | `GET/DELETE /purchases/by-domain` |

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

0. **This document and the guard test** (section 7): `docs/reference/contact-pages-feature-map.json` and `server/test/contact-pages-feature-map.test.js`. No behavior change. *Built 2026-11-23.*
1. **Edit details pop-up on the person page** (name, company, street, city, state, ZIP, phone: part of E1 and E2). *Built 2026-11-23.* The rest of the Edit Contact box is not in it yet; the person page links to the older page for it until phase 3.
2. **List parity on `admin-crm-contacts.html`:** L1 to L10 (search, group, status, source and label filters, sorting, paging, the column picker with Role and Grade Levels, row buttons), T2 (groups), T4 (export), R1 (subscription toggle), R2 (delete, with every rule above). Server paging (D6). The contact routes work with the Hub off (D7).
3. **The rest of the person's card:** E1 email (with the sign-in email move and the duplicate-email handling, E13), E3 ship-to, E4 source, E5 subscription, E6 groups, E7 notes, E8 to E12 (site account block, resend verification, password reset, delete account, roles), and T1 (the Hub's **+ Add a person** gets the same fields as the old **+ Add Contact**).
4. **Purchases and licenses pop-up on the person page:** P1 to P4, P6, and the three seat actions in P7 (assign an email, register directly, free a seat). The `book` purchase type per D10. P5 and P8 stay on the Licenses page.
5. **One importer:** T3 (the Hub importer gains groups, address, signup date and notes).
6. **Retire:** first move `createPurchase`, `attachPurchaseDetails` and `assignContactToGroups` out of `routes/newsletter.js` into `server/lib/` (other routes import them, see section 3). Then redirect `admin-newsletter.html`, repoint the **CRM** menu item and the two dashboard buttons (D9), keep the redirect in `mission-control-static-files.txt`, and rewrite the four end-to-end specs. `routes/newsletter.js` itself stays: public sign-up, the unsubscribe link and the Licenses, Quotes, Campaigns, Morning Boost, Orders and School Admins pages still call it.

Each phase is its own commit and deploy. The old page stays fully working until phase 6.

## 7. How we prove nothing is orphaned

1. A **feature map** (this file's tables) is turned into a small data file: every function name on `admin-newsletter.html`, every route in `routes/newsletter.js`, and every inbound link, each with a status (`stays on the old routes`, `moved to <screen> in phase N`, `dropped, reason`).
2. A **test** fails when the old page or the route file has a function or route that is not in the map, or when a row marked "moved" no longer has its replacement in the new screen's code. That means nothing can be quietly forgotten, and nothing can be added to the old page without a decision.
3. Phase 6 does not start until every row is `moved` and verified in production with `curl` and a signed-in walk-through by the owner.
4. The public and cross-page routes in section 3 are **never removed by this project**; only their last caller can retire them, and that is a separate decision.

## 8. Decisions (all confirmed 2026-11-23)

| # | Question | Decision |
|---|---|---|
| D1 | Target screen | **The Customer Hub pair**: `admin-crm-contacts.html` (list) and `admin-crm-contact.html` (person). `admin-newsletter.html` becomes a redirect only after every row of section 2.2 is proven live on them. |
| D2 | Which importer survives | **The Hub importer, extended** with the old one's columns (groups, address, signup date, notes), keeping review and undo. The old importer is retired in phase 6. |
| D3 | Purchases and seats | A **Purchases and licenses pop-up on the person page** (add, edit, mark paid, delete). License dates, a seat's audiences and the school-domain view stay on `admin-licenses.html`. **Amended 2026-11-23 (found in phase 0, owner to confirm):** the Licenses page does not have assign an email, register directly, or free a seat, so those three move into the pop-up too, or they would be orphaned. |
| D4 | Roles | **As in section 5.** CRM Admin: everything. Sales: edit details, subscriptions, groups, imports, resend verification and password reset; **not** delete a contact or sign-in account, export the list, or touch purchases and seats. Read-only: look only. |
| D5 | Read-only can no longer edit | **Accepted** (the older page lets a Read-only role edit and delete today; the merged screens close that). |
| D6 | Loading | **Server paging**, search and filters on the server (as the Hub list does). Needs indexes on name, email and company. |
| D7 | Hub switch off | **The merged contact screens keep working** for viewing and editing; only the Hub-only parts (label, deals, tasks, notes panels) hide. Build note: the contact routes must not answer 404 with the Hub off the way `requireCrm` does; use the `requireCrmRole('<action>')` pattern (works with the Hub off) or an equivalent. |
| D8 | Columns | **Keep the picker**, add Role and Grade Levels as optional columns, and read the old `localStorage` choice once so a person's saved columns carry over. |
| D9 | Menu name | **Contacts**, under the Customer Hub group. The top-level "CRM" item and the two dashboard buttons are repointed when the old page is redirected. |

## 9. Risks to watch

- **Deleting a contact cascades** (purchases, invoices, group membership, seats): the merged delete keeps the refusal and the account closing.
- **Two sources of truth for the same fields** during phases 1 to 5 (both screens edit the same row): both write the same table, so there is no copy to drift; only the rules (who may edit) differ until phase 6.
- **Hub off** (D7).
- **Large list:** the old page's all-at-once load is fast for staff today; server paging must keep search quick (index on name, email, company).
- **Per-browser column choice** is lost when the page changes name; the new screen should read the old `localStorage` key once.
- **The four end-to-end tests** encode today's flows; they are the best checklist of what staff actually do, so they are rewritten rather than deleted.

## 10. Corrections found while building phase 0 (2026-11-23)

Checking every row against the real code found these, all fixed above:

1. **P5 (license dates), P8 (by school domain) and a seat's audiences are not on the older page.** Only `admin-licenses.html` calls them, so they are not part of the merge.
2. **The Licenses page does not have the three seat actions** (assign an email, register directly, free a seat); only the older page does. D3 said seat work could stay on Licenses; that was wrong for these three. D3 is amended so they move into the person page's pop-up.
3. **`routes/newsletter.js` is also a library.** `createPurchase` is used by `checkout.js` and `quote-accept.js`, `attachPurchaseDetails` by `site-auth.js` and `invoices.js`; `assignContactToGroups` is exported but only used inside the file. They move to `server/lib/` before the page is retired (phase 6), and the route file itself stays.
4. **More references to the older page than section 3 listed:** `mission-control-static-files.txt` (the list of static files to deploy), `server/test/crm-pages.test.js`, a comment in `server/scripts/alter-add-quote-school-domain.js`, and comments in two end-to-end specs.
5. **Delete is bigger than the table said** (R2 above: staff accounts refused, close-account confirmation, CRM Admin erase of CRM items).
6. **The Edit Contact fields E1 (email), E3 to E7 and the Add Contact form were not assigned to any phase.** They are now phase 3.
7. **New decision D10 (owner):** the Add Purchase form has a `book` type that loads `/api/books`, but FNE sells no books and the book code is dead. Recommendation: drop the `book` type from the new pop-up, and leave the existing book purchases as they are (the list still shows them). Needs the owner's yes before phase 4.

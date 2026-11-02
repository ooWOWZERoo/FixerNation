# District dashboard (requirements)

Written 2026-10-31. **Decisions confirmed by the owner 2026-11-01 (counts only; expiring flagged at 90 days, not 60; nearly-full kept as good news; a low-adoption alert added; the Portrait of a Graduate tile included). Built and tested 2026-11-01, not yet deployed.** Final thresholds in code (`lib/district-dashboard.js`): ends within 90 days; seats in use 90 percent or more; under 25 percent of seats in use 60 days after the license started. Access-related, so the rules are confirmed first and the code is written once.

## The problem

`district-admin-dashboard.html` is a welcome card with one link ("Manage District Branding"). A district administrator's landing page tells them nothing about their district. The other district pages already hold useful facts (schools and licenses in `district-admin-schools.html`, framework status in `district-admin-standards.html`, branding), but none of it is summarised or surfaced where the administrator lands.

## What it should show (per district)

**Headline numbers** (cards):
| Card | Definition |
|---|---|
| Schools | Schools in the district with at least one group license |
| Seats assigned of purchased | Sum over the district's open licenses of `assigned` and `total`, using `lib/seat-counts.js` (registered + inactive + pending; school and district admins excluded). Plus % used. |
| Active teachers | Seats in status `registered`, admins excluded |
| School administrators | Active school license administrators across the district |

**Needs attention** (a short list, each item links to the page that fixes it):
- Licenses expiring within 60 days (school, date)
- Licenses waiting on a purchase order (school) [wording follows the PO work, `po-license-activation-requirements.md`]
- Schools with no active school administrator
- Schools above 90% of their seats
- Frameworks "In review" or "Draft" on Portrait of a Graduate (a count, linking to the standards page)

**Schools table:** school, plan, seats assigned of total (with a bar), licence expiry, status, administrator count. One row per licensed school; click through to the existing schools page.

**Quick links:** Branding, Schools and administrators, Portrait of a Graduate, Help videos.

## Access matrix

| Role | Sees | Cannot see |
|---|---|---|
| District administrator | Aggregates and per-school rows for the districts they administer | Any other district; individual teachers; students; classroom or reflection data |
| School administrator | Nothing here (own portal) | |
| Teacher, student, parent | Nothing | |
| FNE staff | Via the admin pages, unchanged | |
| Sales-demo account | Its own demo district only (the demo district stays separate from real ones, as everywhere) | |

Every query is scoped by `req.districtAdmin.districtIds` (the same check the other district routes use); a purchase id from another district returns nothing, never an error that reveals it exists.

## Privacy rule

**Counts and school-level facts only. No teacher names or emails, no student data.** This follows the same default as the open school-administrator visibility question (D4 in the Tune Your Brain decisions): aggregates first, anything finer is a separate, explicit decision.

## Design notes

- New endpoint `GET /api/district-admin/dashboard?districtId=` returning the numbers and lists above, built in one place from the existing `purchases` to `schools` to `districts` join already used by `GET /api/district-admin/schools`.
- `lib/seat-counts.js` gets a batch function (`getSeatCountsForPurchases(ids)`) so the table does not run one query per school. Tests prove it matches the single-purchase function.
- The page uses the existing district portal styles (`sa-*` classes), the existing `daReady` bootstrap, and `fnEscape()`-style escaping for school names (they come from outside the admin's keyboard).
- A district administrator with more than one district sees the selector the other district pages use; I will read how they do it before building and reuse it.
- Empty states are real: a district with no licensed school yet says so and points at FNE contact, instead of showing zeros.
- No schema change, no alter script; needs a Node restart (new route).

## Out of scope

Trends over time, exports, per-teacher or per-classroom detail, usage of brain games or lessons, and email alerts. Each is a later, separate decision.

## Decisions for you

1. **Aggregates only, no teacher names:** agree?
2. **The "needs attention" thresholds:** expiring within 60 days and over 90% of seats. Right numbers?
3. **Is Portrait of a Graduate status useful here**, or should the dashboard stay about licenses and seats?
4. **Order of work:** build this before or after the PO change? They touch different files, but the "waiting on a purchase order" item makes more sense once the PO wording is settled.

After you confirm: build the endpoint and the batch seat function, test against a real SQL engine (every card, the scope check, the empty state), play the page on the local site, then bring it back for review before deploy.

# Per-district frameworks — requirements & access matrix (CONFIRMED 2026-10-26; built 2026-10-27, not yet deployed)

Phase 4 of `DESIGN.md`. **Built as written, with one change:** the public district page is `state-standards.html?district=ID` (district mode of the state page, which reuses its renderer, grade picker and disclaimer) rather than a separate `district-standards.html`. Drafted 2026-10-26. Rules 1-6 in `DESIGN.md` all still apply unchanged.

## Goal

A district admin records their own district's Portrait of a Graduate (and optionally its SEL competencies) from the district-admin portal. After an FNE admin verifies it, the district's framework appears publicly, mapped to FNE lessons, games and program themes. The mapping is FNE's own thematic mapping — never a district, state or CASEL endorsement.

## How it relates to the state crosswalk

- A district framework is the **same kind of record** as a state framework (`standards_frameworks` → `standards_items` → `standards_alignments`), owned by a district instead of a state. Same review gate, same verify code, same grade-version expansion of lessons.
- A district framework also carries the state it sits in (`state_code`, chosen by the district admin, checked by FNE on verify) so it can be listed under that state. It never changes the state's own coverage row or the state's own frameworks.
- **Biggest leak risk:** today every state query selects frameworks by `state_code`. Once district rows share the table, each of those queries (public state page, one-pager, overview counts, admin state view, preview) must exclude district rows, and the district queries must exclude state rows. Mutation-checked tests cover both directions.

## Data model (additions only)

| Change | Purpose |
|---|---|
| `standards_frameworks.district_id` (NULL = a state framework; FK `districts`, ON DELETE CASCADE) | Owner |
| `standards_frameworks.submitted_at`, `submitted_by_site_user_id` | "Sent to FNE for review" marker; cleared by any edit |
| `standards_frameworks.attested_at`, `attested_by_site_user_id` | District admin ticked "this is my district's official framework and I'm authorized to submit it" |
| `standards_alignments.suggested_by_site_user_id`, `district_note VARCHAR(500)` | District's *suggested* connection and why they think it fits. Never public. |
| Unique key on frameworks | Must stay unique per owner (a state's and a district's framework may share a name); detail settled at build time, with a test |

`review_status` stays `draft` / `verified`. "Awaiting review" = `draft` + `submitted_at` set. `districts` has no state or public slug; none is added — the public page uses the district id and only ever returns verified rows.

Limits: at most 3 frameworks per district (a portrait, an SEL framework, one spare), at most 60 items per framework, text fields capped as in the state tables. Every framework needs an https source URL and a date checked, as for states.

## Access matrix

"Own" = a district the person has an active `district_license_admins` row for (and, for demo accounts, only the demo district).

| Role | View verified (public) | See drafts | Create / edit framework + standards | Suggest connections | Submit for review | Withdraw to draft | Delete | Verify / unverify |
|---|---|---|---|---|---|---|---|---|
| Anonymous visitor | YES | NO | NO | NO | NO | NO | NO | NO |
| Teacher / parent / student | YES | NO | NO | NO | NO | NO | NO | NO |
| School admin (any level) | YES | NO | NO | NO | NO | NO | NO | NO |
| District admin — own district | YES | own only | own only | own only | own only | own only | own only | NO |
| District admin — another district | YES | NO | NO | NO | NO | NO | NO | NO |
| Sales-demo account | YES (real verified data only) | demo district only | demo district only | demo district only | demo district only | demo district only | demo district only | NO |
| FNE admin | YES | ALL | ALL (incl. on a district's behalf) | n/a (writes real connections) | n/a | YES | YES | YES |

Notes:
- **Delete / withdraw** are allowed to the district admin in any status because they only ever *remove* something from public view.
- **A district admin editing a verified framework, its standards, or its connections sends it back to draft**, un-submits it, and it leaves the public site until FNE re-verifies (existing rule 3).
- **Sales-demo confinement:** the demo district's framework can be created and walked through the whole flow, but it is **never returned by any public endpoint, the state page, or the one-pager** — only by the demo account's own portal and the FNE admin preview. Verifying it has no public effect.
- Every district id and framework / item / alignment id arriving in a URL or body is checked against `req.districtAdmin.districtIds` (through the framework's `district_id`) before it is read or written. A foreign id returns 404, not 403, so it does not confirm that the record exists.
- Free text written by a district is shown on the public site only after an FNE admin has read it. It is HTML-escaped on every surface; nothing is rendered as markup.

## Endpoints (planned)

- Public: `GET /api/standards/districts/:id` (verified only, same shape as a state), `GET /api/standards/states/:code` gains a "districts" list (verified only). Existing public rate limit applies.
- District admin: `/api/district-admin/standards/*` — list own frameworks, create/update/delete, upsert items, suggest connections, submit, withdraw. Uses `requireDistrictAdmin`, a per-user write rate limit, and a scope helper that every handler calls.
- FNE admin: existing `/api/admin/standards/*` verify / unverify / alignment routes work on district rows as well; plus a "district submissions" queue and the ability to create a district framework on a district's behalf.

## Pages (planned)

- `district-admin-standards.html` (district-admin portal; new nav link in `district-admin-nav.js`).
- `district-standards.html?id=` public page, reusing the state page's layout, disclaimer and grade-version picker.
- `admin-standards.html`: a "District frameworks" tab with the submission queue; district rows get a visible "Submitted by (district)" label.
- `state-standards.html`: a "Districts in this state" list of verified district frameworks. `state-onepager.html` gains a district mode.

## What FNE staff do to verify a district framework

Compare the submitted standards to the **source URL the district gave** (their own official page), confirm the person is a real administrator of that district, write the rationale for each suggested connection, then verify. Claude may help draft but cannot verify.

## Decisions (owner, 2026-10-26)

1. **Who edits:** district admins only. School admins (and schools with no district) get read-only access to verified data in v1.
2. **Connections:** the district suggests, FNE writes the rationale and verifies.
3. **Public:** a district page, a "Districts in this state" list on the state page, and a district mode on the one-pager.
4. **Notify:** a short plain email to an FNE admin on each submission (not sent for the demo district); the admin queue exists either way.

The owner confirmed the access matrix on 2026-10-26.

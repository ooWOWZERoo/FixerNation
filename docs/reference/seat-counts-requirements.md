# Seat counts: requirements

Status: decision 1 confirmed by the owner 2026-10-31 (a deactivated teacher uses a seat). Decisions 2 to 4 were built as recommended (pending invitations use a seat, My Licenses says "assigned", district teacher count excludes admins). Built, tested and deployed 2026-10-31 (Release 66). R1 ships without a batch form: add one when the district dashboard needs it. R4 also covers teacher self-registration (`routes/school-registration.js`). The invite and self-registration checks used to count admin-held seats; they no longer do.

## The problem

A school admin sees different seat numbers depending on which page they open. Two causes, both found by reading the code:

1. **Two pages add the numbers up differently from the server.**
   The server's `assigned` is `registered + pending + inactive` (dashboard, org, reports; also what the invite-seat check at `school-admin.js:480` enforces). `school-admin-roster.html:197` and `school-admin-licenses.html:142` ignore the server's `assigned` and recompute `active + pending`, dropping `inactive`. Those same pages show `Available` from the server, which does subtract inactive seats. So on one page, "Active 10, Inactive 2, Pending 3, Available 5, 13 of 20 assigned" cannot all be true (20 - 15 = 5 available, but 13 assigned). The percentage and the "nearly full" banner disagree between dashboard and roster whenever someone is deactivated.
2. **Four endpoints each run their own copy of the same SQL and arithmetic**
   (`/dashboard`, `/org`, `/licenses`, `/reports?type=utilization` in `server/routes/school-admin.js`). They agree today only by convention (a comment on `/org` says so). The next edit will drift again.

Smaller inconsistencies outside the school-admin portal (listed so they are decided, not forgotten):

- `my-license.html:167` shows "`registered`/`seatCount` seats used" using registered seats only (no pending, no inactive), and does not exclude admins.
- `admin-districts.js` `schoolLinkage()` counts `registered` teachers with no admin exclusion, so the district "teachers" figure can differ from the school's own.
- `district-admin-schools.html:143` shows only `seat_count` (purchased), no usage. That is fine, but the district dashboard stub will need these numbers later.

## Proposed definitions (one meaning per word, everywhere)

| Term | Definition |
|---|---|
| **Total** | `purchases.seat_count` |
| **Active** | seats with status `registered` |
| **Inactive** | seats with status `inactive` (teacher deactivated by an admin, can be reactivated) |
| **Pending** | seats with status `pending` (invited or self-registered, account not finished) |
| **Revoked** | seats with status `revoked` (history only, does not use a seat) |
| **Assigned** | Active + Inactive + Pending |
| **Available** | max(0, Total - Assigned) |
| **% used** | round(Assigned / Total x 100) |

Applies to every count: admins (school or district) are excluded via `notAdminSeatClause`, as today.

Invariant that must always hold on screen: `Active + Inactive + Pending + Available = Total` (unless Assigned exceeds Total, then Available is 0 and a warning shows).

## Decisions needed

1. **Does a deactivated (inactive) teacher use a seat?** Recommend **yes**. The server already says yes (it blocks new invites when `registered + inactive + pending >= seat_count`), and an inactive teacher can be reactivated at any time. To free the seat, the admin removes the teacher. If you say no, the invite check, `/dashboard`, `/org`, `/reports` and `/licenses` all change instead of the two pages.
2. **Does a pending invitation use a seat?** Recommend **yes** (already how the server behaves; revoking the invite frees it).
3. **Should the teacher-facing `my-license.html` line ("3/20 seats used") use the same Assigned number?** Recommend yes, labelled "assigned" so it matches the admin's pages. Currently it can read lower than the admin's dashboard.
4. **District teacher count (`schoolLinkage`)**: exclude admins like the school pages do? Recommend yes.

## Requirements (assuming the recommendations)

R1. One server function, `server/lib/seat-counts.js`, returns `{ total, active, inactive, pending, revoked, assigned, available, pctUsed }` for a purchase id (and a batch form for a list of purchase ids, for the district dashboard later). It is the only place that counts seats.
R2. `/dashboard`, `/org`, `/licenses` and `/reports?type=utilization` use it and return the same field names.
R3. `school-admin-roster.html`, `school-admin-licenses.html`, `school-admin-dashboard.html`, `school-admin-org.html`, `school-admin-reports.html` display the server's `assigned`, `available` and `pctUsed`, and never recompute them.
R4. The invite-seat check (`school-admin.js` ~480) and the bulk/single invite capacity checks use the same function, so the "no seats left" message and the numbers on screen cannot disagree.
R5. Roster and Licenses pages gain an "Inactive" figure where missing (Licenses shows no Inactive card today) so the invariant is visible.
R6. `my-license.html` and `schoolLinkage()` follow decisions 3 and 4.
R7. Tests in `server/test/` (real SQL via `node:sqlite`): seats in every status, an admin holding a seat (excluded), an over-assigned purchase (Available is 0), and a check that all four endpoints return identical counts for the same purchase.

## Access matrix

No new endpoints and no new data exposed. Read-only counts, same scope checks as today (`requireSchoolAdmin` + `purchaseIds.includes`; teacher view limited to the signed-in teacher's own purchases).

| Role | Sees seat counts for |
|---|---|
| School admin (any permission level) | their own purchases only |
| District admin | schools in their district only (future dashboard) |
| Teacher | own license line only |
| FNE staff | any (existing admin pages, unchanged) |

## Out of scope

- Changing what a seat costs, or how seats are created or revoked.
- The PO two-step payment flow and the district dashboard stub (separate issues).
- No schema change, no alter script, no data fix. Deploy would need a Node restart plus the changed HTML files.

## Not verified

I read the code only. I have not looked at production numbers, so I don't know which schools currently show a mismatch (any school with at least one deactivated teacher should). If you want, send the Network-tab JSON for `/api/school-admin/licenses` and `/dashboard` from one school to confirm.

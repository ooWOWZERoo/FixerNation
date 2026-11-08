# Affiliate whole-state territories: requirements

Status: **decisions D1 to D7 accepted by the owner (2026-11-07). Phase 1 built in Release 148; phase 2 (affiliate asks for a whole state) not built.** Per `CLAUDE.md`, territory rules sit next to billing, so the access matrix and rules below get confirmed first, then built once.

## What the owner asked for

An admin (and, if allowed, an affiliate) should be able to take an **entire state**, which assigns **every county in that state** automatically. If some counties in that state are already held by another affiliate, the admin is **warned**, and can **cancel** or **continue**. Continuing creates a **dual assignment**: two affiliates hold the same counties at once.

## What happens today (verified in the code, 2026-11-07)

- Every territory is one county (`lib/territories.js`, `findOrCreateTerritory`). A state with no county is refused: "A county is required".
- An admin assigns one county per action (`POST /api/affiliates/:id/territories`). An affiliate requests one county per request, and may have only one request pending (`POST /api/affiliate-portal/territories/request`). Every request needs admin approval.
- A county has at most one active holder. `assignTerritory()` refuses a county someone else holds, and so does approving a request. This is enforced in the app, not the database (`affiliate_territories` has no unique key on active rows), so dual holding needs **no schema change**.
- **Territory never decides who earns a commission.** Attribution is by referral code (`docs/AFFILIATE_PROGRAM_SPIKE.md`, "organizational only"). A dual assignment therefore cannot cause a double commission or a dispute over credit.
- Already built for several holders: the map counts distinct affiliates per state, and the state drill-down lists every active affiliate with their counties. Not built for several holders: `listTerritories()` joins a single holder per county, so a dually held county would appear twice in the admin Territories list.
- Cost of a whole state today: New York 62 assignments, Texas 254, one at a time.

## Proposed rules

1. **Whole-state assignment is an admin action.** It assigns every county of the chosen state to the chosen affiliate in one transaction (all counties or none).
2. **Counties the affiliate already holds are skipped**, never duplicated.
3. **Overlap warning.** Before anything is written, the admin sees a preview: how many counties in the state, how many are new for this affiliate, and, for each county already held by someone else, the holder's name. Two buttons: **Cancel** (nothing changes) and **Assign anyway** (creates the dual assignments). If no county overlaps, the preview still shows the count and asks for one confirmation.
4. **The server enforces the confirmation.** Assigning with overlaps requires an explicit "I understand there is overlap" flag. The server re-checks at confirm time; if overlaps appeared since the preview, it returns a new preview instead of writing.
5. **Dual assignment is only possible through this action.** Assigning a single county, approving a county request, and approving an application keep the one-holder rule exactly as today. An affiliate cannot create overlap by asking.
6. **Every assignment is tagged** in `notes` ("Whole-state assignment: NY") so it can be found and revoked as a group. One audit-log entry records the state, the affiliate, how many counties were added, skipped and overlapped, and who the other holders were; each assignment also gets its normal row.
7. **Revoke a whole state.** A "Revoke all in this state" action on the affiliate's Territories modal revokes that affiliate's active counties in that state in one confirmed step. Revoking one county still works as today. Revoking never touches the other affiliate's rows.
8. **Suspension is unchanged:** it revokes every territory the affiliate holds, including whole-state ones.
9. **Commissions are unchanged** (see above). Sales in a dually held county credit whichever referral code was used.
10. **Wording changes** (these pages currently promise no overlap): `admin-affiliates.html` (two hints), `become-an-affiliate.html` (the "One active affiliate per territory, no overlap" hint). New wording says one affiliate per county is the normal rule, and that FNE can assign overlapping areas on purpose. Check the Affiliate Terms and Help center for the same promise before release.

## Access matrix

| Who | See own territories | Assign a county | Assign a whole state | Revoke a county / a whole state | Create overlap |
|---|---|---|---|---|---|
| FNE admin | yes (all affiliates) | yes, one holder only | **yes, with warning and confirmation** | yes | **only through whole-state** |
| Affiliate | yes, own only | no | request only (phase 2), approval needed | no | no |
| Other affiliates / the public | no | no | no | no | no |

## Phases

1. **Phase 1, admin whole-state assignment:** preview endpoint (read-only), assign endpoint with the overlap flag, "Revoke all in this state", the Territories modal buttons and warning dialog, `listTerritories()` showing every holder, wording fixes, tests on the real SQL engine (each rule above). No schema change, no alter script, Node restart needed.
2. **Phase 2, affiliate asks for a whole state:** `territory_requests.requested_county` allows "whole state" (needs an alter script), the request form gains an "Entire state" choice, and the admin's approval opens the same warning dialog. A pending whole-state request counts as the one pending request.

## Decisions for the owner (defaults are my recommendation)

- **D1.** Overlap is allowed **only** through the admin whole-state action; single-county assignment and every request keep one holder per county. *Default: yes.*
- **D2.** Let an affiliate **request** a whole state (phase 2), with the same warning when the admin approves. *Default: yes, but after phase 1 is live.*
- **D3.** Tell an affiliate when someone else is given counties they already hold? *Default: no email; the audit log and the admin dialog record it. The existing holder's own list is unchanged.*
- **D4.** Counties the affiliate already holds are skipped. *Default: yes.*
- **D5.** Add "Revoke all in this state". *Default: yes (otherwise undoing New York takes 62 clicks).*
- **D6.** New wording for the three places that say "no overlap" (above). *Default: "Each county normally has one affiliate. FNE can assign overlapping areas on purpose."*
- **D7.** States whose counties are called something else (Louisiana parishes, Alaska boroughs) and DC (one county-equivalent) work the same, using the existing reference list. *Default: yes.*

## Not changing

Commission attribution, the commission ledger, the territory map's counting rule (distinct affiliates per state), the one-pending-request rule, and the rule that every request needs admin approval.

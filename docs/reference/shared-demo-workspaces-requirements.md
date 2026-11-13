# Prospect demo for many overlapping groups: requirements

Status: **requirements confirmed 2026-11-12 (D1 to D9 accepted as recommended). Phase 1 (workspaces, server only) is built and tested, not yet deployed; phase 2 is next.**

This extends the shared demo (`shared-demo-environment-requirements.md`, `shared-demo-how-to.md`). Read those first. That design has one global switch, one access code and one set of sample data, which is right for one group at a time. The owner expects a **continuous stream of groups demoing at the same time**, which that design cannot handle well.

## 1. Why the current demo does not scale to overlap

| Problem with one shared demo and overlapping groups | Effect |
|---|---|
| One set of sample data | Group B sees (and breaks) what group A just built. A teacher adds students, another group's teacher sees them. |
| One end date | Extending the demo for group B also extends it for group A, and group A's end date cannot be honored on its own. |
| "Turn on" resets the data | Starting group B while group A is mid-demo wipes group A's work. |
| One access code, one password, one PIN | Regenerating any of them signs every group out. A leaked code exposes everyone. |
| One lockout per login | A stranger (or one group) can lock the shared teacher login for every group. |
| One set of counts and tags | A ticket or quote cannot be tied to the group it came from, except by what the visitor typed. |

With an occasional overlap these are tolerable. With a continuous stream they are the normal case, so the demo needs to give **each group its own private copy**.

## 2. The idea

- A **workspace** is one complete private copy of the demo: its own fake district, school, classroom, students and the five logins. There is a **pool** of them (say 10).
- An **invitation** is one group's visit: a label (the group's name), a private access code, an end date, and one workspace assigned to it.
- Creating an invitation takes a free workspace, resets it to fresh, gives it a new password and PIN, and returns a ready-to-send message. When the invitation ends (or is ended early), the workspace is wiped, its password is changed so the old one is dead, and it goes back in the pool.
- Groups never see each other's data, end dates, codes or passwords. Lessons and curriculum are shared read-only, which is fine because they cannot be edited or downloaded.

What stays the same: unlisted page behind a code, view-only content, no outbound email except notices to staff, no uploads, no changing the password, example.com addresses only, every restriction in R5 of the original requirements.

## 3. The experience

1. A district shows interest. A staff member opens **Sales > Demo** and presses **New invitation**.
2. They type the group's name (for example "Springfield USD") and choose how long (default 14 days, at most 30).
3. The page shows the invitation's message (page address, this group's access code, end date) with **Copy message**. Nothing else is needed.
4. The district opens the demo page, enters its code, and sees **its own** five sign-ins, password, PIN and end date.
5. Staff watch that invitation's own counts (code entries, sign-ins by role, tickets, quote requests). A ticket or quote shows **"Demo: Springfield USD"**.
6. At the end date the invitation closes by itself. Staff can **extend**, **end now**, or give a **new code** for that one group without touching any other.

## 4. Rules

### R1. The server decides, per invitation
- A demo login works only while **its workspace's invitation is active** (not ended, not revoked, end time ahead) **and** the master switch is on. It is checked on the server for every demo request and fails closed: if the invitation cannot be read, the session is refused.
- A demo session's signed claim carries its **workspace number**, not just `demo: true`. Ending an invitation ends only the sessions of that workspace, within a few seconds (the lookup may be cached for at most 15 seconds).
- The **master switch** (today's global on/off) stays as an emergency "pause all demos". Off means every invitation behaves as closed, and `scripts/set-public-demo.js --off` still works when the website is down.

### R2. Closed means invisible
Unchanged: a wrong code, an ended invitation and a paused demo all give the **same answer**. The page never says which. `/state` still returns only `{open:false}` to anyone without a valid code.

### R3. One code per invitation
- Each invitation has its own access code (same format as today), unique across active invitations, never reused after the invitation ends.
- The gate cookie carries the **invitation id and that code's version**. A new code for one group ends only that group's visits.
- `/credentials` returns only the logins, password and PIN of the cookie's own workspace, never another's, and never the join code.
- Wrong-code throttling is unchanged (per address and overall).

### R4. Workspaces and accounts
- Workspace `NN` (01, 02, ...) has: district "FNE Demo District NN", school domain `wNN.public-demo.example.com`, one `$0` inactive purchase, one classroom, three students, and the five logins: `demo-district-NN`, `demo-school-NN`, `demo-teacher-NN`, `demo-parent-NN` (all `@public-demo.example.com`) and student `demo-student-NN`. (Exact address pattern is confirmed at build time against the login rules, but it stays under example.com and the group sees a number it can read aloud.)
- Each workspace has **its own** shared password and PIN, made when the invitation is created. They are held in the database, never in the repository.
- Every workspace account has an explicit column `site_users.demo_workspace_id` (not derived from assignments, for the same reason `is_sales_demo` is a column). `is_shared_demo` and `is_sales_demo` stay set on them.

### R5. Access matrix (confinement)
Same restrictions as the single demo (no downloads, uploads, outside email, password change), plus:

| Actor | Own workspace | Another workspace | Real school or district | Salesperson demo |
|---|---|---|---|---|
| Workspace NN login | Full demo experience | **No access** (404, never 403) | No access | No access |
| Gate cookie for invitation A | Credentials of A's workspace only | Refused | n/a | n/a |
| FNE admin | Everything | Everything | Everything | Everything |

Every place that today asks "is this the demo district or school?" (`isDemoDistrictName`, `isDemoSchoolDomain`, `demoKindOf*`, the school and district admin middleware, teacher invitations, standards queries) must instead compare the account's `demo_workspace_id` with the workspace of the district, school or classroom it is touching. **Every second-level id** (classroom id, student id, school id) needs its own check against the signed-in account's workspace. After the change, grep the whole codebase for the old pattern (the project's standing access-control rule).

### R6. Reset and release
- A workspace is reset when an invitation **takes** it (guarantees a fresh start) and when the invitation **releases** it (so no visitor-typed names or work linger).
- There is **no nightly wipe of an active workspace**: the data is that group's own, and wiping a group mid-evaluation would be a regression from their point of view. A nightly sweep (cron, about 3:10 a.m.) resets workspaces whose invitation has ended or whose end time has passed.
- Releasing also changes the workspace's password and PIN and its access code ends, so an old message cannot be reused.
- The demo page's "we reset it every night" line is replaced with a line saying the group has the demo to itself and it is cleared when the demo ends.

### R7. When the pool is full
Creating an invitation with no free workspace is **refused with a clear message** ("All 10 demo workspaces are in use. End one, or add more."). No waitlist. The admin page shows "N of M in use" and **Add workspaces** (a small number at a time, up to a cap, D2).

### R8. Tickets, quotes and counts, per invitation
- A request from someone holding that invitation's gate cookie or a workspace session is tagged with the **invitation id** (set by the server from its own cookies, never from a form field), replacing today's `demo_window` number.
- Staff see **"Demo: <label>"** in the Support Inbox and Quotes, and "Source: Shared demo (<label>)" in the staff email. The label is typed by staff and lives only in the database.
- Counts are per invitation (code entries, sign-ins by role, tickets, quotes, last activity). Counts never hold an address, name or email, as today.

### R9. Rules that must not erode
- The demo never reaches real data; demo accounts keep both flags and the workspace column.
- No third-party scripts or fonts; the page stays `noindex`, unlinked and out of the sitemap.
- All email still goes through `lib/mailer.js` (a test enforces it).
- No secret (code, password, PIN) in the repository, audit log or counts.
- Admin and site-user auth stay separate; the gate cookie keeps its own audience.
- Every staff change (invitation created, extended, ended, new code, workspace added or reset) is written to the audit log with who and when, never with a secret.

## 5. The admin page (Sales > Demo)

- **Master switch** ("Demos are on / paused") and "N of M workspaces in use", with **Add workspaces**.
- A table of invitations: group, status (Active, Ending soon, Ended), workspace number, ends (US Eastern), code entries, sign-ins, tickets, quotes, and per-row actions: **Copy message**, **Show sign-in details**, **Extend**, **End now**, **New code**.
- **New invitation** form: group name, length (days or until a date and time, at most 30 days).
- **Unlock a workspace's logins** per invitation, and **Reset this workspace** (with a confirmation that it clears the group's work).
- Ended invitations stay listed with their final counts for 90 days, then are removed.

## 6. The demo page

Same page, same gate. After the code it shows that group's welcome note, its own end date, its own sign-ins, password and PIN, and the same help buttons. The note about shared data is replaced by: you have this demo to yourselves; other groups cannot see your changes. Wording goes through the humanize skill; the wording change is small.

## 7. Phases

Each phase is its own release, with an alter script run before the restart, and each phase leaves the current single demo working until phase 5.

1. **Workspaces (server only). BUILT 2026-11-12, not yet deployed.** Table `public_demo_workspaces` and column `site_users.demo_workspace_id` (`scripts/alter-add-demo-workspaces.js`; the invitations table moves to phase 2, where its columns are decided). `lib/public-demo-workspaces.js` holds the fixture sets (`workspaceFixtures(n)`, `legacyFixtures()`); `seed-public-demo.js` and `reset-public-demo.js` now take a fixture set, so the same code builds the original demo and any workspace (the original path is unchanged). New scripts: `scripts/seed-demo-workspaces.js` (`--count N`, dry run by default, 10 by default, at most 40) and `scripts/reset-demo-workspace.js` (`--workspace N` or `--all`, dry run by default, does not look at the on/off switch). A new workspace's logins get random passwords nobody is told, and an existing workspace is never re-hashed or signed out by a top-up, so **nobody can sign in to a workspace until phase 2 gives it a password**. A reset keeps the workspace's join code and the PIN hash the group was given. **Confinement (R5):** `lib/sales-demo.js` now has a kind for every demo: `sales`, `public` (the original) and `public:NN` (a workspace), derived from the district name `FNE Demo District NN` and the school domain `wNN.public-demo.example.com`; an account's kind comes from its explicit columns (`demoKindOfAccount`); `middleware/schoolAdminAuth.js` and `districtAdminAuth.js` keep only assignments whose kind equals the account's kind (so a workspace login, the original demo's login and a salesperson's login each reach only their own demo's school and district, and a real school never); the district-and-school pairing tool, teacher invitations and the standards pages use the same names (every two-digit name is reserved; the public standards queries also exclude `FNE Demo District %`). Teacher, parent and student access were already scoped to the signed-in account's own classrooms and links, and the tests prove a workspace-2 teacher gets 404 for workspace 1's classroom and students. Tests: `test/shared-demo-workspaces.test.js` (21), including the real school-admin, district-admin and classroom routes on seeded workspaces, and a scan that no route, middleware or library compares against one named demo any more. Checked on a real MariaDB: alter script twice, dry run, apply, re-run (0 created), top-up (only the new workspace), reset one workspace beside another, reset all. Deploy: run the alter script, then restart the Node app, then (when you want the pool) the seed script. Nothing changes for any visitor; the original demo is untouched.
2. **Invitations and the gate.** Invitation create, extend, end and new code; the gate and sessions check the invitation (R1, R3); `/credentials` per invitation; release sweep; `set-public-demo.js` gains `--invite`, `--end`, `--list` and keeps `--off` as the master pause. Tests for two overlapping invitations.
3. **Admin Demo page.** Invitation table and form, pool status, Add workspaces, per-invitation actions, audit entries.
4. **Per-invitation tags and counts**, the demo page wording, the district message, and the staff email source line.
5. **Retire the single demo, docs and checks.** Remove the old single fixtures and global code, rewrite `shared-demo-how-to.md`, update CLAUDE.md, PROJECT.md and the video check, and rewrite `tests/e2e/shared-demo.spec.ts` to run **two overlapping groups** and prove isolation (see section 8).

## 8. Tests that must exist

- Two active invitations at once: A's teacher creates a classroom and a student; B's teacher and B's district and school admins see neither; A's classroom and student ids return 404 from B's session.
- A's gate cookie never returns B's credentials; B's code never opens A's workspace.
- Ending A signs out A's sessions within a few seconds and leaves B's untouched; A's workspace is wiped and its password and PIN changed.
- A new code for A ends A's visits only.
- A lockout of A's teacher login does not affect B's.
- A ticket and quote from each group carry that group's label, and the counts are per group.
- The pool: the Nth+1 invitation is refused with the clear message; ending one frees a workspace; a freed workspace is clean.
- The master pause closes every invitation at once and does not lose any invitation.
- A static scan that no demo-confinement code still compares against the single demo district name or domain.

## 9. Decisions (all accepted as recommended, 2026-11-12)

| # | Question | Recommendation |
|---|---|---|
| D1 | One private workspace per group, or one shared set of data with a code per group? | **Private workspace per group.** Shared data with per-group codes would only fix attribution; with a continuous stream the sample data would always be in someone else's mess. |
| D2 | How many workspaces to start with, and the cap? | Start with **10**; Add workspaces up to **40**. More groups than that at once means waiting. |
| D3 | One password and PIN for every group, or one per workspace? | **One per workspace**, made with the invitation. Ending or leaking one group's cannot touch another's. |
| D4 | Nightly wipe? | **No nightly wipe of an active workspace.** Reset when taken and when released; a nightly sweep only clears ended ones. |
| D5 | Length of an invitation. | **14 days by default, 30 at most**, per invitation, shown in US Eastern. |
| D6 | Keep the global pause switch? | **Yes**, as an emergency "pause all demos" and for the command-line off. |
| D7 | The single demo fixtures that exist now (never given to a district): retire them? | **Yes**, at phase 5. The owner accepted this on the understanding that no district has been sent those sign-ins; phase 5 checks the events table for real sign-ins before deleting anything. |
| D8 | Group name stored with the invitation and shown on tickets, quotes and counts. | **Yes**, typed by staff, kept in the database only (the repository is public). |
| D9 | Pool full. | **Refuse with a clear message**; no waitlist. |

## 10. Risks and what we accept

- **This is a real rebuild of the demo's identity rules (R5)**, not a small change: the confinement code was written for one fake district and school. It is the largest risk, which is why phase 1 is server-only and proves isolation with tests before anything else changes.
- **More fixtures to maintain:** each workspace is a full set of rows. The seed and reset must stay idempotent and fast (a pool of 10 should seed in seconds).
- **The code can still be forwarded.** Accepted, as before: it now exposes one group's private workspace, not everyone's, and ends with that invitation.
- **View-only is not copy-proof**, as before.
- **Staff typing a real group name into the database.** Accepted: staff already know it; it never goes in the repository, logs or counts.

## 11. Out of scope

Self-serve "start a demo" buttons, a waitlist, per-group branding (colors only, as today), demo accounts for affiliates, and any real student data.

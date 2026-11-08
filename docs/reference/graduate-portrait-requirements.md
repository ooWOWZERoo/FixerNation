# My Graduate Portrait: requirements

Status: **DRAFT, written 2026-11-08, nothing built.** Decisions D1 to D14 (section 11) need the owner's answers before any code. Per the project rule, access, privacy, student-data and identity features get requirements and an access matrix confirmed first. The lifelong version (tier 3) also needs a lawyer's read before it is built (section 9); tiers 1 and 2 do not.

Owner decisions already made (2026-11-07): this is idea 2, after Graduate Evidence (live, Releases 151 to 154); it is planned with **all three persistence options** (per-year, end-of-year keepsake, lifelong with parental consent); New York only to start; the claim language is **"evidence of practice"**. Graduate Evidence is the class-level view for adults; this is the same evidence turned into something a **student can own**.

## 1. What this is

A picture, for one student, of the graduate attributes they have practiced: the six New York Portrait of a Graduate attributes and the ten New York SEL benchmarks, each marked "practiced" (a finished activity FNE connects directly to it), "touched" (a finished supporting one) or empty, with the names of the activities behind each mark and, if the student chooses, a few of their own words pinned beside it.

It joins the same two things Graduate Evidence does (verified connections x finished activity), but for one student instead of a classroom, and it is shown to the student, not about them.

## 2. Three tiers

| Tier | Name | Where it lives | Who needs to do what | Identity change |
|---|---|---|---|---|
| 1 | **This year's portrait** | In the student's own PIN account, built live from this school year's records | Nothing: the student opens "My Graduate Portrait" | None |
| 2 | **End-of-year keepsake** | A one-page printable/downloadable page the student or a linked parent takes away. **FNE keeps no copy.** | The student or parent opens it between 1 June and the purge date and prints or saves it | None |
| 3 | **Lifelong portrait** | A family-held profile that outlives the classroom, one year added at a time | A linked parent or guardian opts in, consents, and presses "Save this year" | **Yes, a new person record (section 6)** |

Each tier stands alone and ships alone. Tier 1 is useful without tier 2; tier 2 without tier 3. Tier 3 must not be needed for the first two to work.

## 3. The claim, and what we never say

Same rules as `pog-evidence-requirements.md` section 2, tightened because a student reads this about themselves.

- Allowed: "You have practiced Empathy in 3 activities", "Activities you finished that connect to Empathy", "Not practiced yet" (the neutral state is a gap in what has been *done*, never in what the student *is*).
- Never: mastery, proficient, achieved, growth, score, level, rank, grade, "you are empathetic", "behind", "weak", "needs work", or any comparison with other students or with a class average. No streaks or points on this page.
- Not a transcript, certificate, credential or award, and never described as "verified by New York State". Every view and every printed page carries the line: *These connections are Fixer Nation's own mapping to the New York frameworks. They are not an endorsement or certification by New York State or CASEL.*
- Quiz scores, game scores, accuracy and time spent are never read. A reflection or goal appears **only if the student pinned it** (D3).
- Only verified connections in verified state frameworks count (the same SQL gate as Graduate Evidence; a draft can never mark a petal).
- An attribute with no verified connection shows "No Fixer Nation activity is connected to this yet", never an empty mark that looks like the student's gap (the same rule as Graduate Evidence).
- Reading level: written for the youngest signed-in student (K-2 gets pictures and short words); design with the **interface-design** skill and put all visible copy through the humanize step.

## 4. Definitions

| Term | Meaning |
|---|---|
| Practiced / touched / no connection | Exactly as in `pog-evidence-requirements.md` section 3 (direct finished / supporting finished / nothing connected). One student finishing the same activity ten times counts once. |
| School year | 1 August to 31 July, the current one worked out from today's date (`currentSchoolYearStart()`). Tier 1 shows only the current year (the same owner decision as Graduate Evidence). |
| Pinned words | A reflection or goal the student chose to show on their portrait. Up to **3** per school year, each shown beside the attribute it was written about, or under "In my own words" if none. |
| Keeper | The adult who owns a lifelong profile (section 6). |
| Profile | A lifelong portrait record. One per child. |
| Year entry | One school year's saved summary inside a profile. |

## 5. Tiers 1 and 2: what they need

**Data.** A new function `studentPortrait({ studentId, schoolYearStart })` in `lib/pog-evidence.js`, using the existing `loadConnections` and `finishedByStudent`; plain portable SQL; reads, never writes. Pinned words need one small table, `student_portrait_pins (student_id, kind, source_id, attribute_item_id NULL, created_at)` with `ON DELETE CASCADE` to `classroom_students`, so the purge removes it with the student (no change to the purge). The pin stores a *pointer* to the reflection or goal, not a second copy of the child's words; if the reflection is deleted the pin goes with it.

**Tier 1 (student page).** `student-portrait.html` (loaded with `error-capture.js`), reached from `student-home.html` and the achievements page. The student session (`requireStudentAuth`) is the only credential. The route scopes to the session's own `studentId` and never accepts a student id from the client.

**Tier 2 (keepsake).** The same page in a print layout (browser print or "Save as PDF", no server PDF, one letter page, auto-fit like `state-onepager.html`). Available **1 June to the purge date** for that classroom's school year (after the purge exists; until then, always, for the current year). Because FNE keeps nothing, the keepsake is **built at the moment of opening from live data** and the page says so: "Save or print this now; it won't be here after the school year's records are cleared." A linked parent gets the same view for their child inside the parent portal (the access path `isLinkedParent()` already enforces). A teacher can switch the keepsake **off for their class** (some teachers will not want 6th graders printing during state testing); it is on by default.

**Never in tiers 1 and 2.** No other student's data, no class comparison, no share link, no email. The keepsake is not attached to any account and is not emailed by FNE.

**Retention fit.** Tier 1 and the pins are student records and are deleted by the purge, like everything else in `student-data-retention-requirements.md`. The keepsake needs no storage, so it needs no purge rule. Nothing here makes the purge harder or longer.

## 6. Tier 3: the new student identity model

### 6.1 The problem

A student today is a `classroom_students` row: a display name, a username, a PIN, a classroom. It has **no email, no date of birth, no link to the same child in last year's or next year's classroom, and no owner except the school**. A new year means a new row. Student data is purged about 30 September, by design. Fixer Nation collects it under the school's authority (the Student Data Privacy page, section 5: students are enrolled only through school-licensed teachers; there is no direct student sign-up). A lifelong portrait has to survive all of that, so it cannot live in a classroom row, and it cannot be created without someone with the right to consent.

### 6.2 Options

| | A. A profile owned by a parent's existing account | B. A student account with its own email | C. A portable file, no hosted profile |
|---|---|---|---|
| Shape | A new **profile** record, owned by a parent/guardian `site_users` account, one per child, holding saved year entries | A new student login (email + password) created with parent consent for under 13s | A signed file the family downloads each year; nothing kept by FNE |
| New credential system | **None** (the keeper signs in with the account they already have) | **Yes**, a third auth system with a fourth JWT kind, a recovery flow, and email for children | None |
| Consent | The adult who creates it is the consenting adult; the link to the child already exists and was verified by a school invitation + email confirmation | Needs verifiable parental consent before a child's email is collected | Not applicable (the family holds the data) |
| FNE holds data after the school year | Yes (opt-in) | Yes | **No** |
| Works across schools and years | Yes: the keeper asserts "this is the same child" each year | Yes | Yes, if the family keeps the files |
| Legal exposure | Medium (section 9) | **Highest** (FNE collects directly from children) | Lowest |
| Fits "lifelong" | Yes | Yes | Weakly (the family holds the only copy) |

**Recommended: A, with C available from day one as the no-hold alternative.** A keeps one auth system (the project's rule is never to mix them; a new kind of person who can sign in is a security surface, and the 2026-10-15 audit closed real holes in exactly that area). A uses a relationship FNE has already verified (teacher invites parent by email, parent confirms it). B is the only option where FNE collects personal information straight from a child and would need to be built last, if ever.

### 6.3 How option A works

1. **The school switch comes first.** A school admin (or the district admin, for a whole district) must turn on **"Allow families to keep a Graduate Portrait"**. It is **off by default**. Many district privacy agreements forbid a vendor keeping student-derived data after the contract ends; this puts the choice with the school, in writing, not with FNE (D8). A parent of a student at a school with the switch off sees tier 2 only.
2. **Only a linked, confirmed parent can start one.** The adult must already be linked to the child through a confirmed parent invitation (`isLinkedParent()`). No link, no profile. A teacher cannot create one. A student cannot create one.
3. **Consent screen.** In plain words: what is saved (section 6.4), that it is the family's, who can see it (only them, plus any link they make), that they can delete it any time, and that it is deleted if unused (D9). The acceptance (who, when, which child, which text version) is recorded in a `portrait_consents` table. The wording is lawyer-reviewed before this ships.
4. **The keeper presses "Save this year".** From the parent portal, any time the school year's records still exist, the keeper saves the child's year entry. It is built from live records at that moment (so tier 3 does **not** depend on the purge existing). The keeper confirms "this is my child, {first name}" for each new year; **FNE never matches students across years, classrooms or schools by name, username or student number**. The keeper is the identity glue, which removes any need for a shared student identifier.
5. **The profile never points back into the classroom.** No foreign key to `classroom_students`, `classrooms`, a teacher or a school. The purge cannot reach it, and a school cannot be identified from it.
6. **Standing consent, later.** An optional "save each year automatically while this child stays linked" can come after the manual button has proven itself (D10); it is revocable and not part of the first release of tier 3.

### 6.4 What a profile stores (and does not)

| Stored | Not stored, ever |
|---|---|
| A first name or nickname the keeper types (no last name needed) | School, district, teacher or classroom names or ids |
| Birth month and year, only so ownership can pass at the right age (D6) | Date of birth in full, address, phone, photo, gender, anything demographic |
| Per saved school year: the grade band (elementary, middle, high), and for each attribute: practiced / touched / not yet, with the names of the activities finished | Quiz answers or scores, game scores, accuracy, time spent, streaks |
| The words the student pinned (max 3 a year), copied at save time | Any reflection or goal the student did not pin |
| The framework name and item code as they were that year (so a later change to a framework does not rewrite history) | A comparison, rank, percentile or "level" |

### 6.5 Ownership over time

- **While a minor:** the keeper (the guardian) owns it and signs in with their own account.
- **At 18 (D6):** ownership passes to the young person. They create a `site_users` account (or sign in with an existing one), and the keeper approves the transfer with a one-time code. On acceptance the keeper's access ends. A young person cannot claim a profile without a code from the keeper; if the keeper has died, closed their account or cannot be reached, FNE staff can transfer it on written request after checking identity (a manual, audited step; never self-service).
- **13 to 17 (optional, D6):** the keeper may share the portrait with the teen by a link (section 6.6). A separate teen login is **not** built; if wanted later, it is its own requirements document (it is option B in miniature).

### 6.6 Sharing

Private by default. The owner can make a **read-only link** (for an application or an interview): a random unguessable token (`crypto.randomBytes`), no sign-in needed to open it, shows the portrait with the keeper's chosen first name, expires in 30 days by default (owner can choose 7 to 90), and can be revoked at any moment. The page is `noindex`, never listed, never searchable, and there is **no public directory, no community, no profile page, no student-to-student view**. Every opening is counted (a number, not who).

### 6.7 Deletion, inactivity and closing

- **Delete now:** the owner deletes the whole profile or one saved year in the browser; it is a hard delete, immediate, with a typed confirmation. FNE staff can do the same on a written request, written to the audit log.
- **If unused:** a profile with no sign-in and no saved year for **3 years** gets two reminder emails 30 days apart, then is deleted (D9). "Lifelong" means "until the family stops wanting it", not "forever by default"; COPPA expects personal information about children not to be kept longer than reasonably necessary.
- **Account closing:** closing the keeper's account (`lib/account-closing.js`) freezes the profile for **60 days** (nobody can view it, share links stop), then deletes it unless it has been transferred.
- **Backups:** the same "overwritten within 14 days" rule as student data.

## 7. Access matrix (proposed)

| Action | Student (PIN) | Linked parent | Keeper (owner of a profile) | Teacher | School admin | District admin | FNE staff | Anyone with a share link |
|---|---|---|---|---|---|---|---|---|
| See this year's portrait (tier 1) | Own only | Own children, via parent portal | n/a | No (they use the class view); a teacher sees a student's pins only on existing progress pages | No | No | No (support sees no portrait content) | No |
| Pin or unpin up to 3 reflections/goals | Own only | No | No | No | No | No | No | No |
| Open and print the keepsake (tier 2) | Own, in the window, unless the teacher turned it off | Own children, in the window | n/a | Switch it off or on for their own class | No | No | No | No |
| Turn "Families may keep a Portrait" on or off | No | No | No | No | **Yes, own school** | **Yes, own district (overrides schools)** | Yes, by request, logged | No |
| Create a profile and consent | No | **Yes**, own linked child, school switch on | n/a | No | No | No | No | No |
| Save a school year into the profile | No | Yes, as keeper | **Yes** | No | No | No | No | No |
| View the lifelong portrait | No (until ownership passes) | Yes, as keeper | **Yes** | No | No | No | **No** (staff see counts of profiles and the audit log only, never the content) | Yes, read-only, until the link expires or is revoked |
| Make, change or revoke a share link | No | Yes, as keeper | **Yes** | No | No | No | No | No |
| Delete a profile or year | No | Yes, as keeper | **Yes** | No | No | No | **Yes, on written request, audited** | No |
| Transfer to the young person at 18 | No | Approves with a code | **Yes** | No | No | No | **Yes, manual, after identity checks, audited** | No |
| See that a profile exists / how many | No | No | Own only | No | **Count only** for own school (a number, never a name) | **Count only** | Yes, counts | No |
| Anonymous visitor, other students, other parents | No | No | No | No | No | No | No | No |

Second-level scope: every `:studentId`, `:profileId` or `:yearEntryId` is checked against the verified session (the student's own id; a parent's own confirmed link; a keeper's own profile), answering **404, never 403**. The student session has no route into profiles. The three existing auth systems stay separate; this adds **no** new JWT kind (the keeper is a `site_users` session). **Sales-demo accounts** are refused for profiles and share links (demo data only, no real families), but can use tiers 1 and 2 on demo students.

## 8. Rules that must not erode

1. Evidence of practice only; no scores, ranks, comparisons or mastery words (section 3).
2. Verified connections in verified frameworks only; enforced in SQL.
3. FNE never links a child across years, classrooms or schools on its own. Only a person asserting it.
4. A profile has no pointer into any classroom, teacher or school.
5. Staff cannot read a profile's content. Support works from counts, the audit log and the owner's own screenshots.
6. No third-party scripts, fonts or analytics on any portrait page (`self-hosted-assets.test.js` applies); the share page loads nothing external.
7. Pinned words are the student's choice and are pointers, not copies, in tiers 1 and 2; they are copied only at the moment a keeper saves a year, and only those pinned.
8. No AI writes, scores or summarizes anything on the portrait.
9. Public wording changes in the same release as the behavior it describes (Student Data Privacy page, Help center, a new customer release note as a draft because it touches privacy; a how-to video; legal-reviewed consent text for tier 3).
10. Rate limits (`lib/rate-limit.js`) on the share-link page and the keeper actions; `typeof` checks on every body field; `crypto` randomness for tokens and codes.

## 9. Lawyer questions (tier 3 only; do not build before these are answered)

I am not giving legal conclusions. These are the points where the design could be unlawful or contract-breaking, in rough order of risk.

1. **Student-profile statutes.** Several states restrict an operator from building a lasting profile of a student except for school purposes (California's SOPIPA and its imitators; Illinois SOPPA and others). Does a **parent-directed, opt-in, parent-owned** portrait fall outside them in New York and in the other states we may sell to? The design starts New York only for this reason, and the school switch (6.3) is a second brake.
2. **New York Education Law 2-d and the Parents' Bill of Rights** (already on the site). Can a vendor keep student-derived information after a contract ends if a parent directs it? What do district data protection agreements need to say? (Many say delete on termination.)
3. **COPPA.** Is the school-verified parent link plus email confirmation plus the consent screen enough as **verifiable parental consent** for the keeper to create a profile about a child under 13, given the information comes from the school's classroom records and not from the child directly? Is "email plus" acceptable because nothing is disclosed to third parties?
4. **FERPA.** Is a parent saving a copy of their child's records into a family profile simply a parent exercising their access rights, and does it change the school-official status of FNE for the classroom records?
5. **Retention.** Is "deleted after 3 unused years, with two reminders" a defensible reading of "no longer than reasonably necessary"?
6. **Age of transfer.** 18 as the age of majority; confirm no state needs a different age or a minor's own consent at 13 to 17.
7. **The share link.** Does letting a parent send a child's portrait to a third party (a college, an employer) via a link make FNE a discloser of a child's information? Does it matter that the owner, not FNE, sends it?
8. **Cyber insurance and the security questionnaire.** The answer sheet in `docs/sales/` says no student-derived data is kept beyond the school year; the lifelong option changes that answer for schools that switch it on.

## 10. Dependencies and the data we do not have yet

- **Phase 0 of Graduate Evidence still blocks richness.** Until the owner verifies the drafted New York connections (the 144 game connections) in `admin-standards.html`, most attributes have no verified connection, so the portrait would be mostly "not connected yet". Do not build the screens against an empty crosswalk and call it done.
- **Retention phase 3 and 4 are not built.** Tier 1 and tier 2 work without them. Tier 3 saves from live data on the keeper's click, so it also works without the purge. The purge, once built, needs nothing from tier 3 (profiles have no classroom pointers); the *school switch* and the consent record are tier 3's own.
- The Graduate Evidence year snapshot (Release 155) is class-level and de-identified; it is unrelated storage and is **not** the source for a profile (a profile needs one named child's activity, which exists only in live records).

## 11. Decisions to confirm

| # | Question | Recommended |
|---|---|---|
| D1 | Who sees tier 1 and the keepsake? | The student, their linked parents, and nobody else; the teacher can switch the keepsake off for their class |
| D2 | Which frameworks? | Both New York frameworks together (SEL benchmarks and Portrait of a Graduate), as in Graduate Evidence |
| D3 | May a student put their own words on the portrait? | Yes, up to 3 a year, only what they pin, shown only to them and their parents |
| D4 | The keepsake window | 1 June to the purge date; always available for the current year until the purge exists; teacher can turn it off for their class |
| D5 | Identity model for the lifelong portrait | **Option A** (a profile owned by a linked parent's existing account), with the downloadable file (option C) offered as the no-hold alternative. Option B (a student login with email) is not built |
| D6 | Ownership handover | At 18, by one-time code from the keeper; birth **month and year** kept only for that; no teen login for now |
| D7 | What a profile stores | Section 6.4 exactly; no school or classroom pointer; no scores |
| D8 | Who allows a family to keep a portrait? | The school admin or district admin, off by default; a district's choice overrides its schools |
| D9 | If a profile goes unused | Deleted after 3 years of no sign-in and no saved year, with two reminder emails; deleted 60 days after the keeper's account closes unless transferred |
| D10 | Saving a year | A manual "Save this year" by the keeper; automatic yearly saving only later, as an opt-in |
| D11 | Sharing | A read-only, random link, 30 days by default (7 to 90), revocable, `noindex`, no directory ever |
| D12 | May staff read a profile? | No; counts and audit log only; transfers and deletions by written request |
| D13 | States | New York only for tier 3 until the lawyer answers section 9; tiers 1 and 2 follow whatever states Graduate Evidence supports |
| D14 | Build order and a gate | Tiers 1 and 2 first (they need no lawyer), tier 3 only after section 9 is answered and the owner has verified the New York connections |

## 12. Build phases

| Phase | What | Needs |
|---|---|---|
| 0 | Owner verifies the drafted New York connections (Graduate Evidence phase 0) | The owner |
| 1 | `studentPortrait()` + tests on `node:sqlite` (every rule in sections 3 and 4; another student's id is unreachable) | D1 to D3 |
| 2 | Tier 1: `student-portrait.html`, route, pins table (`alter-create-student-portrait-pins.js`, `schema.sql`), link from the student home and achievements | Phase 1 |
| 3 | Tier 2: print layout, parent-portal view, the teacher's on/off switch, window rules | D4, Phase 2 |
| 4 | Help center answers (drafts until read), customer release note (draft), how-to video, Student Data Privacy wording, `videos-to-review.js` check, CHANGELOG, `PROJECT.md` | Phases 2 and 3 |
| 5 | **Lawyer review of section 9; consent text; school/district switch** (tier 3 gate) | D5 to D13 |
| 6 | Tier 3: profile + consent + year entries + keeper screens (parent portal), `portrait_*` tables, tests for the whole access matrix | Phase 5 |
| 7 | Share links, deletion, inactivity job, account-closing freeze | Phase 6 |
| 8 | Handover at 18, staff transfer tool, audit rows | Phase 7 |

New tables (proposed): `student_portrait_pins` (phase 2); `portrait_profiles`, `portrait_year_entries`, `portrait_consents`, `portrait_share_links`, plus a school/district setting column or `settings`-style table for the switch (phases 5 to 7). New settings: none until phase 5. Node restarts needed with each phase that adds routes.

# Game pages, parent games and standards line, lesson and game favorites (requirements)

Written 2026-11-08. **Approved by the owner 2026-11-08 (build order and the three decisions at the end, as recommended). Release 163 (game pages) is built and staged; 164 and 165 are not started.** Three features, built in this order because each leans on the one before: (1) a public page for every game, (2) the parent portal shows a child's assigned games and the SEL / Portrait connections of a lesson, (3) favorites for lessons and games with one My Favorites page. Owner answers already given: parent view adds **games assigned to my child** and the **SEL and Portrait of a Graduate line**; game pages are **public**; favorites are for signed-in site users, **not students**, with one combined page.

What already exists (so we do not rebuild it): `parent-lesson.html` + `GET /api/parent/lesson/:curriculumId` (overview, goals, materials, three PDFs, videos, no quiz, no reflections); `brain-games.html` (the games hub); `brain-<slug>.html` (each game, playable by anyone); `student-game.html` (iframe for assigned games); blog favorites (`/api/blog-favorites`, `blog-favorites.js`, Release 91).

## 1. Per-game pages

**What it is:** `game.html?slug=<slug>`, one template for all games. Public, open to anyone, indexable. Shows: icon, name, one-line description, grade band (Discover K-1 style wording already in `brain-game-copy.js`), focus, primary skill, SEL competency tags, "Connects to" (verified standards connections only, grouped by state, with the existing "FNE's thematic mapping, not a state or CASEL endorsement" note), a **Play** button (opens `brain-<slug>.html`, same as today), and for a signed-in teacher an **Assign to a classroom** link to the classroom page. A star appears in release 3.

**Access matrix**

| Who | See the page | Play | Assign shortcut |
|---|---|---|---|
| Anyone, signed out | Yes | Yes (progress is not saved, as today) | Hidden |
| Signed-in site user | Yes | Yes | Teachers only (link to `teacher-classrooms.html`; the assign step keeps its own checks) |
| Student (PIN) | Not linked from their pages; the URL works but shows only public text | Via their assignment, as today | Hidden |
| Unknown or inactive slug | 404 page | | |

**API:** `GET /api/brain-games/:slug` (public, read-only; declared after the literal `/me/*` and `/sessions` routes). Returns only public catalog fields and `connections`. Filters: `active = 1`; the Tune Your Brain pilot flag applies exactly as in `GET /api/brain-games`. `connections` come from `lib/standards.js` SQL that already enforces verified framework, verified alignment, `district_id IS NULL`, and excludes the sales-demo district; reviewer `notes` are never returned (`forPublic()` rule). Rate limit: the public standards limiter (120 a minute).

**Links to the page:** every card on `brain-games.html`, the game chips on `state-standards.html`, and (release 2) the parent portal.

**Not in this version:** a sitemap (the site has none), per-game share buttons, play counts, screenshots.

## 2. Parent portal: games and the SEL line

**Games for my child.** `GET /api/parent/children` adds, per child, `games`: the active games assigned to that child's classroom (`classroom_game_assignments`), each with slug, name, icon, band, focus, due date, and **completed yes/no for that child only**. No score, no time, no badge. `parent-portal.html` shows a "Games" block under the lessons, each card linking to its game page.

**SEL and Portrait line.** `GET /api/parent/lesson/:curriculumId` adds `connections`: the verified connections for that lesson (applied to every grade version through the existing lesson stem rule), grouped by state, with the same no-endorsement note. Schools carry no state on record, so we cannot tell which state is the child's: the page lists **every state that has a verified connection (today New York and Ohio)** under a collapsed "How this connects to SEL and Portrait of a Graduate" heading. If none, the heading is hidden. District frameworks are not shown to parents (v1).

**Access matrix (new data only)**

| Who | Child's assigned games | Lesson connections |
|---|---|---|
| Parent linked to that student (`isLinkedParent`) | Yes, only for their own linked children's classrooms | Only for a lesson assigned to a classroom they are linked to (`hasParentAccessToCurriculum`, unchanged) |
| Parent, another family's child | 403 / not listed | 403 |
| Teacher, admin, student | Not through these routes | Not through these routes |

Second-level check: games come from the classroom ids returned by `getParentClassrooms` for this user, never from a request parameter. Nothing about other students is returned.

## 3. Favorites for lessons and games, My Favorites page

**Who:** any signed-in site user (teacher, parent, school or district admin, affiliate, sales-demo). Students (PIN) and the admin session: no. Private to the person; no counts shown to anyone else; the user id comes only from the session.

**What can be favorited:** a published lesson (any grade version is its own favorite; the lesson list is already public, so a license is **not** needed to star one; opening it still follows the existing license and parent rules), and an active game (same pilot-flag filter as the games list). Morning Boost posts stay as built.

**Tables** (new, cascading keys, composite primary key): `lesson_favorites (site_user_id, curriculum_id, created_at)` and `game_favorites (site_user_id, game_id, created_at)`. The existing `blog_post_favorites` is untouched.

**API:** `server/routes/favorites.js` at `/api/favorites`, all `requireSiteAuth`:
- `GET /api/favorites` -> `{ posts: [ids], lessons: [ids], games: [ids] }` (live items only, newest star first; posts reuse the blog query).
- `PUT /api/favorites/lessons/:id` and `PUT /api/favorites/games/:id` with `{favorited: true|false}`: a set, not a toggle; 400 bad input (`typeof` and digit check before use), 404 not published / not active, 409 at 500 per kind, 429 at 60 changes a minute per person (shared across kinds). Removing always works. `/api/blog-favorites` keeps working exactly as today.

**Browser:** one reusable `favorites.js` (generalises `blog-favorites.js`: same optimistic star, rollback, sign-in memory, Undo toast; `blog-favorites.js` stays for the Morning Boost page until a later cleanup so that page is not at risk). Stars go on: lesson cards (`education-portal.html`), lesson detail (`lesson-detail.html`), the teacher library browse cards (`teacher-lesson-plans-browse.html`), game cards (`brain-games.html`) and the game page.

**My Favorites page:** `my-favorites.html`, with chips All, Lessons, Games, Morning Boost. Signed out: "Sign in to see your favorites" with a sign-in button. Empty states per chip. The menu link "My Favorites" (`site-auth.js`) points here instead of `morning-boost-blog.html?view=favorites`. Lessons the person can no longer open (license ended) stay listed and show as locked. Unpublished items are hidden but stay favorited.

**Access matrix**

| Who | List own | Add | Remove |
|---|---|---|---|
| Signed out | No (401); page shows sign-in | No | No |
| Signed-in site user | Own only | Published lesson, active game | Always |
| Student (PIN), FNE admin session | No | No | No |
| Anyone, another person's favorites | Impossible | | |

## Releases, deploy and the rest

- **Release 163, game pages:** `game.html`, one route, links from the hub and standards page. No schema change. Deploy: push, pull, rsync, restart Node (new route). No alter script.
- **Release 164, parent view:** changes to `routes/parent.js`, `parent-portal.html`, `parent-lesson.html`. No schema change. Deploy: rsync + restart Node.
- **Release 165, favorites:** two tables (`alter-add-lesson-game-favorites.js` + `schema.sql` + `SCHEMA.md`), route, `favorites.js`, `my-favorites.html`, stars, `site-auth.js` version bump on every page that loads it. Deploy: **run the alter script before the Node restart**.
- Customer release notes: one note per release, **drafts** (they touch what parents see), humanized wording. Videos: the video check runs on every commit; B/C parent videos and the browse-lessons videos probably need a re-record after 164/165, a new "game pages and favorites" video is proposed; nothing uploads without your OK.
- Tests: route tests on the real SQL engine (`node:sqlite`, portable SQL only), client-logic tests for `favorites.js`, wiring tests, and a syntax guard on the new pages (an apostrophe once blanked a page). Check on the local MariaDB stack with two accounts and one parent link.
- Public-repo rule: no real emails or child names in tests or fixtures; use `@example.com` and fake schools.

## Decisions I need from you

1. **State on the connections line:** list every state with a verified connection (NY and OH today) grouped by state, because schools have no state on record. OK? Alternative: add a state to schools first (bigger, touches onboarding).
2. **Order:** game pages, then parent view, then favorites (each deployable on its own). OK?
3. **Parents see no scores for games** (completion only), matching the decision that parents see lesson completion only. OK?

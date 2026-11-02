# Release 86: band wording, built and held for your review

Written 2026-11-02. **Built and tested locally, not committed.** Follows `R86_BAND_WORDING_OUTLINE.md` with all five decisions taken as recommended (story text on screen for Explore and up, neutral look after money-game choices, "demo" wording fixed for every band, Discover story text left for Release 87). The strings went through the humanize pass; one line changed: Advance's "A stronger sentence is available." became "Another sentence is stronger."

## What changed

| File | Change |
|---|---|
| `engine-sdk.js` (`?v=3`) | New copy table `COPY` and `FnEngineSDK.t(key, band, pack)` / `stepLabels(band, pack)`. Lookup: the game's own `contentPack.copy` or `stepLabels`, then the band, then today's wording. The finished screen reads its title and button from the table |
| `engine-evidence-hunt.js` (`?v=1`, was unversioned), `engine-simulation.js` (`?v=3`), `engine-branching-scenario.js` (`?v=5`) | Wording read from the table instead of written in the engine |
| `engine-scenario-choice.js` (`?v=4`) | Explore, Challenge and Advance show the story as text under the emoji; Discover keeps it spoken and screen-reader only |
| `brain-games.css` (`?v=4`) | `.fn-shell-feedback.neutral` and `.fn-story-text` |
| Idea Lab, Community Voice, Perspective Swap, Fix-It Workshop | Their own step labels (`stepLabels`) |
| 36 pages | Cache numbers |
| `server/test/band-copy.test.js` (new) | 10 tests: defaults equal today's wording; unknown band falls back; a game's override wins key by key; five step labels in every band; no dashes, nothing over 12 words, no "demo" in band strings; money games neutral; engines hold no leftover strings; step-label overrides complete; story text rule; every page has the new versions |

No server change, schema change or Node restart.

## What I played in the browser (local site)

- **Critical Read (Advance):** proof question reads "Which sentence best supports your conclusion?"; finished screen "Debrief", labels Supported / Weakly supported / Not supported, button "Try again".
- **Headline (Challenge):** correct answer shows "Correct. The text backs it up."; finished screen "Run complete", button "Run it again"; labels stay the defaults, as planned.
- **Money Matters (Advance):** after a choice, a neutral box (slate, light text) reads "Noted. Next decision." instead of a green success box.
- **Idea Lab (Advance):** step labels The need / The ideas / The trade-offs / The test / What you learned; the reflection box says "Your takeaway. Private, not saved."
- **Choice Quest (Explore):** What is happening? / Who does it affect? / What could you do? / Pick your best move / Think it over; reflection hint "What will you remember?"; finished screen "Level complete!".
- **Values Compass (Challenge):** the story ("Dara is stuck on her science project...") now shows on screen under the compass emoji.
- **Feelings Detective (Discover):** no story text on screen, as before; **Calm Down Corner** finishes with "You did it!" and the yellow R85 button.

## Tests

`cd server && npm test` gives **154 pass** (144 before, 10 new) when run without `seat-renewal.test.js` (see below).

## Heads-up: another session's work is in this checkout

While I worked, another session added uncommitted changes in the same folder: `admin-licenses.html`, `server/db/schema.sql`, `server/lib/seat-renewal.js`, `server/routes/newsletter.js`, `server/routes/school-admin.js`, expire scripts, an alter script and `server/test/seat-renewal.test.js`. Those are **not** part of Release 86 and I have not touched or staged them. A plain `npm test` stalled on `seat-renewal.test.js` (probably unfinished); I ran every other test file instead. When I commit R86 I will stage only my own files by name.

## Not done or not checked

- Wording of any game's own stories, options and headers (Releases 87 to 89), and Discover's spoken "Correct!" and "Not quite" lines (Release 87).
- Phone widths; the screen-reader announcements by ear (I checked the text values, not the audio).
- Second-pass reading of every Explore and Challenge string by you; the full table is in the outline.

## Help video check (at commit)

`brain-feelings-detective.html` (S2) gets only cache-number changes and `brain-games.html` (S4) only a stylesheet version, so I expect both to stay correct; I will run `node server/scripts/videos-to-review.js` on the staged files and record the judgment then.

## Deploy (after you approve and I commit)

Static files only: push, cPanel `git pull`, the broad rsync. No restart, no alter, no `npm install`.

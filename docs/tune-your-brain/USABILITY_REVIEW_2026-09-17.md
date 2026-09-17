# Tune Your Brain — Usability Review, 2026-09-17

Prompted by the user reporting that the Brain Games filters were dropping 6 of 14 games under any specific band filter, and separately flagging that Discover-band games need graphics and fonts genuinely sized for their audience. This document records what a direct inspection of the running pages found — not just a read of the CSS.

## The filter bug (confirmed and fixed)

`brain-games.html`'s `renderFilteredGrid()` used `g.band === activeBand` as its band predicate. The 6 legacy games have `band: NULL` by design (they were never built for one specific band — see `alter-add-brain-games-band.js`'s own header comment), but `NULL === 'challenge'` (or any specific band) is `false`, so **the moment any band chip other than "All" was active, all 6 legacy games vanished**, leaving only the subset of the 8 new games that happened to match that band. Cycling through every band chip without ever selecting "All" only ever surfaces the 8 new games — exactly what was reported. `teacher-classroom.html`'s equivalent filter already had the correct logic (`!g.band || g.band === band`); `brain-games.html`'s didn't match it. Fixed to the same predicate.

## Discover-band graphics — confirmed by loading the page directly, not just reading CSS

Serving the repo locally and opening `brain-sound-safari.html` (band-aware CSS applies with no server dependency — the content pack is a client-side literal) showed the actual problem clearly:

- The header "graphic" was a single 🦁 emoji at a **fixed 52px**, not scaled by `--band-scale` at all, floating alone on plain white.
- The 3 answer choices rendered as **thin, wide, mostly-empty horizontal list rows** (measured: 568px wide × 56px tall) with a tiny emoji — measured font-size **15px**, again **not scaled by `--band-scale`** despite the element carrying the `.band-aware` class.

**Root cause of the "not scaled" finding, precisely:** `.band-aware { font-size: calc(1em * var(--band-scale, 1)) }` is defined early in `brain-games.css`, but `.fn-choice-btn { font-size: 15px }` (and `.game-page-header .game-icon { font-size: 52px }`) are defined later with equal CSS specificity — in a specificity tie, the later rule in source order wins, so the fixed pixel values silently overrode the band-scale calc on exactly the two elements that most needed to scale. This wasn't a missing feature so much as a real, silent cascade bug: the band-aware system was built and wired up correctly (`data-band` gets set, `--band-scale`/`--band-target-min` are real and correctly defined per band, tap-target *height* genuinely is larger for Discover at 56px), but two specific rules quietly opted back out of it.

**Fixed:** both rules now read `calc(<base> * var(--band-scale, 1))`, so this benefits every band a little (Explore/Challenge/Advance choice-button text and icons now scale slightly too), not just Discover.

## What "large graphics" actually needs, beyond the scaling bug

Scaling the *existing* emoji up doesn't turn it into what the blueprint's own art direction (§7.2) or the reference images (shared by the user — one target look per band) describe. None of the 14 games have any real illustrated character or environment art; every game's entire visual identity is a single generic system emoji. The 4 reference images make this concrete:

- **Discover**: full-bleed illustrated scenes — a biplane towing letter tiles across a sunset sky, cartoon forest animals each holding a letter, frogs on lily pads for counting. "An interactive children's world," not a dashboard with a small icon.
- **Explore**: adventure/quest framing — dark fantasy dialogue screens, a glowing honeycomb math puzzle, a jungle "mission" vocabulary screen. Colorful, but the student drives the action rather than a character leading everything.
- **Challenge**: anime/visual-novel aesthetic — stylized human avatars, mission-briefing dialogue, a Duolingo-style stats profile. Explicitly "no cartoon zoo, no oversized primary-color buttons, no childish celebration graphics."
- **Advance**: dark-mode analytics-dashboard aesthetic — streak heatmaps, progress rings, Kanban-style mission boards. Reads as a serious consumer app, not a game skin.

This is a full per-band visual-identity build, not a shared-skin size adjustment — a real design/production initiative (sourcing or commissioning real art, likely per the blueprint's own never-built §7.7 asset pipeline: tagging, licensing, accessibility alternatives), separate from anything one engineering pass can close.

## The Discover-band visual prototype built in this pass

Per the user's direction (prototype one band now, decide after seeing it — Discover chosen as the most-built and furthest from target), `brain-games.css` gained a `html[data-band="discover"]`-scoped block: an illustrated backdrop (sky gradient, a sun, rolling hills, all CSS/pseudo-elements, no image assets) behind a much larger (100px) header icon, and the choice list changed from a vertical stack of thin rows to a grid of large (130px-tall, 60px-glyph) square picture cards. Scoped entirely to Discover — Explore/Challenge/Advance are untouched — and reversible, since it's CSS-only with no engine/JS changes.

**This is explicitly a direction prototype, not production art.** It's still emoji-based, not real illustration — it's meant to test whether "bigger, card-based, backdrop-framed" reads as enough of an improvement to build on, or whether real illustrated assets are needed before this feels genuinely like "an interactive children's world." Screenshotted before/after during this session for a side-by-side comparison.

## Another real gap surfaced while reviewing this: engine audio coverage

`engine-branching-scenario.js`, `engine-simulation.js`, and `engine-evidence-hunt.js` have zero audio support (confirmed via grep — no reference to audio or speech synthesis anywhere in any of the three). Only `engine-audio-choice.js` narrates. This directly limits what SEL content can genuinely serve the Discover band: Branching Scenario's 5-step text-based decision cycle (used by Decision Point and Choice Quest) conflicts with Discover's own "no reading required, spoken support" requirement (§7.2). It's the right engine for Explore/Challenge/Advance SEL content, where reading is developmentally expected — but a true Discover-band SEL game needs either Audio Choice's existing narration (a simpler, single-select mechanic) or a future audio-narration extension to Branching Scenario. See the SEL × band scoping note in `GAP_ANALYSIS_2026-09-17.md`'s next update for how this shaped the recommended game list.

## Not reviewed in this pass

- The 6 legacy games' own presentation (this review focused on the reported filter bug and the Discover-band graphics report specifically).
- Mobile/touch device rendering of the new card-grid layout (desktop-only screenshots taken this session).
- Any of Explore/Challenge/Advance's actual rendered presentation against their reference images — flagged as a real gap here, not yet inspected page-by-page the way Discover was.

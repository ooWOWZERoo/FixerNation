# Release 85: color themes, built and held for your review

Written 2026-11-02. **Built and tested locally, not committed.** Follows `R85_COLOR_THEMES_OUTLINE.md` with the choices you made (Advance as a full-width dark band) and my recommended defaults for the other two (yellow Discover button, deeper orange Explore button).

## What changed

| File | Change |
|---|---|
| `brain-games.css` | New `--g-*` color hooks on `:root` (defaults equal the old colors); shared rules now read them; four band theme blocks at the end of the file, each on `html[data-band="..."] .game-frame` |
| `engine-branching-scenario.js` | Step label color is `var(--g-accent, var(--coral))` (one line) |
| 36 game and catalog pages | `brain-games.css?v=1` to `?v=3`; 12 pages `engine-branching-scenario.js?v=3` to `?v=4` |
| `server/test/band-themes.test.js` (new) | 12 tests: every band sets every hook; every text pair is at least 4.5 to 1; every outline, button, accent and score pair is at least 3 to 1; the unbanded page keeps its original colors; only the four bands have themes; every page loads the new versions |

No server, schema or Node-restart change. Suite: **144 pass** (132 before, 12 new).

## How it looks (checked in the browser, desktop width)

- **Advance (First Shift):** the strip between the site header and footer is dark slate; the panel is a slightly lighter slate with a thin border; cyan "RECOGNIZE THE ISSUE" label; light text; idle options have a visible grey outline; the picked option gets a cyan outline, the others dim, and the feedback box is dark green with green text.
- **Discover (Calm Down Corner):** warm cream page, sky header unchanged, tiles with thick **dark** outlines (3px, was a barely visible tint). After a pick, the chosen wrong tile turns pink with a red outline, the right tile green with a green outline, and the untouched tile greys out. (I confirmed these colors by reading the computed styles after the click.)
- **Explore (Choice Quest):** lilac page, purple step label, purple outlines on the options.
- **Challenge (Headline):** cool grey-blue page, slate text, neutral outlines.
- **Legacy (Memory Match):** unchanged: no band, coral button, no page background.

## Where I differed from the outline

1. **The full-width band applies to all four bands**, not just Advance (each has its own page color). The site header and footer stay as they are.
2. **Explore's progress bar starts at `#15803D`**, not `#16A34A`; the lighter green failed 3 to 1 against the track.
3. **Disabled options now grey out after you answer** in every band (before, they stayed white). The text stays readable (4.5 to 1 or better) so players can still read the options they did not pick.
4. **An amber "partial" state is defined in the CSS** (feedback box and option) but nothing uses it yet. The "right answer, weak evidence" result still shows red until Release 86 changes the engine.
5. **Stylesheet version is `v=3`**, not `v=2`: I bumped once more during testing after fixing the frame text color. Production is on `v=1`, so nothing is skipped.

## Things I did not do or could not check

- Phone widths and real devices: the layout rules are unchanged, but I only looked at a 1000px-wide pane.
- Dark mode of the **accessibility panel and toast**: they live outside the game frame and keep the light brand look on purpose.
- The results screen, the catalog page cards and the badge pages: unchanged, not re-checked by eye.
- The pre-existing overlap of the nav links with the logo at narrower widths is on the site header, not part of this change.

## Help video check (done at commit)

`brain-games.css` is watched by the recorded video **S4, Play and track brain games**. That video walks the catalog and progress pages, which this release does not restyle, so I expect to judge it still correct; I will run `node server/scripts/videos-to-review.js` on the staged files and record the judgment in `VIDEO-STATUS.md` in the same commit.

## Deploy (after you approve and I commit)

Static files only: push, cPanel `git pull`, the broad rsync. No restart, no alter script, no `npm install`. I will give the exact command blocks with the commit.

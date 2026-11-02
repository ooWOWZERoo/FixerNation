# Release 85: color themes by Learning Group (outline, for your approval)

Written 2026-11-02. Outline only: nothing is built until you approve or edit it. This is the first release from `GAME_LANGUAGE_COLOR_AUDIT.md` (section 3a). **Color only. No wording changes** (those are Releases 86 to 89).

## What changes, in one paragraph

Today every band-assigned game uses the same cream, teal and coral look; only Discover has extra styling. After this release each of the four groups has its own palette, set in one place (`brain-games.css`) and switched by the `data-band` attribute the games already set. The site header and footer, the catalog page (`brain-games.html`) and the six legacy games (which have no band) look exactly as they do now.

## How it is built (low risk)

1. Add a small set of **semantic variables** on `:root` in `brain-games.css` (page, panel, text, muted, accent, button fill and text, outline idle and selected, selected tile, ok / weak / unsafe feedback, progress bar, evidence highlight). Their defaults equal today's colors, so any page without a band renders unchanged.
2. Point the existing shared rules at those variables: `.game-card-panel`, `.game-page-header`, `.btn-primary` (inside a game page), `.fn-shell-*`, `.fn-choice-btn` and its states, `.fn-stimulus-box`, `.fn-passage-box`, `.fn-sim-resource`, `.results-score`, `.pb-banner`.
3. Add one block per band (`html[data-band="..."]`) that sets the variables. The existing Discover decorations (sky header, big tiles) stay and just pick up the new colors.
4. One line in `engine-branching-scenario.js:37`: the step label color changes from `var(--coral)` to `var(--g-accent, var(--coral))`. That engine's `?v=` is bumped on every page that loads it (the branching-scenario games; I will grep for the exact list).
5. `brain-games.css?v=1` becomes `?v=2` on all 36 pages that reference it.
6. A new test (`server/test/band-themes.test.js`) reads the theme blocks from the CSS and checks the contrast of every text and outline pair below (4.5 to 1 for text, 3 to 1 for outlines and buttons), so a later edit cannot quietly break readability.

No server change, no schema change, no Node restart. Deploy is `git push`, cPanel `git pull`, and the usual rsync.

## The four palettes

Contrast ratios are measured. My first draft in the audit failed on three things (Explore's orange button at 3.6, and the idle outlines in Explore, Challenge and Advance at 1.4 to 1.9), so those values changed.

| | Discover (5-6) | Explore (7-10) | Challenge (11-13) | Advance (14-18) |
|---|---|---|---|---|
| Mood | Bold primaries, strong outlines | Bright, sorted by color | Cool, structured, "app-like" | Dark slate, calm, cinematic |
| Page / panel | `#FFFBEB` / `#FFFFFF` | `#F5F3FF` / `#FFFFFF` | `#F1F5FB` / `#FFFFFF` | `#0F172A` / `#1E293B` |
| Text / muted | `#2A2420` 15.3 / `#6B5F55` 6.2 | `#2A2420` 15.3 / `#6B5F55` 6.2 | `#1E293B` 14.6 / `#475569` 7.6 | `#E2E8F0` 11.9 / `#94A3B8` 5.7 |
| Primary button | `#FFD21F`, ink text 10.6, 3px ink border | `#C2410C`, white text 5.2 | `#4F46E5`, white text 6.3 | `#38BDF8`, text `#0B1220` 8.7 |
| Accent (step label, progress) | `#D62828` | `#7C3AED` (5.7) | `#2563EB` (5.2) | `#38BDF8` (6.8) |
| Choice outline, idle | **3px `#2A2420`** (15.3; was 15% teal) | 2px `#8B7FD6` (3.4) | 2px `#7C8BA1` (3.5) | 1px `#64748B` (3.1) |
| Choice, selected | border `#2A2420`, fill `#FFF3B0` | border `#7C3AED`, fill `#EDE9FE`, text `#4C1D95` (9.2) | border `#2563EB`, fill `#DBEAFE`, text `#1E3A8A` (8.5) | border `#38BDF8`, fill `#0C2A3F` (12.0) |
| Correct | `#DCFCE7` / `#16A34A`, text `#14532D` (8.3) | same as Discover | `#CCFBF1` / `#0F766E`, text `#115E59` (6.7) | `#0F2A24`, border and text `#34D399` (7.9) |
| Weak or incomplete | `#FEF3C7` / `#D97706`, text `#78350F` (8.2) | same | same | `#2A2110`, `#FBBF24` (9.5) |
| Unsafe or wrong | `#FEE2E2` / `#DC2626`, text `#7F1D1D` (8.2) | same | same | `#2A1517`, `#F87171` (6.2) |
| Progress bar | `#D62828` to `#FFD21F` | `#16A34A` to `#EA580C` | `#2563EB` to `#7C3AED` | `#38BDF8` to `#0EA5E9` |
| Disabled | `#E5E7EB`, text `#6B7280` | same | `#E2E8F0`, text `#64748B` | `#273449`, text `#64748B` |
| Evidence highlight | gold `#EBA657`, ink text | same | same | same (ink text, still readable on dark) |
| Corner radius | 28px (unchanged) | 22px (unchanged) | 12px (unchanged) | 10px (unchanged) |

What each group's color is for:
- **Discover:** dark, thick outlines so every tile reads at a glance; yellow is the "go" button; the feedback outline on the tile itself is the clearest signal. (Color-as-answer, like "tap the red one", is a content change per game and belongs in Release 87.)
- **Explore:** purple means "selected", orange means "next step", green and amber show the outcome; greyed tiles make active versus inactive obvious.
- **Challenge:** blue and violet on a cool grey page, amber instead of red for "incomplete", so it stops looking like a picture-book.
- **Advance:** dark slate with one cool accent. Red appears only for the unsafe choice type.

## Things I need you to decide

1. **Advance dark: how wide?**
   - **A. Full-width dark band (recommended).** The area between the site header and footer goes dark slate; the header and footer stay cream. More immersive.
   - **B. Dark card only.** The game panel is dark on the normal cream page. Smaller change, less atmosphere.
   - **C. Light but cool.** Slate and blue on white, no dark. Safest, least different.
2. **Discover primary button:** yellow with a dark outline (recommended, it is the one yellow thing on the page), or keep the teal button?
3. **Explore orange:** the button uses a deeper orange-red `#C2410C` so white text passes; the brighter `#EA580C` appears only in the progress bar. OK?

## What I will not touch in this release

Any game wording or content; the catalog page (`brain-games.html`, band tags and card headers come with Release 89); the six legacy games and their saturated colors (Stroop must stay bright); badge and progress pages; the site header and footer.

## After you approve

Build it, run `cd server && npm test` (the new contrast test plus the existing 132), play one game per band in the browser at desktop and phone widths (screenshots into a review note for you), and check Memory Match and Stroop still look the same. Hold it uncommitted for your read, then commit as Release 85. The recorded help video S4 (Play and track brain games) watches `brain-games.css`; at commit I will judge whether it still matches and record that in `VIDEO-STATUS.md`.

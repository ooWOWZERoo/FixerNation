# Tune Your Brain: language and color audit by Learning Group (DRAFT)

Written 2026-11-02 by Claude from a read-only pass over all 31 games, `brain-games.css`, `brain-games.html` and the five engines (audioChoice, evidenceHunt, scenarioChoice, branchingScenario, simulation). **Nothing has been changed in the games.** Every rewrite and hex value below is a proposal for your review; the owner signs off all child-facing wording. Line numbers were spot-checked against the files on 2026-11-02.

Framework used: Discover (ages 5-6), Explore (7-10), Challenge (11-13), Advance (14-18), with the language and color criteria from your brief.

## 1. Current state audit

### The headline finding

**Color does not change by age group, and shared engine wording does not change by age group.** `brain-games.css:374-402` says so in its own header: bands change only scale, radius, target size and motion, "none of them change the color palette itself." Only Discover gets extra rules (sky header, bigger tiles, 3px borders). Every page from Explore through Advance renders the same cream, teal and coral look with a coral pill button and green/red feedback boxes. Not one of the 25 band-assigned pages has its own `<style>` block or hex values; all color comes from `brain-games.css` plus inline styles in the engines. Result: an Advance page looks like a Discover page.

Shared tokens today (`brain-games.css:2-26`): cream `#FBF5EC` / `#F3EBDD`, teal `#164F4A` / `#0E3733`, coral `#F26B4D` / `#D9502F`, gold `#EBA657`, ink `#2A2420`. Game colors: green `#22c55e`, red `#ef4444`, blue `#3b82f6`, yellow `#eab308`, purple `#8b5cf6`, orange `#f97316`. Purple, orange, blue and yellow are defined but never used by any game page or engine.

### Game-by-game fit

Fit scale: **Good** = language and color match the group, **Partial**, **Poor**. Color is Poor or Partial for every band-assigned game because of the shared palette, so the table scores language and notes color only where a game differs.

| Band | Game | Engine | Language fit | Notes |
|---|---|---|---|---|
| Discover | Calm Down Corner | audioChoice | Partial | Stories 10-11 words; "frustrated", "embarrassed" |
| Discover | Sharing Circle | audioChoice | Poor | 12-15 word two-clause sentences |
| Discover | Helper's Choice | audioChoice | Poor | "responsible" (abstract); a 17-word sentence |
| Discover | Feelings Detective | scenarioChoice | Poor | Cues and feedback 11-21 words; "(s)" in prompt; needs reading; **loses all Discover styling** (`long-text` opt-out) |
| Discover | Sound Safari | audioChoice | Good | ~7-word spoken line; question not spoken; "/m/" notation may be mis-read by browser voice |
| Discover | Same and Different | audioChoice | Partial | Short sentences but stories up to 43 spoken words; only Discover game that speaks feedback |
| Explore | Choice Quest, Team Pick, Peace Table | branching | Partial | Options avg 15-17 words, feedback up to 27; "constructive", "perspective"; abstract step labels |
| Explore | Fix-It Workshop | branching | Poor | Longest options (avg 18, up to 24) and prompts (up to 40 words) |
| Explore | Reading Detective | evidenceHunt | Good | Closest to the Explore rubric; "Missed" and red for "right answer, weak evidence" are harsh |
| Explore | Strength Spotter | scenarioChoice | Good | Short cues (3.7 words); only Explore game with speech |
| Challenge | Decision Point, Group Chat Meltdown | branching | Good | Plain-speech narrators, mild strategy words; little humor; Group Chat is stiff (no contractions) |
| Challenge | Headline, Say It Another Way | evidenceHunt | Good | Clear multi-step; "Missed" is blunt |
| Challenge | Money Moves | simulation | Partial | Content reads younger (allowance, cartoon lunch box); green "Logged..." box after every pick |
| Challenge | Values Compass | scenarioChoice | Poor | "Good noticing", "I've noticed these" are Explore voice; **story text is screen-reader and speech only, not visible on screen** |
| Advance | Critical Read | evidenceHunt | Good | Best text in the band; surrounded by cheerful shared strings |
| Advance | First Shift, The Post, Perspective Swap | branching | Good | Mature, nuanced content; praise openers ("Good catch."); generic worksheet step labels |
| Advance | Community Voice, Idea Lab | branching | Partial | Strong content, but step labels "Recognize the Issue" and "Choose a Responsible Response" do not fit civic planning or design thinking |
| Advance | Money Matters | simulation | Partial | Realistic (withholding, 24% APR); "that is normal" soothing line; "Logged..." green box |
| none | 6 legacy games (band NULL) | standalone | see below | Shown under every band filter |

Legacy (band NULL on purpose, `alter-add-brain-games-band.js`): Simon Sequence is the strongest primary-block page (`#ef4444` `#3b82f6` `#22c55e` `#eab308`, 🟥🟦🟩🟨, "❌ Wrong! Game over."). Reaction Time's praise ladder ("⚡ Lightning fast!", "👍 Nice!", "🙂 Good") is childish for teens. Memory Match uses cartoon animals and food. Number Sequence and Quick Math are neutral and fine for 11-18. Stroop Challenge needs saturated primaries by design (muting them weakens the effect).

### Catalog page (`brain-games.html`)

- Band tag reads "Discover (K-2)", "Explore (3-5)", "Challenge (6-8)", "Advance (9-12)". Your brief uses ages 5-6 and 7-10; K-2 spans 5-8 and 3-5 spans 8-11. Challenge and Advance line up.
- All four band tags are identical translucent white pills; all card headers share one teal gradient (`brain-games.css:109`); every "Play Now" is coral; level chips use the same names for every band (`LEVEL_NAMES`, line 156).
- Seed descriptions end in "A Tune Your Brain SEL experience." or "pilot experience (Phase 5)", which is internal wording on a child-facing card.

## 2. Deficiencies and friction points

**Advance with simplistic or patronizing text (all from shared engine code, so every Advance game gets them):**
- `engine-sdk.js:174,176` and `game-shell.js:125`: "Nice work!" and "Play again" on every game.
- `engine-evidence-hunt.js:98` "Correct, and well-supported by the text!"; `:103` "Right answer, but that's not the strongest evidence."; `:108` "Not quite — take another look at the passage." (also contains a dash); summary labels "Missed", "Right answer, weak evidence".
- `engine-simulation.js:84` shows a green "correct" box saying "Logged. Moving to the next decision..." after every choice, including poor ones, so Money Matters and Money Moves signal "good" for everything.
- `engine-branching-scenario.js:25-27` fixed step labels; `:90` "Thanks for choosing."; `:97-102` placeholder "Type a few words about what you'd take away from this..." and a "this demo" note.
- `engine-scenario-choice.js:265` "Nice job checking in with yourself."

**Discover with complex text or weak color:**
- Stories of 10-43 words (Sharing Circle, Helper's Choice, Same and Different); abstract words (responsible, frustrated, embarrassed).
- The question line is never spoken (`engine-audio-choice.js:56` speaks `stimulusText` and skips `transcript`); generic feedback "Correct!" / "Not quite — take another look." is on-screen only.
- Feelings Detective: 16-word header, 21-word feedback, "(s)", no spoken prompts, and the `long-text` opt-out (`brain-games.css:579-585`) turns off the big-tile Discover look.
- Color: the 3px tile border is `rgba(22,79,74,0.15)`, thick but nearly invisible. The brief asks for strong dark outlines. Pastel header and panel. No color-as-navigation anywhere.
- Feedback is not primary-coded: a ⭐ on a green box or 💭 on a red box, but the outline and tile never change enough to read at a glance.

**Explore:**
- Identical to Challenge visually. No orange, purple or vibrant green. Active versus inactive is a subtle border change.
- Options of 15-24 words are not scannable. Feedback up to 27 words.
- No milestone language ("level", "streak", "badge earned") beyond a thin progress bar.

**Challenge:**
- Looks like Explore; thematic styling absent. Values Compass and (partly) Money Moves read young. Humor is nearly absent; Group Chat Meltdown reads clinical.

**Cross-cutting bugs found along the way:**
- Values Compass: sighted players do not see the story (`engine-scenario-choice.js` renders `context` as `sr-only` plus speech only).
- Idea Lab, Community Voice, Perspective Swap: step labels are not overridable per game.
- Feelings Detective and Strength Spotter show less-fitting picks in a green ⭐ banner.
- Only `engine-scenario-choice.js` accepts `contentPack.prompts`; the other four engines have no override hook, so band-aware wording needs a small shared mechanism.

## 3. Actionable refactoring suggestions

### 3a. One mechanism for color: band themes in `brain-games.css`

Add one block per band, scoped by the existing `html[data-band="..."]` attribute (as `discover` already is), overriding the existing custom properties and the few hard-coded component colors (`.btn-primary` fill and glow, `.fn-shell-feedback.*`, `.fn-shell-progress-fill`, `.results-score`, `.game-card-header`, step label color in `engine-branching-scenario.js:37`, which should become `var(--band-accent)`). Bump `brain-games.css?v=1` to `?v=2` on every brain page (grep for `brain-games.css?v=`). Legacy pages with no band stay as they are. Keep Fixer Nation teal in the site chrome and nav; only the game panel changes.

| Token | Discover | Explore | Challenge | Advance |
|---|---|---|---|---|
| Page / panel | `#FFFBEB` / `#FFFFFF` | `#F5F3FF` / `#FFFFFF` | `#F1F5FB` / `#FFFFFF` | `#0F172A` / `#1E293B` |
| Primary button | `#FFD21F`, ink text `#2A2420` | `#EA580C`, white text | `#4F46E5`, white text | `#38BDF8`, text `#0B1220` |
| Accent / step label | `#E02B2B` | `#7C3AED` | `#2563EB` | `#38BDF8` (rare tier: `#F59E0B`) |
| Choice outline | **3px `#2A2420`** (was 15% teal) | 2px `#7C3AED` selected, `#C4B5FD` idle | 2px `#CBD5E1`, `#2563EB` selected | 1px `#334155`, `#38BDF8` selected |
| Selected tile | `#FFF3B0` | `#EDE9FE` | `#DBEAFE` | `#0C2A3F` |
| Inactive / disabled | `#E5E7EB` | `#E5E7EB` on `#9CA3AF` text | `#E2E8F0` | `#273449` on `#64748B` |
| Correct | bg `#DCFCE7`, border `#16A34A` | bg `#DCFCE7`, `#16A34A` | bg `#CCFBF1`, border `#0F766E` | bg `#0F2A24`, border and text `#34D399` |
| Incomplete / weak | bg `#FEF3C7`, `#D97706` | bg `#FEF3C7`, `#D97706` | bg `#FEF3C7`, `#B45309` | bg `#2A2110`, `#FBBF24` |
| Unsafe / wrong | bg `#FEE2E2`, `#DC2626` | bg `#FEE2E2`, `#DC2626` | bg `#FEE2E2`, `#B91C1C` | bg `#2A1517`, `#F87171` |
| Progress bar | `#E02B2B` to `#FFD21F` | `#16A34A` to `#EA580C` | `#2563EB` to `#7C3AED` | `#38BDF8` to `#0EA5E9` |
| Text / muted | `#2A2420` / `#6B5F55` | `#2A2420` / `#6B5F55` | `#1E293B` / `#64748B` | `#E2E8F0` / `#94A3B8` |
| Radius (already set) | 22px | 22px | 12px | 10px |

Rules that go with it:
- **Discover:** use primaries as meaning where the item allows it (Sound Safari tiles and Same and Different tiles get red, blue, yellow, green rim colors via `choice.color`, which `engine-audio-choice.js:104` already supports; a cue like "Tap the red one" only where the content fits). Feedback shows on the tile itself (thick green or amber outline), not only in a banner.
- **Explore:** purple means selected, orange means the action to take next, green and amber show sorting/matching outcomes; disabled tiles go grey so active versus inactive reads instantly.
- **Challenge:** cool slate base with blue/violet accents, no red or yellow blocks; use amber (not red) for "incomplete".
- **Advance:** dark slate, one cool accent, red used only for the unsafe type; feedback is calm and left-bordered rather than boxed in bright green.
- All text/background pairs checked for WCAG AA (4.5:1 body, 3:1 for 18px+ bold button text). `#EA580C` with white is about 3.6:1, so Explore buttons must stay 18px bold or use `#C2410C` (5.2:1).
- Stroop Challenge keeps its saturated hues; no band theme applies (no `data-band`).

### 3b. One mechanism for language: band copy table in `engine-sdk.js`

Add `FnBandCopy.t(key, band)` (defaults to today's strings so nothing breaks), a `contentPack.copy` override per game (same idea as the existing `contentPack.prompts` in `engine-scenario-choice.js`), and a `contentPack.stepLabels` override for branching. Engines swap their hard-coded strings for `t(...)`. Reuse the existing `prompts` merge pattern (`Object.assign(defaults, contentPack.prompts || {})`). Engine script `?v=` numbers bump with the change.

Proposed strings (no dashes, plain wording):

| Where | Discover | Explore | Challenge | Advance |
|---|---|---|---|---|
| Run complete title (`engine-sdk.js:174`) | You did it! | Level complete! | Run complete | Debrief |
| Replay button (`:176`) | Play again | Play again | Run it again | Try again |
| Evidence right and proven (`engine-evidence-hunt.js:98`) | n/a | Right, and you found the proof! | Correct. The text backs it up. | Sound judgment. The passage supports it. |
| Right answer, weak proof (`:103`) | n/a | Right answer. Look for a stronger clue. | Right answer, but another sentence proves it better. | Right conclusion, weaker evidence. A stronger sentence is available. |
| Wrong (`:108`) | Not yet. Try again. | Not yet. Look at the story again. | Not quite. Reread the passage. | That does not hold up. Reread the passage. |
| Summary label "Missed" | Try again | Try again | Missed | Not supported |
| Simulation after-pick (`engine-simulation.js:84`) | n/a | Choice made. Next one! | Decision locked in. Next up. | Noted. Next decision. (neutral style, no green box) |
| Branching step labels (`engine-branching-scenario.js:25-27`) | n/a | What is happening? / Who does it affect? / What could you do? / Pick your best move / Think it over | Spot the issue / Weigh the impact / List your options / Make the call / Reflect | Situation / Stakes / Options / Decision / Debrief |
| Reflection placeholder (`:99`) | n/a | What will you remember? | What is your takeaway? | Your takeaway (private, not saved) |
| Scenario cues prompt (`engine-scenario-choice.js:59`) | What do you see? | What do you notice? | Which cues do you notice? | Which details matter here? |
| Scenario pick prompt | How might they feel? Pick one or more. | Which feelings could this be? Pick one or more. | n/a | n/a |
| Check-in line (`:265`) | You checked in with yourself! | Great check-in with yourself. | Nice read on yourself. | Good self-read. |

Per-game step labels (override via `contentPack.stepLabels`): Idea Lab: The need / The ideas / The trade-offs / The test / What you learned. Community Voice: The problem / The facts / The ask / The pitch / What you learned. Perspective Swap: Your view / Their view / The gap / A fair plan / Reflect.

### 3c. Game-specific rewrites (examples; full list goes in the report)

**Discover** (target: 8 words or fewer per spoken line, one idea per sentence, and the question is spoken):
- Calm Down Corner `:53`: "Your tower fell down. You feel mad. What helps you calm down?" Header `:115`: "Listen. Pick what helps you feel calm."
- Sharing Circle `:52`: "A friend lost a toy. They are sad. What is kind?" `:63`: "A new kid stands alone. What is kind?" Header: "Listen. Pick the kind thing."
- Helper's Choice header `:113`: "Listen. Pick the right thing to do." `:84`: "A friend says, 'Say we both finished.' You did not finish. What do you do?"
- Feelings Detective header `:165`: "Look. Think. How do they feel?" Prompt: "How might they feel? Pick one or more." (drop "(s)"). Remove the `long-text` opt-out so the big tiles apply, and speak the prompts and feedback.
- Same and Different: cap spoken stories at about 20 words, for example "Ana likes soccer. She has a dog. Ben likes drawing. He has a dog too. What is the same?"
- Sound Safari: speak the question; a human recording for /m/ and the other sounds is already on your list.

**Explore** (target: options 12 words or fewer, feedback two short sentences):
- Choice Quest header `:507`: "Find out what is happening, who it affects, then pick your best move."
- Fix-It Workshop header `:511`: "Spot a school problem. Listen to the people it affects. Try a small fix." Trim long options such as `:281` to about 12 words.
- Team Pick, Peace Table: swap "constructive" for "helpful", "perspective" for "side"; split any feedback over 20 words.

**Challenge** (add light humor and framing, keep clear steps):
- Group Chat Meltdown `:59`: use contractions ("That's a completely normal reaction. Spotting it is step one.") and one wry line in feedback.
- Values Compass: show the story on screen; change "Good noticing. Now think about the values this shows." to "Nice read. Now name the values behind it."; "I've noticed these" to "Lock in my cues".
- Money Moves `:255`: move toward Challenge scenes (a concert ticket, phone case) instead of the cartoon lunch box.

**Advance** (drop praise openers, keep nuance):
- First Shift / The Post: change "Good catch." and "Right." openers to consequence-first lines ("A rumor about a real person can do real damage, and a joke label doesn't change that.").
- Money Matters: replace "that is normal for a first apartment" with a number ("$600 in, $540 out. Thin margin, but workable.").
- Replace the template description line used across First Shift, The Post and Group Chat Meltdown ("Work through what is happening... who it affects, and what to do about it.") with per-game descriptions.

**Legacy:**
- Simon Sequence: "❌ Wrong! Game over." to "Sequence broken. You reached round N." Replace 🟥🟦🟩🟨 with neutral shapes for older players.
- Reaction Time: "⚡ Lightning fast! / 👍 Nice! / 🙂 Good" to "Top tier / Solid / Average" plus the millisecond figure.
- Memory Match: offer a symbols deck in addition to the animal deck.
- **Decision for you:** the legacy games are band-less on purpose and show under every filter. Assigning a band would let them pick a theme (my suggestion: Simon Sequence and Memory Match = Explore; Reaction Time, Quick Math, Number Sequence = Challenge; Stroop untouched). This is your call and not part of the first releases.

### 3d. Catalog page

- Band tags: per-band tint (Discover yellow, Explore purple, Challenge blue, Advance slate) instead of four identical pills; decide whether the tag shows grades only (today) or grades plus age ("Discover, ages 5-6, K-1").
- Per-band card header gradient and "Play Now" button color to match the game theme.
- Replace "A Tune Your Brain SEL experience." and "pilot experience (Phase 5)" in the seed descriptions with one plain sentence each.
- Band-flavored level names (optional).

## 4. Suggested release batches (each one needs your approval before it is built)

1. **Release 85, color themes.** Band blocks in `brain-games.css`; contrast check; cache-bust. No wording changes.
2. **Release 86, shared wording.** `FnBandCopy`, `contentPack.copy` and `stepLabels` hooks; engine string swaps; neutral simulation feedback; fix hidden Values Compass story. Engine tests extended.
3. **Release 87, Discover rewrite.** Six games' text, spoken questions and feedback, Feelings Detective restyle. Needs your read of every line (and an ear test on spoken lines).
4. **Release 88, Explore trim.** Options and feedback shortened; Fix-It Workshop first.
5. **Release 89, Challenge and Advance wording**, including legacy-game copy and catalog tags.

Each release: wording goes through the humanize pass; outline then written text then held review doc, as before.

## Constraints to respect when building
- `server/test/engine-content.test.js` enforces option-length balance (within 1.4 times), careful-answer-longest limits, proving-sentence spread, no dashes, fictional names, and reading-level proxy ranges. Rewrites must keep passing; shortening Explore and Discover text may need the reading-level ranges adjusted deliberately, with your OK.
- Help videos: `node server/scripts/videos-to-review.js` on every commit; visual re-themes will likely make recorded videos for these pages stale and need a VIDEO-STATUS.md judgment.
- Cache versions bumped on every page that references changed assets; production verified by curl after you say "deployed".
- The public repo rule: nothing committed except code and docs.

## Decisions for you

1. **Order:** start with color (Release 85) or shared wording (Release 86)? They are independent.
2. **Ages versus grades on the catalog tag:** keep "Discover (K-2)" and "Explore (3-5)", or show ages too? Your brief's 5-6 and 7-10 do not line up with K-2 and 3-5.
3. **Advance dark theme:** the table proposes a dark slate Advance panel. Agree, or keep it light but cool?
4. **Legacy games:** give the six band-less games a band (and so a theme), or leave them as they are?
5. **Reading-level tests:** shortening Discover and Explore text may need the proxy ranges in `server/test/engine-content.test.js` adjusted. OK to do that deliberately, release by release?


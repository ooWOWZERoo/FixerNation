# Discover-Band Illustration Sourcing Spike

Scoping pass for the 4th of the 4 directions chosen 2026-09-21: CSS work on the Discover-band visual prototype is **paused** per the user's own call, in favor of scoping what real illustrated art would actually take. This is a planning document — no code, no purchase, no vendor engagement. The actual sourcing decision (budget, vendor, timeline) is a real business call only the user can make; this doc exists to make that decision with real information instead of guessing.

## The gap, precisely (already found, not re-discovered here)

`USABILITY_REVIEW_2026-09-17.md`: "None of the 14 games have any real illustrated character or environment art; every game's entire visual identity is a single generic system emoji... This is a full per-band visual-identity build, not a shared-skin size adjustment." Confirmed again while researching this doc: **zero illustrated art assets exist anywhere in this repository** — no SVGs, no character library, no avatar system to repurpose.

The blueprint's §7.2 Discover art direction is specific, not vague: **characters** (owl, fox, turtle, dolphin, dog, cat, panda, friendly robot, astronaut, young explorer), **environments** (classroom, park, home, garden, nature, space, simple town, calm cloud world), style "illustrated, warm, clear, friendly, low-clutter," animation "expressive but not frenetic." The current emoji-based CSS prototype (Release 49, rounds 1-2) is explicitly documented as "a direction prototype, not production art" — it tests whether "bigger, card-based, backdrop-framed" reads as improvement, not a path to what §7.2 actually describes.

## §7.7's asset-pipeline requirement — a real, separate build, independent of where art comes from

Whichever sourcing path is chosen, §7.7 requires every asset to be tagged with: asset ID/version, experience band, domain/theme, character/environment/object type, cultural/identity representation attributes (for editorial balance — explicitly **not** for inferring anything about a student), alt text or decorative status, motion status + reduced-motion substitute, audio transcript/caption, license/source/creator, and approval/retirement state. **This is a real `asset_library` table + a small admin management UI, not a folder of image files** — worth knowing before assuming "just buy some art and drop it in" is the whole job. Recommend scoping this as its own engineering task once a sourcing path is chosen, sized against however many assets that path actually produces.

## Sourcing options, with real ballpark numbers

| Option | Cost (ballpark) | Timeline | Fit to §7.2's specific character/environment list | Consistency risk |
|---|---|---|---|---|
| **A. Stock illustration marketplace** (Storyset/Freepik, unDraw, similar) | Low — unDraw is free/no-attribution; Storyset free with attribution or a low-cost monthly Freepik subscription (commonly ~$10-20/mo for commercial-clear premium) | Fast — days | Weak-to-medium. Generic "kids learning" packs exist but are unlikely to include this exact character roster (owl/fox/turtle/dolphin/etc.) in one consistent style — likely means mixing packs, which risks a visually inconsistent world | Medium-high (assets from different packs/artists rarely share a style) |
| **B. AI-generated illustration** (iterate toward the exact §7.2 roster in a consistent style) | Low direct cost (existing image-gen tooling/subscriptions), but real *time* cost in prompting/iteration/curation rounds | Fast to first draft, slower to a truly consistent full set | Strong — can target the exact characters/environments named in §7.2 directly | Medium — consistency across many generated images needs deliberate style-locking (reference images, fixed seeds/prompts), and every image still needs human review before shipping to children |
| **C. Commission a real illustrator/agency** | **$500-$1,500 (budget/marketplace tier) to $2,000-$4,000+ (mid-range, commercial/app rights) per character-pack-sized project; $5,000-$12,000+ for premium/veteran illustrators** ([sources below](#sources)) | Weeks, not days — real production lead time | Strongest — a brief can specify the exact roster and get real creative direction | Lowest — one artist/agency, one style, by design |
| **D. Hybrid — prototype cheap (A or B) first, commission real polish (C) only for the confirmed direction** | Low now, real cost deferred | Fast validation now, full timeline later if pursued | Validates fit before spending on C | Lowest overall risk — avoids paying full production cost before knowing the direction is right |

**Recommendation: D.** Nothing here has been tested with real users/stakeholders yet — the current emoji prototype was built to test "does bigger/card-based read as enough of an improvement," and the honest answer from the usability review was "no, not without real illustration." Spending commission-tier money before validating that a specific illustrated style (not just "less emoji") actually lands well with FNE's Discover-age audience is the more expensive way to find that out.

## What I can and can't do here

I can prototype option B directly (generate candidate character/environment art, iterate on style) if that's the direction chosen — I have image-generation tooling available in this session. I **cannot** commission a real illustrator, cannot spend the user's money, and cannot make the budget/timeline call — those need the user's actual decision.

## Not started — this spike is a decision input, not a plan to execute

<a id="sources"></a>
**Sources for the commission-tier estimates:** [How Much Does It Cost to Hire a Children's Book Illustrator? (Fiverr)](https://www.fiverr.com/resources/guides/costs/childrens-book-illustrator), [Children's Book Illustration Cost? (2026 Guide) — ReadNLearn](https://readnlearn.com/childrens-book-illustration-cost/), [Character design cost 2026 – Complete Pricing Guide](https://animotionsstudio.com/character-design-cost-2026/). Marketplace/stock notes from [Storyset Review 2026 — Pixels Market](https://pixels.market/blog/storyset-review-alternatives) and [unDraw Review 2026 — Pixels Market](https://pixels.market/blog/undraw-review-alternatives). These are illustrative ranges from a quick search, not vendor quotes — treat as a starting point for a real conversation, not a firm number.

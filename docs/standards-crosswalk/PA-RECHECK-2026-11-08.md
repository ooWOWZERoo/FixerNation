# Pennsylvania recheck (2026-11-08)

Requested by John Shaw after he updated Pennsylvania's reference links. Claude drafted this; nothing here is verified and nothing is public until the owner verifies it in `admin-standards.html`.

## What was checked

- **PDE's Career Ready Skills page and Toolkit page**, read again today. The framework is unchanged: three domains (Self-Awareness and Self-Management; Establishing and Maintaining Relationships; Social Problem-Solving Skills), a Pre-K to grade 12 continuum in four bands (Pre-K to K, 1 to 5, 6 to 8, 9 to 12). The grade-banded skills used below come from the Toolkit page. The continuum PDF is linked from it: `.../careerreadypa/the pennsylvania career ready skills continuum.pdf`.
- **Portrait of a Graduate.** PDE's pages do not mention one. A search found no statewide portrait either. Pennsylvania districts publish their own (William Penn SD is one example found today), and CASEL's 2024 portraits report lists the Career Ready Skills as Pennsylvania's entry. Neither is a PDE document, so `pogStatus` is still a judgment for the owner: `unknown` (as drafted), or `district_led_only` with a district source, as Connecticut does.
- **The catalog**: all 67 Tune Your Brain games and the 150-plus lesson families on production.

## Your updated links (applied to PA.json)

- **SEL source:** PDE's SEL Best Practice Resources page. It names the Career Ready Skills and lists programs as guidance, with no formal standards of its own. The framework's own official link stays on the Career Ready Skills page.
- **Portrait of a Graduate source:** Canon-McMillan School District's own portrait (six attributes, a district document). That makes `pogStatus` `district_led_only`, which I set; it was `unknown`. Please check that matches what you chose in the admin page.
- Checked date is now 2026-11-08. `selStatus` is still `k12_standards`; PDE presents the Career Ready Skills as guidance, so `guidance_only` may be the fairer label (your call).
- No framework field changed, so the 17 verified connections stay verified. Importing re-drafts only the coverage record.

## What changed in PA.json

Pure additions: 17 existing connections untouched, 47 new drafts (45 games, 2 lessons). Before this, Pennsylvania had 3 game connections out of about 39 social-emotional games.

### Direct (D) and supporting (s) by domain and grade band

| Domain | Discover (K-2) | Explore (3-5) | Challenge (6-8) | Advance (9-12) |
|---|---|---|---|---|
| A. Self-Awareness and Self-Management | D: Calm Down Corner, Feelings Detective, My Feelings Today, Wait for It | D: Strength Spotter, What Helps Me, Stuck on It, Team Pick | D: Know Your Triggers, Group Chat Meltdown. s: Values Compass, Money Moves, Deadline Crunch | D: Stress Signals. s: Know Yourself, Money Matters |
| B. Establishing and Maintaining Relationships | D: Sharing Circle, Asking Nicely, Team Tower, Same and Different | D: Team Mission, Peace Table, Many Ways to Be. s: Walk in My Shoes | D: Say It Another Way, Speak Up Kindly. s: Walk in Their Shoes, Peer Pressure Pause | D: Repair It. s: Perspective Swap, Many Voices, Community Voice |
| C. Social Problem-Solving Skills | D: Helper's Choice, Stop and Think. s: Sharing Circle | D: Choice Quest, Walk in My Shoes. s: Fix-It Workshop | D: Walk in Their Shoes, Other Side of the Screen, Peer Pressure Pause. s: Decision Point | D: Perspective Swap, The Post, First Shift, Many Voices. s: Idea Lab, Community Voice |

Lessons (apply to every K-12 grade version): A has Calm Is A Super Power, Pause Before You Escalate, Stay in Control of Your Spirit, Growth Requires Repetition. B has Say What You Mean With Respect, Listen Before You Answer, Pause Before You Escalate, Choose Peace Without Losing Strength, and Ask for Help the Right Way (supporting). C had only two, so **Count the Cost Before You Choose** and **Slow Down and Think It Through** are added (both direct).

### Not linked, on purpose

The 22 literacy, math and thinking-skills games (Memory Match, Quick Math, Reading Detective and so on) have no Pennsylvania link: the Career Ready Skills are social-emotional only, and nothing in those games teaches a domain skill.

## Honest gaps

- **Grades 9 to 12 goals.** Domain A asks students to set goals for postsecondary education, employment and living in the community. Money Matters and Know Yourself only support it. No game or lesson teaches that directly.
- **Domain B at 9 to 12** has one direct game (Repair It) and no direct lesson at that level, because every lesson objective is the same in all grade versions.
- **No Pennsylvania portrait**, so Graduate Evidence has nothing to show for Pennsylvania beyond a district's own framework.

## Judgment calls for the owner to verify

1. **Same and Different** as direct for B (respect for uniqueness). It is a very short story for the youngest band, so supporting may be fairer.
2. **Know Your Triggers** and **Stress Signals** as direct for A. Both identify stress and name a feeling or a check-in step; neither teaches a range of coping skills.
3. **Other Side of the Screen** as direct for C (how a social context shapes feelings). The online setting is the context.
4. **Decision Point** is verified as supporting for C. Its cycle (understand the impact on others, then choose) now looks direct to me. Changing it re-drafts that one connection, so I left it for you to say.
5. **Reserve lessons** not added, because the standard is two to four best fits per standard: Repair Your Words and Respond Without Revenge (B), Do Not Borrow Other People's Chaos and Reset and Return With Strength (A).

## Next steps

1. `node scripts/import-standards.js PA` on cPanel, then verify in `admin-standards.html` (the "Verify all draft connections" button works per standard).
2. If the owner accepts supporting for Same and Different, edit the strength before importing.

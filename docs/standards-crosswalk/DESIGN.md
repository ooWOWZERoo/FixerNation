# State standards & Portrait of a Graduate crosswalk — design

Started 2026-10-26. Requested by John Shaw: connect FNE's content to **state SEL standards** and **state Portraits of a Graduate**, captured state by state, in three views built on one dataset.

Scope was confirmed with the user (2026-10-26): SEL standards **+** Portrait of a Graduate (not academic/ELA standards); entries are **hidden from the public until a person reviews them**; rollout is **pipeline first, then a pilot batch of states**.

## The three views (one shared dataset)

1. **Public crosswalk page** — state by state: what framework the state has, a link to the primary source, and how FNE's content connects to it. Shows reviewed rows only.
2. **Per-district frameworks** (school/district-admin portals) — a district's *own* portrait, mapped to FNE content. Most Portraits of a Graduate are written by districts, not states.
3. **Sales one-pager** — pick a state or district, print a sheet containing only reviewed claims.

## What "by state" really means (research, accessed 2026-10-26)

- CASEL reports **27 states with free-standing K-12 SEL competencies/standards**, all 50 with pre-K ones (CASEL state page; 2022 state scan). ~23 states have guidance only, pre-K only, or nothing. Newer figures may exist.
- Portrait of a Graduate counts disagree by source: ~20 states with a formal statewide portrait up to **33 with a state-led effort** (CASEL/ERIC map, Oct 2024); 13 district-led only; 4 neither. Sources even disagree about individual states (e.g. Kentucky, Indiana).

So the dataset is a **coverage matrix**, not 50 identical records: for each jurisdiction, *what kind of framework exists* (including "none" and "unknown"), each with a source.

## Rules that make this safe to show districts

1. **Every record carries a primary-source URL (https) and the date it was checked.** Claude researches and drafts; Claude cannot verify.
2. **Nothing is public until an FNE admin verifies it.** Drafts never appear on any public endpoint.
3. **Editing a verified record sends it back to draft.** Changing a framework or its items also sends its alignments back to draft (an alignment was reviewed against the old text).
4. **An alignment can only be verified if its framework is verified**, it has a real rationale, and its FNE target exists.
5. **Alignment is FNE's own thematic mapping**, not an endorsement or certification by any state or by CASEL. The public page carries the same disclaimer as `research.html`.
6. **Short summaries + links out.** Store the code, title, a short paraphrase/excerpt and the source link — not whole standards documents.

## Data model (new tables)

| Table | Purpose |
|---|---|
| `standards_state_coverage` | One row per jurisdiction (50 states + DC): `sel_status`, `pog_status`, source URLs, accessed date, review status |
| `standards_frameworks` | A real framework: state, type (`sel_standards` / `portrait_of_graduate`), name, issuing body, official URL, accessed date, review status |
| `standards_items` | The framework's individual standards/competencies: code, title, short summary, grade band, CASEL competency |
| `standards_alignments` | FNE content ↔ item: target (`program` / `curriculum` / `brain_game`), strength (`direct` / `supporting`), rationale, review status |
| *(phase 3)* `district_frameworks` / items | A district's own portrait |

Review state lives in the database (a human act in the admin UI); the research itself is committed as JSON under `server/data/standards/` and loaded as **draft** by `scripts/import-standards.js`, so every research change is a reviewable git diff. Re-importing identical data does not disturb an existing verification.

## Access matrix

| Role | Read verified | Read drafts | Create / edit | Verify |
|---|---|---|---|---|
| Anonymous | YES | NO | NO | NO |
| Site user (teacher, parent, student) | YES | NO | NO | NO |
| Sales-demo account | YES | NO | NO | NO |
| School / district admin | YES | NO | *(phase 3)* own district's framework only | NO |
| FNE admin (`requireAuth`) | YES | YES | YES | YES |

Public endpoints: `GET /api/standards/overview`, `GET /api/standards/states/:code`. Admin endpoints: `/api/admin/standards/*`.

## Phases

1. **Data model, review gate, APIs, import script, tests** *(this change)*
2. Admin review page (Mission Control style) + research and load a **pilot batch** of states
3. Public crosswalk page
4. District frameworks (school/district-admin portals)
5. Sales one-pager
6. Remaining states in batches, driven by the coverage tracker

## Open items

- **FNE content mapping needs a human who knows the lessons.** FNE lessons carry no competency tags today (only `brain_games` has `casel_competencies`). Alignments must be reviewed by someone who can say "this lesson really teaches that".
- Pilot state list to be agreed. Suggested: **New York** (an existing customer market; NY also recently introduced Portrait of a Graduate graduation criteria), **Illinois**, **Pennsylvania**, **Washington**, **Kansas** — each to be confirmed against its official source before it is loaded.

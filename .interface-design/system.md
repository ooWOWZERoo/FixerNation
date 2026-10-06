# FNE admin backend — visual direction

Decided 2026-10-06, as a continuation of the admin UI/UX audit (see PROJECT.md "Known limitations" and memory `fixernation_admin_ui_ux_audit_2026-10-06`). Applies to `admin-*.html` (the internal backend, driven by `admin-common.css` + `admin-nav.js`) — not the public site, which has its own separate token system.

## Direction and feel

Domain: this isn't a generic SaaS admin — it's the back office for a K-12 SEL curriculum business. The real-world textures are purchase-order paperwork, quote validity windows, school license rosters, the daily Morning Boost send, affiliate territories. The admin's own existing brand palette (teal/coral/gold, defined in `admin-common.css` as `--a-accent`/`--a-coral`/`--a-gold`) already fits that world — ledger teal, sunrise coral, report-card gold — it just wasn't being used with intent.

Feel: bolder in *structure* (clear card-weight hierarchy, a real signature element), restrained in *color* (reuse the 3 existing brand hues with a job each, never a rainbow of category colors). The craft discipline's "color is scarce" principle and the user's "bolder" ask were reconciled by keeping category color-coding desaturated/small (nav labels, icon chips) rather than full-saturation backgrounds.

## Signature: the ledger stamp

A rotated, circular, ink-colored stamp — `.a-stamp` / `.a-stamp-success` / `.a-stamp-accent` in `admin-common.css` — reserved for "this is now locked in" confirmed states (Paid, Converted). Not a replacement for `.a-pill`, which stays for lighter-weight/in-progress statuses. Deliberately used sparingly — one per record, in a focused single-record view (invoice print sheet, quote detail modal), never in a dense table row (would dilute the signature into wallpaper).

Live today:
- `admin-invoice-print.html` — `.paid-stamp` (page-local style, same visual idea) appears on the invoice sheet corner when `status === 'paid'`, replacing the old flat "Paid" badge. Unpaid still gets the plain `.status-badge`.
- `admin-quotes.html` — `#convertedStamp` (`.a-stamp.a-stamp-success`) appears next to the modal title when a quote's `status === 'converted'`.

Not yet applied elsewhere — a candidate for any other "confirmed/final" state surfaced in a single-record view (e.g. an active school license), but resist adding it to list/table rows.

## Category color-coding (nav)

Reuses the 3 existing brand hues as a per-section identity in `admin-nav.js`'s `SECTIONS` array (each entry's `cat` field) + `admin-common.css` (`.a-nav-section[data-cat="..."]` rules):

- `sales` (Sales & Schools) → gold `#EBA657`
- `content` (Content) → teal, `var(--a-accent)`
- `marketing` (Marketing & CRM) → coral `#F26B4D` / `#F0997B` label tint
- Community & Reports → `cat: 'neutral'`, deliberately hue-less. These are cross-cutting/informational, not transactional — forcing a 4th hue here would be decoration, not meaning (see "gray for structural/neutral" in the craft discipline).

**Bug found 2026-10-06, fixed same day:** leaving `cat` unset entirely for Community/Reports (rather than an explicit `'neutral'` value) meant their active-link fill silently inherited the global default (`var(--a-accent-fill)`, teal) — the same hue as Content — while their section label stayed plain dim gray. Visiting those pages showed a teal-highlighted active link under an uncolored label, which read as broken, not restrained. Fixed by giving `neutral` its own explicit CSS branch (`[data-cat="neutral"]`): brighter label opacity (`.85` vs the `.6` default) and a white-overlay active-fill that doesn't borrow any category's hue. Lesson: "intentionally no styling" needs its own explicit rule, not an implicit fallthrough to whatever the global default happens to be — the global default can coincidentally match a *different*, real category.

This one shared-file change reaches all 23 `admin-nav.js`-driven pages at once — the highest-leverage single edit in this rollout. Bump `admin-nav.js?v=N` in every admin HTML file whenever this file changes (see CLAUDE.md).

## Icon system

No icon font was introduced — the codebase's existing emoji-as-icon convention is kept (it suits the warm K-12 brand better than a cold geometric icon font, and avoids a new external CDN dependency on a no-build-step static site). What changed: every nav icon now sits in a `28px` rounded-square chip (`.a-nav-pinned a .ic, .a-nav a .ic` in `admin-common.css`) instead of floating bare next to the label text, and that chip picks up the section's category tint. This reads as a deliberate icon system without touching the glyphs themselves.

## Card-weight hierarchy

Three tiers, used by importance, not by section:

- **Hero** — `.a-stat-card-featured` (built in the Tier 1 pass): accent-tinted background, 36px value. For the 2-3 numbers that need daily attention. Currently: Sales Today, Revenue Outstanding, Invoices Outstanding on `admin-dashboard.html`.
- **Standard** — `.a-stat-card` (pre-existing): white/card background, 28px value. The default.
- **Compact** — `.a-stat-card-compact` (new): smaller padding, 20px value, 11px label. For secondary/nice-to-know metrics grouped in larger counts (5-6 up) where nothing individually needs daily attention. Applied to the dashboard's Insights (5-up) and Content (6-up) grids.

Extend this to other pages' stat grids using the same three classes rather than inventing a new tier.

## What's done vs. what's next

Done (2026-10-06): nav icon chips + category tinting (all 23 pages), ledger stamp on invoice print + quote modal, hero/standard/compact tiers formalized and applied on the dashboard.

Not done: the other 20-ish pages' own tables/pills/forms haven't been individually redesigned — they inherit the nav color system automatically but don't yet have their own hero/compact tiering or stamps where it'd make sense (e.g. `admin-licenses.html` license-active states, `admin-school-admins.html`). Pick these up using the components documented above, not new ones, when that work is prioritized.

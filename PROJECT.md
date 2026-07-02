# Fixer Nation — Redesign Project Notes

Static HTML mockup project redesigning fixernation.org. No real server or database — data-driven pages (admin, newsletter) run on browser `localStorage`/`sessionStorage` for demo purposes only.

**Current direction: v1** (teal/coral, serif headings). The `-v2` set (navy/amber, Second Step-inspired mega-nav) was an earlier alternate direction the user reviewed and decided against — those files are kept for reference but are not being actively developed.

## How to view

Open any `.html` file in this folder directly in a browser (Chrome recommended — see Known Limitations below). Start at `fixernation-redesign-mockup.html` for the homepage.

## Public site pages (v1 = primary, `-v2` = frozen alternate)

| Page | v1 file | v2 file |
|---|---|---|
| Home | fixernation-redesign-mockup.html | fixernation-redesign-mockup-v2.html |
| About | about-mockup.html | about-mockup-v2.html |
| Books listing | books-mockup.html | books-mockup-v2.html |
| Book detail — Kill the Bully | book-kill-the-bully.html | book-kill-the-bully-v2.html |
| Book detail — Your Past Doesn't Define You | book-your-past.html | book-your-past-v2.html |
| Book detail — Think with 5 Brains | book-5-brains.html | book-5-brains-v2.html |
| Book detail — How to Lie | book-how-to-lie.html | book-how-to-lie-v2.html |
| Join / Membership pricing | join-mockup.html | join-mockup-v2.html |
| FN Network | fnnetwork-mockup.html | fnnetwork-mockup-v2.html |
| Ask The Fixer | askthefixer-mockup.html | askthefixer-mockup-v2.html |
| National Education Portal | education-portal-mockup.html | education-portal-mockup-v2.html |
| 2D Education - Schools | education-schools-mockup.html | education-schools-mockup-v2.html |
| Programs | programs-mockup.html | programs-mockup-v2.html |
| FN Blogs | blog-mockup.html | blog-mockup-v2.html |
| Lesson plan detail (v1 only) | lesson-detail.html?id=&lt;curriculumId&gt; | — |

## Admin backend (functional demo)

| Page | File |
|---|---|
| Login | admin-login.html |
| Dashboard | admin-dashboard.html |
| Book product configuration (CRUD) | admin-books.html |
| Curriculum builder (CRUD + download-limit testing) | admin-curriculum.html |
| Blog builder (CRUD, live on the public FN Blogs page) | admin-blogs.html |
| Newsletter CRM (contacts, address, CSV import/export) | admin-newsletter.html |
| Email campaigns (mass marketing, simulated send) | admin-campaigns.html |
| Shared styles/logic | admin-common.css, admin-common.js |

**Demo login:** `admin` / `FixerNation2026!` (seeded automatically on first load, stored in `localStorage`).

**How it's wired:**
- The newsletter signup form on the v1 and v2 homepages writes into the same `localStorage` contact list the admin CRM reads from — a signup on the site shows up in the CRM immediately.
- Book edits/adds in `admin-books.html` are saved to `localStorage` only; they do **not** currently update the static `books-mockup.html` catalog page or the individual book detail pages (those remain hand-authored HTML). Treat the admin panel as a working proof-of-concept for the editing experience, not a live content source for the public pages yet.
- **Blog posts are the exception** — `admin-blogs.html` is genuinely live-connected: posts saved there (v1 only, `blog-mockup.html`) render immediately on the public FN Blogs page, including the featured hero, the category filter chips, and a "Read More" pop-up with the full post body. This is the one piece of admin content that isn't just a proof-of-concept UI — it's the real source of the public page's content.

**Newsletter CRM updates:**
- Contacts now include a full mailing address (street, city, state, zip) — captured on the Add Contact form, homepage signups (address left blank there since the public form doesn't ask for it), and CSV import.
- **Bulk CSV import**: upload a `.csv` file or paste CSV text; supports Name, Email, Address/Street, City, State, Zip, Source columns in any order (header row required). Shows a preview before importing, skips rows with invalid/missing email, and skips duplicates by email address.
- CSV export now includes the address columns.

**Email campaigns (`admin-campaigns.html`) — mass marketing:**
- Compose a subject, from name/email, audience filter (subscribed vs. all, optionally narrowed by source), and a body, then Save as Draft or Send Now.
- Audience size updates live as you change the filter, based on the actual contact list.
- **Sending is simulated** — there is no real email server connected. "Send Now" logs the campaign as Sent with a timestamp and recipient count computed from the live audience at send time; no message is actually delivered anywhere. This is called out with a persistent on-page banner so it's never mistaken for a real send. Connecting a real provider (Mailchimp, SendGrid, Postmark, etc.) would be a separate integration.
- **HTML emails are supported**: a Plain Text / HTML toggle switches the body field into raw-HTML mode, with quick-insert buttons for common blocks (heading, paragraph, button, image, divider) and a live sandboxed preview (`<iframe sandbox>`) so you can see the rendered result while composing. The chosen format (`bodyFormat`) is stored per campaign, campaigns with HTML content show an "HTML" tag in the list, and the View Campaign modal renders HTML bodies in the same sandboxed preview rather than as escaped text. A real send would still need an actual provider to handle multipart plain-text/HTML delivery and inlining CSS for email-client compatibility — this demo only proves out the authoring and preview experience.

**Curriculum builder (`admin-curriculum.html`):**
- Fields: title, series/program, intended audience (Elementary/Middle/High School/Higher Ed, multi-select), short + long description, learning objectives, estimated duration, materials needed, a lesson-plan document upload, repeatable video uploads, a quiz builder (multiple questions, mark the correct answer), and a max-downloads-per-teacher limit.
- **Quiz answer options are configurable per question** — each question starts with 4 options but supports anywhere from 2 to 6 via "+ Add Option" and a ✕ next to each option row. Removing an option keeps the "correct answer" radio pointing at the same logical option (or resets to the first option if you remove the one marked correct).
- **Fixed a layout bug** where the answer-text box next to each radio button was invisible — a global admin style (`.a-field input{width:100%}`) was leaking onto the nested radio inputs and forcing them to claim the entire row width, squeezing the text field to nothing. `admin-common.css` now resets the radio's box model inside `.a-quiz-option-row` so each option shows a normal-sized radio button plus an editable text field for that answer's wording.
- The download limit is genuinely functional in this demo: each curriculum's row has a "Downloads" button that opens a simulator — enter a teacher email and click "Simulate Download" to test that teacher's count against the configured limit (tracked separately per teacher, resettable individually or all at once).
- **Video Lessons has two ways to add a video, and both are playable now**: "+ Add Video URL" takes a YouTube/Vimeo link or a local filename directly, and "+ Add Video File" opens a file picker for convenience but — since there's no real backend to upload actual video bytes into — it references the picked file **by filename only**, exactly like book covers and trailers are referenced elsewhere on the site. Either way, the video will only actually play on the public lesson page if a file with that exact name is also sitting in the FixerNation project folder; if it isn't, the public page shows a clear "couldn't find this file" message instead of a silently broken player (via `fnHandleVideoError` in `admin-common.js`). A real production version would still need actual file/video storage (e.g. S3, a video host) to make file uploads work independent of the local folder.
- **Included Resources**: a checklist (`FN_CURRICULUM_RESOURCES` in `admin-common.js`) of Classroom Poster / Student Handout / Teacher Copy / Quiz + Answer Key — this maps directly to the four resource buttons shown on the featured-lesson spotlight on `education-portal-mockup.html`. The two seeded curricula have this field set to match what's already shown there (the "Take Responsibility for Your Growth" curriculum has all four; "Think with 5 Brains" has three, no poster).
- **The featured-lesson resource buttons are now live** (v1 only — same as the blog, `education-portal-mockup.html` was not updated): the page matches itself to the "Take Responsibility for Your Growth" curriculum by title and renders a button only for resources checked in that curriculum's Included Resources list. Clicking **Quiz + Answer Key** opens a real pop-up showing that curriculum's actual quiz questions with the correct answer highlighted — genuinely pulled from the quiz builder, not hardcoded. Clicking **Classroom Poster / Student Handout / Teacher Copy** opens the curriculum's attached Lesson Plan Document if one has been uploaded, or shows a message explaining none is attached yet — there's currently only one generic document upload per curriculum (not a separate file per resource type), so all three of those buttons point at the same file. Uploading distinct per-resource files would be a reasonable next step if that granularity is needed.
- **The lesson video is also live**: if the matched curriculum has a video added via "+ Add Video URL," it plays in a real embed on the spotlight (via the same `fnVideoEmbedHtml` helper shared with the blog). If the curriculum only has demo file-upload videos (metadata only, never actually stored), the page shows an explanatory note instead of a broken player — this was the original gap someone would hit if they'd only ever used "+ Add Video File" and expected it to show up publicly.
- **`lesson-detail.html` — a dedicated public lesson page template** (v1 only), parametrized by `?id=<curriculumId>`. It renders a full page for one published curriculum: title, series, audience badges, duration, description, the same live resource buttons / quiz pop-up / video embed as the spotlight, plus the full overview, learning objectives, and materials list. An invalid, missing, or unpublished ID shows a friendly "Lesson not found" state with a link back to the Portal instead of a broken/blank page.
- The "Take Responsibility for Your Growth" curriculum's seed data no longer includes any video at all — it's intentionally empty so the video shown publicly is always whatever you've actually configured in the Curriculum Builder, not fabricated placeholder content. A YouTube placeholder was tried briefly and then removed at the user's request in favor of using the real video added through the admin UI.
  - **Fixed:** `renderSpotlightVideo`/`renderDetailVideo` previously only tried to play a video if it had an explicit `.url` — so a video added before that field existed (only `.name` saved) rendered nothing. Both now fall back to `.name` as the playable reference when `.url` is missing, since the name always was the picked filename anyway. `editCurriculum` in `admin-curriculum.html` also backfills `url` from `name` when opening a legacy entry, so re-saving a curriculum normalizes its data going forward and fixes the admin's "Not playable" badge for it too.
- **Only the one real, published curriculum is actually linked into the site today** ("Take Responsibility for Your Growth") — this was a deliberate scope decision: the Portal page's "Browse the growing library" section shows 9 fictional sample lessons for visual/marketing richness, and only the one card with real backing data (`#featuredLessonCard`, plus a "View Full Lesson Plan →" button on the spotlight) is wired to `lesson-detail.html`. The other 8 stay static and non-clickable since there's no real curriculum behind them yet. As more curricula are built and published in the admin, wiring more cards into the grid would follow the same pattern (match by title/id, generate a `lesson-detail.html?id=...` link).
- The rest of the Portal page (lesson title/description, the 8 non-linked library cards, pricing) is still hand-authored static content, not pulled from the admin — only the resource buttons, quiz content, video, and the one linked lesson detail page described above are live.

**Blog builder (`admin-blogs.html`):**
- Fields: featured image (upload or URL), title, URL slug (auto-generated from the title, editable, kept unique), author, category, excerpt (for listing cards), full post body, tags, publish date, a "Featured Post" toggle (only one post can be featured at a time — turning it on for a new post turns it off for the others), and a Published/Draft toggle.
- **Categories** are a fixed set defined in `admin-common.js` (`FN_BLOG_CATEGORIES`): Morning Boost, Weekend Energy, Books Blog, Mindset. **Morning Boost was added per request** — a short daily-mindset-habit category — and two of the seeded sample posts are published under it so the category isn't empty.
- Unlike the book/curriculum editors, this one is **live**: `blog-mockup.html` reads directly from the same `localStorage` list, so writing a post here and marking it Published makes it appear on the public site immediately (same browser, same `localStorage`) — including in the category filter and the "Read More" pop-up.
- A rough reading-time estimate (~200 words/minute) is calculated automatically and shown both in the editor and on the public post pop-up.
- **Video blog support**: a Video field accepts a YouTube/Vimeo link (with a live embed preview in the editor) or the path to a local video file already in the folder (e.g. `trailer-kill-the-bully.mp4`) — either way it plays for real on the public site. There's also a demo-only file picker matching the curriculum builder's pattern: it remembers a filename and size for the session but doesn't actually persist the video (same `localStorage` size constraint), and shows a "video attached, not playable in this demo" note on the public post instead of an embed. Posts with either kind of video get a "▶ Video" badge on their thumbnail. The embed logic (`fnVideoEmbedHtml` in `admin-common.js`) is shared between the admin preview and the public read-more pop-up.
- **Tags** are a click-to-select set of chips (same pill/checkbox style as Book tags and Curriculum audiences) rather than free text. The available tags are a persisted, growing master list (`FN_KEYS.tags` / `fnGetBlogTags()` in `admin-common.js`) — separate from the fixed `FN_BLOG_CATEGORIES` list. Typing a new tag into the "+ Add Tag" box adds it to that master list (case-insensitive dedupe) and checks it for the current post, so it shows up as a selectable chip for every post after that.

## Assets

- Book covers: `cover-kill-the-bully.png`, `cover-your-past.png`, `cover-5-brains.png`, `cover-how-to-lie.png` — now sourced from professionally pre-cut "_Shadowed" artwork the user supplied (clean transparent background, built-in drop shadow), resized to 700px wide. These replaced the earlier custom-keyed versions and are a quality upgrade, especially for "How to Lie," which was previously the hardest to key cleanly.
- Original source covers as uploaded: `KillTheBully.avif`, `YourPastDoesntDefineYou.avif`, `ThinkWith5Brains.avif`, `HowToLie.avif`. Also present but not currently used on any page: flat (non-3D-render) cover art `killthebully.png`, `yourpastdoesntdefineyou.png`, `thinkwith5brains.png`, `lieandgetawaywithit.jpg`, and the original `_Shadowed` source files — kept in the folder in case they're useful later (e.g., social-share thumbnails).
- Book trailer videos: `trailer-kill-the-bully.mp4`, `trailer-your-past.mp4`, `trailer-5-brains.mp4` — embedded on the corresponding book detail pages (v1 + v2) in a new "Watch the trailer" section between the hero and the bulk-pricing tiers. No trailer was supplied for "How to Lie," so that page has no video section. **These files are large (30–49MB each)** — fine for local viewing, but worth compressing/transcoding before real deployment to avoid slow page loads on the live site. The original raw uploaded video files were removed after confirming they were exact duplicates of the renamed copies, so only the three `trailer-*.mp4` files remain.
- Blog post images currently use hosted Unsplash placeholder photos (seed data only) — swap these for real photography in `admin-blogs.html` whenever it's ready.
- Author photo: `anthony.png`.

## Known limitations

- **No real backend.** Everything data-driven (admin login, book CRUD, newsletter CRM) runs on browser `localStorage`. It's per-browser, not a shared database, and login is not real security — a client-side demo only.
- **`file://` storage sharing.** For the newsletter signup → CRM flow to work, the browser needs to share `localStorage` across files in this folder. Chrome generally does this reliably; for guaranteed behavior across all browsers, serve the folder with a local web server (e.g. `python3 -m http.server` from this directory) instead of double-clicking files.
- **"How to Lie" cover** required a different background-removal technique (edge-detection cutout rather than color-based) because its cover art blends into near-black with no clean color boundary — noted here in case that image is ever re-exported and re-processed.

## Deployment (parked — not yet started)

Target: push the **v1** site to `fixernationeducation.com`, hosted on Hosting.com. Not started — revisit when ready.

**Open question to resolve first:** everything built so far is the general Fixer Nation consumer site (books, membership, blog, etc.). "fixernationeducation.com" sounds like it may be meant specifically for the education-facing pages (National Education Portal / 2D Education - Schools / Programs) rather than the whole site. Confirm intent before deploying.

**Steps, once ready:**
1. Rename (copy) `fixernation-redesign-mockup.html` to `index.html` — servers look for `index.html` by default, so the homepage needs that filename to load automatically at the domain root.
2. Point `fixernationeducation.com` at Hosting.com: either update the domain's nameservers at its current registrar to Hosting.com's (`ns1–ns4.stableserver.net` for accounts created after April 2025, or check the exact values in the Hosting Panel at my.hosting.com), or add an A record pointing to the hosting account's IP if DNS should stay elsewhere. Allow ~24 hours to propagate.
3. Upload all `.html`, `.css`, `.js`, and `.png` files (flat, no folders needed) into `public_html` via cPanel File Manager, or via FTP (FileZilla) for a one-shot folder upload.
4. Confirm AutoSSL issues a certificate for `https://` (usually automatic in cPanel within a few hours of DNS resolving).

**Security caveat — must address before going live:** the admin login (`admin-login.html` / `admin-common.js`) is entirely client-side. The demo password is readable in plain text in `admin-common.js`'s source. Before publishing the admin pages on a real public domain, either:
- Password-protect the `admin-*.html` files using cPanel's "Directory Privacy" (real server-side HTTP auth), or
- Hold off on publishing those specific pages until there's real backend authentication.

## Change log (high-level)

1. Initial design critique of fixernation.org + v1 redesign concept (homepage, About, Books, Join, Blog).
2. v2 alternate direction inspired by secondstep.org (mega-nav, navy/amber) — built in parallel, later deprioritized in favor of v1.
3. Added FN Network, Ask The Fixer, National Education Portal, 2D Education - Schools, and Programs pages (both versions), using real content from the live site and user-provided screenshots.
4. Replaced all book cover placeholders with real cover art; iteratively fixed compression artifacts and removed black backgrounds (transparent cutouts) for all four covers.
5. Built dedicated product detail pages for all four books with real descriptions and bulk-pricing tiers from the live product pages.
6. Built the admin backend: login, dashboard, book product configuration (image/description/pricing/tags/stock/publish), and newsletter CRM (search, manual add, CSV export). Added a working newsletter signup form to both homepages.
7. Added a curriculum builder to the admin backend: audience targeting, objectives, materials, lesson document + video attachments, a quiz builder, and a working per-teacher download-limit simulator.
8. Added mailing addresses to newsletter contacts, a CSV bulk-import feature (file or paste, with preview and dedupe), and a mass marketing email campaigns page with live audience targeting and simulated send.
9. Upgraded all 4 book covers to cleaner pre-cut artwork the user provided, and added embedded trailer videos to the Kill the Bully, Your Past Doesn't Define You, and Think with 5 Brains detail pages (v1 + v2) — no trailer available for How to Lie. Cleaned up duplicate raw video files afterward.
10. Added a blog builder to the admin backend (`admin-blogs.html`) with the typical fields — image, title, slug, author, category, excerpt, body, tags, publish date, featured/published toggles — and created a new "Morning Boost" blog category. Unlike the book and curriculum editors, this one is wired live: posts saved and published here render immediately on the public FN Blogs page (`blog-mockup.html`), including a working category filter and a "Read More" pop-up.
11. Added video blog support: a YouTube/Vimeo/local-file URL field with a live embed preview, plus a demo-only file picker matching the curriculum builder's non-persisting pattern. Video posts get a "▶ Video" badge and play for real in the public read-more pop-up when a URL is set.
12. Replaced the free-text blog Tags field with a click-to-select chip picker backed by a persisted, growing tag list — adding a new tag makes it available for every future post, without touching the fixed blog categories.
13. Added HTML email support to the campaign builder: a Plain Text/HTML toggle, quick-insert content snippets, and a live sandboxed preview while composing, with HTML rendering carried through to the campaign list and the View Campaign modal.
14. Made curriculum quiz answer options configurable per question (2–6 options, add/remove controls) instead of a fixed 4, with the correct-answer marker staying correctly in sync as options are added or removed.
15. Fixed a CSS bug (`.a-field input` width:100% leaking onto the quiz radio buttons) that was making the answer-text field next to each radio invisible — options are now genuinely editable per answer.
16. Added an "Included Resources" checklist to the curriculum editor (Classroom Poster / Student Handout / Teacher Copy / Quiz + Answer Key), matching the resource buttons already shown on the National Education Portal page's featured lesson, and seeded the existing curricula to match.
17. Wired those four resource buttons live on `education-portal-mockup.html`: they now render based on the matching curriculum's Included Resources list, "Quiz + Answer Key" opens a real pop-up with that curriculum's actual quiz questions and correct answers, and the poster/handout/teacher-copy buttons open the attached Lesson Plan Document (or explain that none is attached).
18. Fixed curriculum videos not appearing on the public lesson page: the Video Lessons field only ever stored filename/size metadata (never real video), so there was nothing to show. Added a "+ Add Video URL" option (YouTube/Vimeo/local file, same pattern as blog videos) alongside the existing demo-only file picker, with badges distinguishing the two, and wired `education-portal-mockup.html` to actually embed a URL-based video when one exists.
19. Made "+ Add Video File" actually playable too — it now references the picked file by filename (same approach as cover images) instead of storing dead metadata, and added a shared `fnHandleVideoError` fallback so a missing file shows a clear message on the public page instead of a broken player.
20. Built `lesson-detail.html`, a public lesson-page template driven by `?id=<curriculumId>`, reusing the same live resource buttons / quiz pop-up / video embed as the Portal spotlight plus the full overview/objectives/materials. Linked the one real published curriculum into the Portal page (the featured spotlight and its matching library card) while deliberately leaving the other 8 fictional sample cards static, per a scoping decision to avoid making the "growing library" section look sparse before more real curricula exist.
21. Swapped that curriculum's seed video from a fake placeholder filename to a real, verified YouTube video about growth mindset/SEL for kids (found via search to genuinely match the lesson topic), so the video actually plays on both the Portal spotlight and `lesson-detail.html` right away.
22. Removed that YouTube placeholder again at the user's request — the seed video list is now empty, so the video shown publicly always comes from whatever is actually configured in the admin, not fabricated seed content. Flagged that a stray already-saved placeholder entry could still shadow a user's own uploaded video (first playable entry wins) and how to remove it if so.
23. Fixed the actual root cause of a real user's video not showing on `lesson-detail.html`: their video had been saved before the admin recorded a `.url` field, so the "only render if `.url` exists" check skipped it entirely. Both public video-render functions now fall back to `.name` (the originally picked filename) when `.url` is missing, and `editCurriculum` backfills `.url` from `.name` so re-saving normalizes old data.

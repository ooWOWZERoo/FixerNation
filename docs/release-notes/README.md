# Customer release notes

Fixer Nation now has paying schools and teachers, so any change they can see on the site gets a note they can read. `CHANGELOG.md` stays the internal record. The customer notes live **on the site**:

- **`release-notes.html`** is the index (grouped by month, with an audience filter) and each note's own page (`release-notes.html?note=<id>`), modeled on Apple's release-notes pages: overview, What's new, What changed, What we fixed, Good to know, Where to find it, a side list to jump around. It is public, and it is linked from the footer of every page (Explore column).
- **`release-notes.js`** is the one list of notes, newest first. To add a note, add an entry at the top (the file header explains each field). Do not change a note's `id`: it is in links people have been sent.
- **Drafts.** A note with `published: false` is hidden from visitors and shown only at `release-notes.html?preview=1`. Anything about privacy, data, prices, legal wording or promises starts as a draft until the owner has read it. Flip it to `true` to publish. Tests (`server/test/release-notes.test.js`) check that every note is complete, that Graduate Evidence never says mastery, growth or a score, and that drafts stay hidden.

## When to write one

When a change is **visible to a customer** on a page they use: a new page, tab or button, changed wording they rely on, a moved or removed feature, or a new rule about their students' data. Back-end fixes nobody can see do not need one. Write it in the same release as the change, say what changed and why it helps each audience, say where to find it, and be honest about limits. Run the customer wording through the humanize skill. A feature that is new or changed should also get a how-to video (`tests/howto/`), named in the note's `videos` list; it shows on the note once the video is published.

## The banner

Publishing a note (`published: true`) automatically shows a thin, dismissible banner above the page header on the public site and the school and district portals. It says "New Features Are Released" and links to the release notes page (the list, not one note), for 30 days after the newest published note's date (`release-banner.js`, loaded by `nav.js`, `school-admin-nav.js` and `district-admin-nav.js`). Dismissing it is remembered per note in the visitor's browser, so the next note brings it back. It is never shown for a draft, on the release notes page, on print, on the student pages or the staff admin. Keep the `?v=N` that `release-banner.js` uses for `release-notes.js` equal to the one in `release-notes.html` (a test checks), and bump both whenever `release-notes.js` changes.

## Telling people

The page is the record. To tell people about a change, send an email from Campaigns (`admin-campaigns.html`) that links to the note. Nothing is sent automatically; the owner sends or schedules each one. Email drafts and a Word version for a note can sit in this folder (for example `2026-11-graduate-evidence.docx`), but the text on the page is the source of truth.

| Note | Email draft |
|---|---|
| Graduate Evidence (Releases 151 and 152) | [2026-11-graduate-evidence.md](2026-11-graduate-evidence.md), `2026-11-graduate-evidence.docx` |

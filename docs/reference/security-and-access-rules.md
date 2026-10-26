# Security and access-control rules — full rationale

Moved out of CLAUDE.md to keep the per-turn context small. CLAUDE.md keeps the one-line rules; this file keeps the why, the example access matrix and the history.

## Access control design rules

**Always write the access matrix before building any endpoint that gates access.**
Write every role (anonymous, student, licensed teacher, admin) × every action (view, download, edit) for the specific resource. Share it, confirm it, implement once against it. The file-serving endpoint was fully rewritten because this was skipped — it blocked teachers who had valid licenses.

Example matrix for curriculum file endpoints:
```
Role              | View file | Download file | View Quiz+Key | View docs
------------------+-----------+---------------+---------------+----------
Anonymous         |    YES    |      NO       |      NO       |    NO
Student (class)   |    YES*   |      NO       |      NO       |    NO
Licensed teacher  |    YES    |  YES (counted)|      YES      |   YES
Admin             |    YES    |      YES      |      YES      |   YES
* Student Handout only
```

**Never block the old access path until the new one is proven live.**
Build and verify the replacement in production first; block the old path second. Adding an `.htaccess` `Deny from all` to `uploads/` before the Node `/file` endpoint was running would have taken down every file link. The rule: prove the replacement works, then optionally add the block.

**Grep the entire codebase before calling any security or access migration complete.**
When file access was migrated from raw `/uploads/` URLs to the `/api/.../file` endpoint, a fourth page (`education-portal.html`) was missed and only caught by manual production testing. Before closing any cross-cutting change, run:
```bash
grep -rn "old pattern" --include="*.html" --include="*.js" .
```

**Server-side protection and browser-side protection are different problems.**
Securing the API endpoint (who can call it) is not the same as preventing the user at the browser from saving the rendered content. Opening a file in a new tab via the API still exposes the native PDF viewer's Download button and right-click Save As. PDF.js canvas rendering addresses the browser-side threat: no download button, right-click yields a single-page PNG, URL never appears in the address bar.

**PDF iframes are unreliable.** They fail on iOS/iPadOS and when `Content-Disposition: attachment` is set. Use PDF.js canvas rendering in a modal (`pdf-modal.js`) or open in a new tab via the API. Test on mobile before shipping any file-display feature.

## Security rules (from the 2026-10-15 audit — each one closed a real hole)

- **Never call `jwt.sign`/`jwt.verify` directly** — use `server/lib/session-tokens.js` (per-session-type `aud`; see "Two separate auth systems").
- **Rate limiting:** public endpoints that send email, create rows, or check credentials use `server/lib/rate-limit.js` — `limiter()` for spam-prone forms, `FailureTracker` for logins (counts failures only, cleared on success). It reads the **rightmost** `X-Forwarded-For` entry (the one LiteSpeed wrote; the left ones are client-supplied) and **skips IP limits entirely** when no client IP resolves, so one visitor can never exhaust a bucket shared by everyone. Student PINs are 6 digits, so the per-username lockout (5 failures / 15 min) is the real protection — don't loosen it. Check the app log for the one-time `rate-limit: could not resolve a client IP` warning after deploy.
- **Uploads:** a file's type comes from its bytes (`server/lib/upload-safety.js` — `sniffFile`/`finalizeUpload`), never from the client's `Content-Type` or filename, and the stored extension comes from the detected type. Images from non-admin users are decoded and re-encoded to WebP (`reencodeImageToWebp`) so a disguised HTML/SVG/script file can't survive. SVG is not an accepted upload type (logos go through `branding-editor.js`, which sanitizes it). Uploads are served from the site's own origin, so a stored `.html` is a page that runs with the site's privileges.
- **Randomness for anything guessable-matters** (PINs, join/parent codes, tokens, placeholder passwords): `crypto.randomInt` / `crypto.randomBytes`, never `Math.random()`.
- **Public endpoints that write CRM rows** take only the fields the public form actually has (`POST /api/newsletter/contacts` is name + email for anonymous callers; the full payload only for a real admin).
- **Escaping:** see the Frontend section — `fnEscape()`, and `data-` attributes instead of data inside inline handlers. Email HTML bodies must use `esc()`/`safeUrl()` from `lib/mailer.js` for any user-supplied value (plain-text bodies stay unescaped).
- **Second-level IDs need their own scope check.** Owning classroom `:id` says nothing about `:studentId`; being in a group says nothing about a `:postId` in a different group. Every ID taken from the URL/body gets bound to the already-verified parent in its own query.
- **`.htaccess`:** `<Directory>`/`<LocationMatch>` aren't allowed there and `LimitRequestBody` can't be scoped to a path (it's a global 256 MB cap — lowering it needs the host's server config). Use `RewriteRule`/`SetEnvIf`+`Header … env=`, which are proven to work on this host. CSP is currently **report-only** — promote it to `Content-Security-Policy` once the console is quiet.
- **Never commit credentials**, including test/QA ones: the repo is public and the QA fixture accounts are real accounts in the production DB (one holds a paid licence seat). `seed-qa-test-accounts.js` and the e2e tests read `QA_PASSWORD`/`TEST_QA_PASSWORD` from the environment.

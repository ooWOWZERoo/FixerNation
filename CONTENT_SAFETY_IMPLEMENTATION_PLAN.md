# FNE Content Safety System — Implementation Plan (Phase 1)

Source spec: `FNE_Content_Safety_Functional_Scope.docx` v1.0, Aug 24 2026 ("Approved Functional Scope for Implementation"). That document defines the full 5-phase, 50-requirement target state. This plan scopes **what actually gets built first**, grounded in the real current codebase, and maps every decision back to the source spec section it satisfies.

## 0. Decisions locked in before this plan was written

1. **Corrected UGC scope.** There is no student social/DM feature — students never touch `social.js` (it's gated by `requireSocialAccess`, which requires an active teacher/parent/admin license). The two real UGC surfaces are:
   - **Adult social system** (`server/routes/social.js`) — teacher/parent/school-admin/district-admin posts, comments, reactions, DMs.
   - **Student free-text fields** (`server/routes/student.js`) — `student_reflections.response_text`, `student_goals.goal_text`, submitted by `classroom_students` via PIN auth (a completely separate auth system from `site_users`).
2. **Local layers, build now, zero cost, zero third-party data sharing:**
   - Language/profanity — [`@2toad/profanity`](https://github.com/2Toad/Profanity) (spec's own reference source R7).
   - Image nudity/skin-exposure — [`nsfwjs`](https://github.com/infinitered/nsfwjs) running **in-process** via `@tensorflow/tfjs-node` — no separate service, unlike the Detoxify/NudeNet Python route that was considered and rejected for effort reasons.
3. **Contextual/semantic layer — OpenAI omni-moderation, admin-gated.** Free endpoint (doesn't count against usage), covers mean-without-profanity, hate/bias, threats, self-harm, sexual harassment, and image violence/gore that the two local layers structurally can't reach. Shipped **behind an admin ON/OFF flag, default OFF**, so it can be tested and evaluated live before deciding to keep it, swap it, or move to a paid tier. **Turning the flag on for a school is still a real FERPA/COPPA decision** (spec §24) — the flag makes that decision testable, it doesn't substitute for the review.
4. **No new "School Safety Administrator" role — revised.** There is no new role, no new person-assignment table, and no in-app incident-review portal. This satisfies the original spec's own Approved Product Decision #2 ("Each school designates its own safety recipient or recipients for serious and critical incident alerts") in its simplest possible form: a School License Administrator configures one or more **destination email addresses**, each optionally scoped to a content category (image/media, bullying, self-harm, threat/violence, sexual safety, hate/bias, etc.), or left as a catch-all for "everything." Alerting is pure email notification — nobody logs into a portal to review an incident in Phase 1.
5. **No hardcoded judgment-call values.** Severity thresholds and category→action mappings are real product/policy decisions, not implementation details — they must be admin-configurable from day one, not JS constants tuned later. This promotes the spec's `SafetyRule` concept (§28) into Phase 1 rather than deferring it. The exact rule that fires is also snapshotted onto the scan record (see §2), so a later rule edit never rewrites history.
6. **Alert/incident routing ships in Phase 1.** A `BLOCK_ALERT`/`CRITICAL_BLOCK_ALERT` decision creates an incident record (for audit) and sends real alert emails to the school's configured category recipients now, not just gets logged silently. There is no status-workflow UI yet (see §6) — the "incident" is a record, not a ticket someone works.

## 1. Architecture

### 1.1 Safety Gateway
New module `server/lib/safety/gateway.js` — the single entry point every covered submission path calls:

```js
async function screenContent({
  contentContext,      // 'STUDENT_REFLECTION' | 'STUDENT_GOAL' | 'SOCIAL_POST' | 'SOCIAL_COMMENT' | 'SOCIAL_DM' | 'PROFILE_IMAGE' | 'SOCIAL_IMAGE'
  text,                 // string | null
  images,               // [{ buffer, mimetype }] | null
  authorSiteUserId,      // int | null
  authorStudentId,       // int | null (classroom_students.id)
  schoolDomain,          // string | null
  classroomId,           // int | null
}) -> { decision, findings: [...], scanId }
```

Phase 1 decision enum: `ALLOW`, `ALLOW_LOG`, `BLOCK`, `BLOCK_ALERT`, `CRITICAL_BLOCK_ALERT`. (`COACH_REWRITE` — the ask-user-to-revise-and-resubmit UX — and `QUARANTINE` — media held in a separate pending-review state rather than checked synchronously — are the two decisions still deferred to Phase 2+; see §6. Everything alert/incident-related ships now.)

Pipeline inside the gateway:
1. `normalize.js` — Unicode NFKC normalization, zero-width-char stripping, leetspeak/repeated-char collapsing for *analysis only*; the original text is always preserved unmodified for the evidence record (spec §8, FR-006).
2. `lexical.js` — wraps `@2toad/profanity`, seeded with FNE terms + school-specific terms/allowlist from the new `safety_terms` table (§2 below), whole-word matching to avoid the AC-003 benign-substring trap.
3. `contextual.js` — provider-abstracted (`FR-045`). Ships with a `NullProvider` (always returns no finding) as the default, and an `OpenAiProvider` (omni-moderation) that's only invoked when both `OPENAI_API_KEY` is set in `server/.env` **and** the admin flag is on for that school. This satisfies the "replaceable provider" requirement structurally — swapping providers later is a new file implementing the same interface, not a rewrite.
4. `image.js` — `nsfwjs` classification (Drawing/Neutral/Sexy/Porn/Hentai scores) against any image buffer before it's accepted, using `@tensorflow/tfjs-node` for server-side inference (no browser dependency).
5. `policy.js` — merges findings from all three layers into one decision by looking up **admin-configurable** rules from the new `safety_rules` table (category + minimum severity → action), never a hardcoded constant. FNE-locked rules (spec's "Locked FNE Guardrails," §21) are seeded with `is_locked = 1` and rejected by the API if a School License Administrator tries to edit or weaken them; everything else is a real, editable judgment call from day one.
6. `incident.js` — when the merged decision is `BLOCK_ALERT` or `CRITICAL_BLOCK_ALERT`, creates a `safety_incidents` row **in the same transaction** as the scan (per spec §30.3's "critical incident creation: same completed moderation transaction") and calls `alerts.js` to email the school's configured category recipients (plus the classroom teacher for student-context incidents) — see §2 and §4 below.
7. `audit.js` — always writes a `safety_scans` + `safety_findings` row, even on plain ALLOW, so there's a record for every scan per FR-048.

### 1.2 Fail-closed behavior
Any unhandled error anywhere in the pipeline forces `decision = BLOCK` and records the error on the scan row. This applies even though today's Phase-1 layers are local (no network provider to time out) — `tfjs` model load or a corrupt image buffer are still real failure modes worth failing closed on, and the contextual layer *is* a network call once the flag is on.

## 2. Data model — Phase 1 subset of the spec's §28

New migration: `server/scripts/alter-add-content-safety.js` (follows the existing `columnExists`/`CREATE TABLE IF NOT EXISTS` idempotent pattern used throughout `server/scripts/alter-*.js`).

```sql
CREATE TABLE IF NOT EXISTS safety_terms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('fne','school') NOT NULL DEFAULT 'school',
  school_domain VARCHAR(255) NULL,
  term VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_allowlist TINYINT(1) NOT NULL DEFAULT 0,
  created_by_admin_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_school (school_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS safety_scans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  content_context VARCHAR(64) NOT NULL,
  author_site_user_id INT UNSIGNED NULL,
  author_student_id INT UNSIGNED NULL,
  school_domain VARCHAR(255) NULL,
  classroom_id INT UNSIGNED NULL,
  decision VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_author (author_site_user_id, author_student_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS safety_findings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scan_id INT UNSIGNED NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity TINYINT UNSIGNED NOT NULL,
  source ENUM('lexical','contextual','image') NOT NULL,
  confidence FLOAT NULL,
  rationale VARCHAR(500) NULL,
  FOREIGN KEY (scan_id) REFERENCES safety_scans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin-configurable category -> action mapping. Every threshold that would
-- otherwise be a hardcoded judgment call in policy.js lives here instead.
CREATE TABLE IF NOT EXISTS safety_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('fne','school') NOT NULL DEFAULT 'fne',
  school_domain VARCHAR(255) NULL,
  category VARCHAR(64) NOT NULL,
  min_severity TINYINT UNSIGNED NOT NULL,
  action ENUM('allow','allow_log','block','block_alert','critical_block_alert') NOT NULL,
  is_locked TINYINT(1) NOT NULL DEFAULT 0, -- FNE-locked guardrail; schools cannot edit/weaken (spec §21)
  created_by_admin_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_category (category, school_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-school, per-category alert destination emails. This IS the "School
-- Safety Administrator" concept from the original spec, reduced to what it
-- actually needs to be: notification-only, no role, no login required by
-- the recipient, no in-app review portal.
CREATE TABLE IF NOT EXISTS safety_alert_recipients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_domain VARCHAR(255) NOT NULL,
  category VARCHAR(64) NULL, -- NULL = catch-all, receives every category not otherwise matched
  email VARCHAR(255) NOT NULL,
  label VARCHAR(100) NULL, -- optional free-text, e.g. "Principal", "Counselor"
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_school_category (school_domain, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Record only — no status workflow, no reviewer role, no portal in Phase 1.
-- Created for audit/traceability every time a BLOCK_ALERT/CRITICAL_BLOCK_ALERT
-- decision is reached.
CREATE TABLE IF NOT EXISTS safety_incidents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scan_id INT UNSIGNED NOT NULL,
  school_domain VARCHAR(255) NULL,
  classroom_id INT UNSIGNED NULL,
  category VARCHAR(64) NOT NULL,
  severity TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (scan_id) REFERENCES safety_scans(id) ON DELETE CASCADE,
  INDEX idx_school (school_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per email actually sent for an incident (recipients + the
-- auto-routed classroom teacher, when applicable).
CREATE TABLE IF NOT EXISTS safety_alerts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  incident_id INT UNSIGNED NOT NULL,
  recipient_email VARCHAR(255) NOT NULL, -- plain address, not an FK — destination emails are not required to be site_users
  recipient_kind ENUM('configured_recipient','classroom_teacher','fallback') NOT NULL,
  sent_at DATETIME NULL,
  FOREIGN KEY (incident_id) REFERENCES safety_incidents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Also add one column to `safety_scans` (§2 above) for the rule-traceability recommendation in §0.5:
```sql
ALTER TABLE safety_scans ADD COLUMN matched_rule_snapshot JSON NULL;
-- e.g. {"ruleId": 14, "category": "self_harm", "minSeverity": 4, "action": "critical_block_alert", "isLocked": 1}
```
This is deliberately a denormalized copy, not a foreign key — editing `safety_rules` later can never retroactively change what a past scan's snapshot says fired. It closes spec §27's "preserve old policy version metadata on historical incidents" requirement at the cost of one JSON column instead of a full `SafetyPolicyVersion` entity with effective dates.

The contextual-moderation ON/OFF flag reuses the **existing** `settings` table (`setting_key`/`setting_value`, already `TEXT`-typed per `alter-settings-value-to-text.js`) — same pattern as `teacher-lesson-plan-limit` in `server/routes/settings.js`. No new table needed for that.

**Routing/notification logic (what `incident.js` actually does on `BLOCK_ALERT`/`CRITICAL_BLOCK_ALERT`):**
1. Insert the `safety_incidents` row (audit record only, no status field — nothing works it).
2. Look up `safety_alert_recipients` for that `school_domain` where `category` matches the incident's category, **union** with that school's catch-all (`category IS NULL`) rows. Email every matched address (`recipient_kind = 'configured_recipient'`).
3. If `content_context` is `STUDENT_REFLECTION` or `STUDENT_GOAL`, **also** always email the student's classroom teacher directly at their `site_users.email` (`recipient_kind = 'classroom_teacher'`) — this is the one piece of the original spec's teacher-routing decision (#8, FR-035) that survives the simplification: a teacher only ever learns about incidents tied to their own classroom, via email, never a blanket feed.
4. **Fallback safeguard (new, my recommendation — flagging for your sign-off):** if step 2 finds zero matching recipients for a `CRITICAL_BLOCK_ALERT` (i.e. the school hasn't configured anyone for that category or a catch-all), also send to a single FNE-internal fallback address (new setting, e.g. `content_safety_fallback_email`) so a critical self-harm/threat finding can never go completely unnoticed just because a school forgot to configure recipients (`recipient_kind = 'fallback'`). Plain `BLOCK_ALERT` (non-critical) does not trigger this fallback — only `CRITICAL_BLOCK_ALERT`.
5. Every send writes a `safety_alerts` row (audit of who was actually notified) using the existing `mailer.js` pattern — subject/body carries incident ID, category, severity, school/classroom context, and timestamp only, never the flagged text/image itself (spec §22).

**Fixing the `school_domain` integrity gap once and for all (not deferring this again):**
This is the third time a feature has needed `purchases.school_domain` to be reliably populated (branding, then this). Concrete plan, not another flag:
1. Re-run a fresh audit (same shape as the Aug 24 branding fix) to confirm zero current `purchases` rows with active seats and no `school_domain`.
2. Grep every purchase-creation and purchase-edit code path (`checkout.js` Stripe webhook, PO checkout, `quote-accept.js`, `newsletter.js`'s `createPurchase`/edit) to confirm **all** of them call the existing shared `findOrCreateSchoolId(domain)` helper — close any path that doesn't, rather than assuming the Aug 24 fix already covers every case.
3. Add `server/scripts/check-school-domain-integrity.js` — a standing, re-runnable script that flags any group-license purchase with seats but no `school_domain`, intended to be run periodically (or added to a future admin "Data Health" widget) so this can never again silently resurface and only get noticed via a user bug report.
4. The new alert-recipient config screen itself refuses to let a School License Administrator configure recipients for a purchase with no `school_domain` — surfaces "This school has no domain set yet — contact support before configuring alerts" instead of silently accepting a config that can never route correctly. This closes the loop at the exact point the bug historically hid.

**Deferred to Phase 2+ (spec's own §34 phases 2–5), not built now:**
- `safety_pattern_signal` (24h/7d/30d/90d behavioral windows) and the reviewer-facing timelines (§11, §23)
- Any in-app incident-review portal, status workflow (NEW/ACKNOWLEDGED/.../ARCHIVED), or reviewer role — Phase 1 is notification-only per your direction; `safety_incidents` is a record, not a ticket
- `safety_evidence` with encrypted quarantine storage, retention/legal-hold (§25) — Phase 1 checks images synchronously at upload time rather than holding them in a separate quarantine state, and blocked content lives in `safety_scans`/`safety_findings` without a dedicated encrypted evidence store or 90-day deletion job yet
- OCR on images (§19)
- `COACH_REWRITE` (ask-user-to-revise-and-resubmit) and `QUARANTINE` (media held pending review rather than checked synchronously)

## 3. Integration points (exact call sites)

| File | Endpoint | Context |
|---|---|---|
| `server/routes/social.js` | `POST /groups/:groupId/posts` (~line 250) | `SOCIAL_POST` |
| `server/routes/social.js` | `POST /posts/:postId/comments` (~line 329) | `SOCIAL_COMMENT` |
| `server/routes/social.js` | `POST /messages` (~line 419) | `SOCIAL_DM` |
| `server/routes/social.js` | `POST /upload` (~line 69, `socialUploadMw`) | `SOCIAL_IMAGE` |
| `server/routes/student.js` | `POST /lesson/:curriculumId/reflect` (~line 218) | `STUDENT_REFLECTION` |
| `server/routes/student.js` | `POST /goals` (~line 253) | `STUDENT_GOAL` |
| `server/routes/site-auth.js` | `POST /profile/avatar` (~line 18, `avatarUpload`) | `PROFILE_IMAGE` |

Each site changes the same way: call `gateway.screenContent(...)` before the existing `INSERT`/file-accept logic; on `BLOCK`, return `422` with one of the spec's §31.3 neutral messages instead of inserting; on `ALLOW`/`ALLOW_LOG`, proceed unchanged (an `ALLOW_LOG` finding still gets written to `safety_findings` for later review even though the content publishes).

## 4. Admin surface

New `admin-content-safety.html`, added to `admin-nav.js`'s Community section next to `admin-social.html`:
- **"Contextual AI Moderation (Beta)"** card — ON/OFF toggle, `GET/PUT /api/settings/content-safety-openai` (mirrors the existing `teacher-lesson-plan-limit` GET/PUT pair in `settings.js`). Off by default. Explicit inline warning: *"Third-party service — enabling this sends post/comment/message text (and images, once image support is added to this provider) to OpenAI for review. Do not enable for a school before completing a privacy review."*
- **Rule editor** — table over `safety_rules`: category, minimum severity, action, per FNE-wide vs. per-school scope. FNE (`admin`) can create/edit any row including `is_locked` ones; a School License Administrator's equivalent view only shows their own `school_domain` rows and cannot touch `is_locked = 1` FNE rows (enforced server-side, not just hidden in the UI — spec's "Enforcement must occur in server-side policy and permissions, not only through disabled UI controls").
- FNE + school-term management — CRUD table against `safety_terms`, same scoping rules as above.
- **"Safety Alert Recipients"** card, on the school-facing side (wherever the School License Administrator already manages their school's settings — same area as image-upload enable/disable, per spec §21): add/edit/remove rows of `{ category (dropdown, or "All categories"), email, label }` against `safety_alert_recipients`, scoped to their own `school_domain`. This is the entire "who gets notified" configuration — no separate role, no assignment step, just email addresses.

FNE also gets a read-only **"Content Safety Fallback Email"** field on the existing global settings page (`admin-settings.html`) for the `content_safety_fallback_email` safeguard described in §2.

No FNE-side or school-side incident-*review* UI ships in Phase 1 — `safety_incidents`/`safety_alerts` exist purely as DB records for audit, queryable directly if ever needed, not surfaced in any admin page yet.

## 5. New dependencies

- `@2toad/profanity` (npm)
- `nsfwjs` + `@tensorflow/tfjs-node` (npm) — **deploy risk to flag explicitly**: `tfjs-node` has native/prebuilt bindings; needs verification that it installs cleanly on the cPanel host's Node 24 runtime (per `CLAUDE.md` gotcha #9/#11 — `npm install --prefix server` + restart required after this dependency lands, same as every past dependency addition). If the native binary doesn't have a prebuilt binding for that platform, this could be the first real blocker — worth a quick `npm install` test on the actual server early rather than discovering it at the end.
- `openai` (official npm SDK) — only invoked when the admin flag is on; `sharp` (already a dependency) can pre-resize images before they're handed to `nsfwjs`/OpenAI.

## 6. Explicitly out of scope for this first pass

Bullying/behavioral-pattern analysis and timelines (§11, §23), any in-app incident-review portal or status workflow, OCR (§19), encrypted quarantine/evidence-retention/legal-hold (§25), and `COACH_REWRITE`/`QUARANTINE` decisions are the remaining real parts of the approved spec not built in this pass — genuine Phase 2+ scope per the spec's own rollout plan (§34), not things skipped by oversight. Everything else — local lexical + local image screening, an optional/flagged contextual layer, fully admin-configurable rules with historical-rule traceability, per-school per-category email alert routing (including the teacher auto-route for student content and the critical-alert fallback safeguard), and a permanent fix for the recurring `school_domain` gap — ships now.

## 7. Testing

Subset of the spec's `TS-001`–`TS-050` relevant to this scope: `TS-001`–`TS-013` (language/hostility/sexual text), `TS-023`–`TS-030` (images), `TS-035`–`TS-038` (school terms, allowlist, provider fail-closed, duplicate-retry idempotency), plus alert-routing coverage: `AC-019` (school-designated recipients receive routed critical incidents — now verified as "the configured email actually receives the message," not portal access), `TS-048`/`TS-049` (no automatic parent alert; critical-incident recipients route only per configured school policy). New specs: `tests/e2e/content-safety-lexical.spec.ts`, `content-safety-image.spec.ts`, `content-safety-provider-flag.spec.ts`, `content-safety-alert-routing.spec.ts` (covers category matching, catch-all fallback, teacher auto-route, and the zero-recipients-configured critical-fallback path).

## 8. Open items — down to one

Items 1–4 from the previous revision are resolved by the redesign above (no role, no routing-algorithm ambiguity, a concrete `school_domain` remediation plan, and rule-snapshotting adopted per your "what do you recommend"). One new item from this redesign, worth your explicit sign-off since I added it unprompted:

1. **The critical-alert fallback-to-FNE-internal-email safeguard (§2, step 4)** — I'm proposing this because a `CRITICAL_BLOCK_ALERT` (potential self-harm/threat) with zero configured recipients would otherwise notify literally no one, which seems like an unacceptable failure mode for the highest-severity case. This means FNE staff could see raw safety-critical content for a school that hasn't configured its own recipients yet. Confirm you want this, and if so, who/what that fallback address should actually be.

# FixerNation Education — Live Database Schema

Pulled directly from the production database (`fixernat_fixernation`) via `SHOW CREATE TABLE`, not from `server/db/schema.sql` — that file is a known stale/incomplete source of truth (many tables and columns only ever arrived via one-off `alter-*.js` migration scripts and were never backfilled into it). This file is what to trust for "what does the live database actually look like."

> **Maintenance convention:** whenever a schema change ships to production (new table, new column, any `alter-*.js`/`backfill-*.js` script), update the relevant section below in the same session — don't let this drift the way `schema.sql` did. `server/scripts/dump-schema.js` (read-only, `SHOW CREATE TABLE` for every table) is the fastest way to re-verify against the live database if this doc is ever in doubt.

**Generated:** 2026-09-04 · **89 tables total** · Grouped by subsystem for readability. Legend: 🔑 = primary key, 🔗 = foreign key, ⭐ = unique key.

---

## 1. Admin & Site-User Auth

### `admin_users` — FNE staff accounts (`fn_session` cookie)
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 auto_increment |
| username | varchar(64) | ⭐ NOT NULL |
| password_hash | varchar(255) | NOT NULL |
| created_at | datetime | default now |
| email | varchar(255) | ⭐ nullable |
| email_verified | tinyint(1) | default 1 |

### `admin_invite_tokens` — staff invite links
id 🔑 · admin_id 🔗→admin_users (CASCADE) · token varchar(128) ⭐ · expires_at datetime · created_at datetime

### `site_users` — teachers/parents/school & district admins (`fn_user_session` cookie)
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 |
| first_name / last_name | varchar(100) | NOT NULL |
| email | varchar(255) | ⭐ NOT NULL |
| password_hash | varchar(255) | NOT NULL |
| email_verified | tinyint(1) | default 0 |
| role | varchar(32) | default 'teacher' — 'parent'/'school_license_admin'/'district_admin' etc. (not exclusive; entitlements checked independently) |
| created_at | datetime | |
| session_invalidated_at | datetime | nullable — set on password reset/seat revoke to force-logout other sessions |

### `site_user_tokens` — email verification / password reset tokens
id 🔑 · user_id 🔗→site_users (CASCADE) · token varchar(128) ⭐ · type varchar(20) · expires_at · created_at

### `site_user_audiences` — grade levels a teacher teaches
id 🔑 · site_user_id 🔗→site_users (CASCADE) · audience varchar(64) · ⭐ (site_user_id, audience)

---

## 2. CRM

### `newsletter_contacts` — the CRM contact record (buyer of record for every purchase)
id 🔑 · name · email ⭐ NOT NULL · street/city/state/zip · signup_date · source (default 'Homepage') · status (default 'Subscribed') · phone · company · notes text · morning_boost_unsubscribed_at

### `contact_groups` — CRM segments
id 🔑 · name varchar(128) ⭐ · created_at · system_key varchar(50) ⭐ nullable (marks a group as a reserved system category)

### `contact_group_members` — join table
🔑 (contact_id, group_id) · contact_id 🔗→newsletter_contacts (CASCADE) · group_id 🔗→contact_groups (CASCADE)

---

## 3. Licensing, Schools & Districts

### `license_products` — admin-editable catalog
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 |
| name, description, seat_count, price_cents | | catalog basics |
| sort_order, active | | display |
| call_for_quote | tinyint(1) | hides price, "Call For Quote" |
| auto_assign_group_id | int unsigned | nullable |
| bullet_points | text | newline-separated |
| footer_note | varchar(255) | old informal term-length text, e.g. "Valid for 12 months" |
| variable_seats | tinyint(1) | buyer picks seat count |
| is_trial, trial_days, trial_lesson_limit, trial_library_limit | | trial tier config |
| **duration_days** | int unsigned | **NEW (this session)** — structured license length (30/60/90/180/365), drives auto-computed expiration |
| addon_rate_cents | int unsigned | nullable |

### `purchases` — one row per order line (the central licensing table)
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 |
| contact_id | int unsigned | 🔗→newsletter_contacts |
| product_type | varchar(32) | book / single_license / group_license |
| book_id | int unsigned | 🔗→books, nullable |
| seat_count | int unsigned | nullable |
| purchased_at | datetime | |
| source, notes | | |
| stripe_session_id | varchar(255) | nullable, not unique (one cart session → multiple rows) |
| stripe_invoice_id | varchar(255) | ⭐ nullable |
| school_domain | varchar(255) | nullable, normalized |
| school_id | int unsigned | 🔗→schools, nullable |
| license_product_id | int unsigned | 🔗→license_products, nullable |
| payment_method | varchar(16) | manual/stripe/po |
| payment_status | varchar(16) | paid/pending |
| license_status | varchar(16) | active/pending/scheduled/expiring_soon/expired/suspended/cancelled/converted |
| effective_date, expiration_date | date | nullable |
| **license_duration_days** | int unsigned | **NEW** — snapshot of intended length at purchase time, never retroactive |
| trial_expiration_date, trial_lesson_limit, trial_library_limit | | trial tracking |
| conversion_credit_cents, conversion_credit_redeemed_at, converted_to_purchase_id | | trial→paid conversion |
| quote_id | int unsigned | nullable |
| renewal_reminder_sent_at | datetime | dedup flag for the expiry-reminder cron |
| po_number | varchar(128) | nullable |
| invoice_id | int unsigned | 🔗→invoices, nullable |
| amount_cents | int unsigned | snapshotted charge amount |

### `license_seats` — one row per seat
id 🔑 · purchase_id 🔗→purchases (CASCADE) · invited_email · status (pending/registered/inactive/revoked/available) · registered_site_user_id 🔗→site_users (SET NULL) · registered_at · invitation_id · revoked_at/by/reason · notes

### `license_utilization_alerts` — dedup log for seat-usage warning emails
id 🔑 · purchase_id · threshold_pct · sent_at

### `invoices` — PO-order grouping (Stripe/card checkouts never create one)
id 🔑 · invoice_number varchar(32) ⭐ · contact_id 🔗→newsletter_contacts (CASCADE) · po_number · po_received_date · total_cents · status (unpaid/paid/cancelled) · created_at · paid_at

### `trial_curriculum_accesses` — trial-tier preview cap tracking
🔑 (purchase_id, curriculum_id) · purchase_id 🔗→purchases (CASCADE) · first_accessed_at

### `school_invitations` — teacher invite links from a school admin
id 🔑 · purchase_id 🔗→purchases (CASCADE) · seat_id 🔗→license_seats (SET NULL) · invited_email · first/last_name · token ⭐ · status · grade_level/role_title/department/subject_area · personal_message · invited_by_site_user_id · expires_at · resend_count · last_resent_at · revoked_at/by/reason · created_at

### `school_license_admins` — school-admin role assignments (does NOT consume a seat)
id 🔑 · site_user_id 🔗→site_users (CASCADE) · purchase_id 🔗→purchases (CASCADE) · permission_level (primary/secondary/read_only) · is_active · created_by_admin_id · notes · ⭐ (site_user_id, purchase_id)

### `district_license_admins` — district-admin role assignments
id 🔑 · site_user_id 🔗→site_users (CASCADE) · district_id 🔗→districts (CASCADE) · is_active · created_by_admin_id · notes · ⭐ (site_user_id, district_id)

### `schools` — first-class school entity (backfilled from `purchases.school_domain`)
id 🔑 · domain varchar(255) ⭐ · district_id 🔗→districts (SET NULL) · display_name · created_at

### `districts`
id 🔑 · name · created_at

### `school_branding` / `district_branding` — draft/published logo+colors
PK is `school_id`/`district_id` 🔗 (CASCADE) · draft_logo_original_url/display_url · draft_primary/secondary/accent_color · published_* (mirror of draft_*) · branding_status enum(DEFAULT/DRAFT/PUBLISHED) · updated_at/by 🔗→site_users (SET NULL) · published_at · draft_logo_crop / published_logo_crop (JSON, validated via CHECK)

### `school_audit_log` — append-only action log
id 🔑 · actor_type/id/email · action · entity_type/id · purchase_id · school_domain · prev_value/new_value (JSON-as-text) · reason · ip_address · created_at

### `school_admin_notifications` — dedup log for school-admin alert emails
id 🔑 · school_domain · reason · teacher_email · admin_contact_id · sent_at

---

## 4. Quotes

### `quote_requests`
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 |
| quote_number | varchar(6) | ⭐ |
| quote_valid_until | date | nullable |
| **expiring_reminder_sent_at** | datetime | **NEW** — dedup flag for the 7-day quote-expiry reminder cron |
| accept_token | varchar(64) | ⭐ |
| accepted_at, accepted_payment_method | | |
| first_name, last_name, email, school, phone, message | | |
| quoted_school_domain | varchar(255) | |
| content_profile_id | int unsigned | 🔗→quote_content_profiles (SET NULL) |
| origin | varchar(10) | inbound/admin |
| status | enum | new/contacted/converted/closed |
| notes | text | |
| quoted_product_id, quoted_product_name, quoted_seat_count, quoted_amount_cents | | |
| quoted_at, quote_sent_at, created_at | | |
| quoted_tier_name, quoted_addon_seats, quoted_proration_factor (unused), quoted_term_years | | pricing breakdown |
| admin_invited_at | | |

### `quote_content_profiles` — reusable quote-email content sets
id 🔑 · name ⭐ · section_annual_includes/lesson_package/video_access/license_terms (text) · is_default · created_at/updated_at

---

## 5. Curriculum & Content

### `curricula` — lesson plans
id 🔑 · title · series · short_description, overview · lesson_document, lesson_document_name · download_limit · published · created_at/updated_at · lessons_count, weeks_count · sort_order

### `curriculum_audiences` / `curriculum_materials` / `curriculum_objectives`
Each: id 🔑 · curriculum_id 🔗→curricula (CASCADE) · one text field (audience/material/objective) · sort_order where applicable

### `curriculum_resources` — Teacher Copy / Student Handout / Classroom Poster files
id 🔑 · curriculum_id 🔗→curricula (CASCADE) · resource varchar(64) · file_path, file_name · download_limit

### `curriculum_videos`
id 🔑 · curriculum_id 🔗→curricula (CASCADE) · name · url · size_label · sort_order

### `curriculum_quiz_questions` / `curriculum_quiz_options`
questions: id 🔑 · curriculum_id 🔗 (CASCADE) · question text · correct_index · sort_order
options: id 🔑 · question_id 🔗→curriculum_quiz_questions (CASCADE) · option_text · sort_order

### `curriculum_downloads` — per-resource download counter/rate-limit
id 🔑 · curriculum_id · user_email · user_type (teacher/parent) · resource_type (default 'any') · count · last_download · ⭐ (curriculum_id, user_email, user_type, resource_type)

---

## 6. Books

### `books`
id 🔑 · title, author · cover_image · short/long_description · price, compare_at_price · sku · category · stock_status (default 'In Stock') · amazon_url · published · created_at/updated_at · kindle/hardcover/paperback price+url

### `book_tags`
id 🔑 · book_id 🔗→books (CASCADE) · tag

---

## 7. Blog & Morning Boost

### `blog_posts`
id 🔑 · title, theme, series, slug ⭐ · author · category · featured_image · excerpt, body (mediumtext) · video_url/file_name/size_label · publish_date · featured, published · created_at/updated_at · alt_text, meta_description, focus_keyword · requires_membership (legacy, membership system removed — internal field only)

### `blog_post_categories` / `blog_post_tags`
Each: id 🔑 · post_id 🔗→blog_posts (CASCADE) · category/tag

### `blog_tags`
id 🔑 · tag ⭐

### `morning_boost_calendar`
id 🔑 · boost_date date ⭐ · theme, series · blog_post_id 🔗→blog_posts (SET NULL) · created_at

### `morning_boost_audio_clips`
id 🔑 · filename ⭐ · script_text · created_at

### `morning_boost_email_config` — single-row campaign config
id 🔑 · enabled · send_time, send_timezone · from_name/email, reply_to · subject, body, body_format · cta_text, cta_url_override · fallback_message · updated_at/by

### `morning_boost_email_groups`
🔑 (config_id, group_id)

### `morning_boost_sends` / `morning_boost_send_recipients`
sends: id 🔑 · config_id, blog_post_id · boost_date · scheduled_for, sent_at · status · subject/from_email/from_name/reply_to/cta_url (snapshot) · group_ids (text) · recipient/sent/failed/skipped_count · failure_reason · is_resend · initiated_by · created_at
recipients: id 🔑 · send_id · contact_id · email · status · error_message · sent_at · open_token ⭐/opened_at · click_token ⭐/clicked_at

---

## 8. Classroom / Student System

### `classrooms`
id 🔑 · name · teacher_site_user_id · purchase_id (nullable) · join_code char(8) ⭐ · parent_code ⭐ nullable (legacy, no longer used for self-join) · grade_level, subject, academic_year · archived_at · created_at

### `classroom_students` — classroom-PIN students (no email, ever)
id 🔑 · classroom_id 🔗→classrooms (CASCADE) · display_name · username ⭐ · password_hash (their PIN) · student_number · is_active · created_at

### `classroom_assignments` / `classroom_game_assignments`
assignments: id 🔑 · classroom_id 🔗 (CASCADE) · curriculum_id · assigned_by_id · sort_order · due_date · assigned_at · ⭐ (classroom_id, curriculum_id)
game assignments: id 🔑 · classroom_id 🔗 (CASCADE) · game_id · assigned_by_id · due_date · created_at

### `student_lesson_progress`
id 🔑 · student_id 🔗→classroom_students (CASCADE) · curriculum_id · started_at, completed_at, last_activity_at · ⭐ (student_id, curriculum_id)

### `student_quiz_responses` — final, graded answers (write-once; existence = "submitted")
id 🔑 · student_id 🔗→classroom_students (CASCADE) · curriculum_id · question_id · selected_option_index · is_correct · submitted_at · ⭐ (student_id, question_id)

### `student_quiz_drafts` — **NEW this session**, save-progress feature
id 🔑 · student_id · curriculum_id · question_id · selected_option_index · saved_at · ⭐ (student_id, curriculum_id, question_id) — deliberately separate from `student_quiz_responses` so an in-progress draft never trips the one-attempt lock

### `student_reflections` / `student_goals`
reflections: id 🔑 · student_id 🔗 (CASCADE) · curriculum_id · prompt_key · response_text · submitted_at · teacher_seen_at
goals: id 🔑 · student_id 🔗 (CASCADE) · goal_text · target_date · is_achieved, achieved_at · created_at

### `student_game_completions`
id 🔑 · student_id 🔗→classroom_students (CASCADE) · game_assignment_id 🔗→classroom_game_assignments (CASCADE) · raw_score · duration_ms · completed_at

### `parent_classroom_links` — per-child parent↔classroom link
id 🔑 · site_user_id 🔗→site_users (CASCADE) · classroom_id 🔗 (CASCADE) · student_id 🔗→classroom_students (SET NULL) · linked_at · ⭐ (site_user_id, classroom_id, student_id)

### `parent_student_invitations`
id 🔑 · classroom_id 🔗 (CASCADE) · student_id 🔗→classroom_students (CASCADE) · invited_email, invited_name · token ⭐ · status · invited_by_site_user_id · personal_message · expires_at · revoked_at · created_at

### `teacher_lesson_plans` — a teacher's personal saved-lesson library
🔑 (site_user_id, curriculum_id) · both 🔗 (CASCADE) · selected_at

---

## 9. Brain Games

### `brain_games`
id 🔑 · name · slug ⭐ · description · icon · primary_skill · active · display_order · created_at

### `brain_badges`
id 🔑 · name · slug ⭐ · description · game_id 🔗→brain_games (SET NULL) · category (default 'achievement') · rarity (default 'common') · criteria_type, criteria_json · xp_reward · emoji · active, publicly_displayable · display_order · created_at

### `brain_game_sessions`
id 🔑 · user_id 🔗→site_users (CASCADE) · game_id 🔗→brain_games · session_token ⭐ · started_at, completed_at · duration_ms · difficulty · raw_score, normalized_score, accuracy · status · metrics_json · scoring_version · validation_status · leaderboard_eligible · xp_earned · created_at/updated_at

### `brain_game_user_progress`
id 🔑 · user_id 🔗→site_users (CASCADE) · game_id 🔗→brain_games · level, xp · total_sessions, total_completed · best_raw_score, best_normalized_score, best_metrics_json · last_played_at · created_at/updated_at · ⭐ (user_id, game_id)

### `brain_user_streaks`
id 🔑 · user_id 🔗→site_users (CASCADE) ⭐ · current_streak, longest_streak · last_qualifying_date · created_at/updated_at

### `brain_game_privacy`
id 🔑 · user_id 🔗→site_users (CASCADE) ⭐ · show_activity/score/streaks/badges · created_at/updated_at

### `user_brain_badges`
id 🔑 · user_id 🔗→site_users (CASCADE) · badge_id 🔗→brain_badges · earned_at · triggering_session_id · featured, featured_position · visibility (default 'public') · created_at · ⭐ (user_id, badge_id)

---

## 10. Social / Community

### `social_groups`
id 🔑 · name · type enum(all_teachers/school/membership/custom) · school_domain · description · created_at · is_public

### `social_group_members` / `social_group_reads`
members: 🔑 (group_id, user_id) · joined_at
reads: 🔑 (group_id, user_id) · last_read_at

### `social_posts`
id 🔑 · group_id 🔗→social_groups (CASCADE) · author_id · content · attachments (JSON, validated) · created_at/updated_at · deleted_at (soft-delete)

### `social_comments`
id 🔑 · post_id 🔗→social_posts (CASCADE) · author_id · content · created_at · deleted_at

### `social_reactions`
🔑 (post_id, user_id) · post_id 🔗→social_posts (CASCADE) · reaction (default 'like') · created_at

### `social_messages` — direct messages
id 🔑 · sender_id, recipient_id · content · attachments (JSON) · read_at · created_at · deleted_at

### `social_profiles`
PK `user_id` 🔗→site_users (CASCADE) · bio, bio_consent · avatar_url · updated_at

---

## 11. Content Safety

### `safety_rules` — admin-editable threshold config
id 🔑 · scope enum(fne/school) · school_domain · category · min_severity · action enum(allow/allow_log/block/block_alert/critical_block_alert) · is_locked · created_by_admin_id · created_at/updated_at

### `safety_terms` — profanity/term lists
id 🔑 · scope, school_domain · term · category · severity (default 2) · is_allowlist · created_by_admin_id · created_at

### `safety_scans` — one row per content-safety check performed
id 🔑 · content_context · author_site_user_id, author_student_id · school_domain, classroom_id · decision · matched_rule_snapshot (JSON) · created_at

### `safety_findings`
id 🔑 · scan_id 🔗→safety_scans (CASCADE) · category · severity · source enum(lexical/contextual/image) · confidence · rationale

### `safety_incidents`
id 🔑 · scan_id 🔗→safety_scans (CASCADE) · school_domain, classroom_id · category · severity · created_at

### `safety_alerts` — outbound notification log for an incident
id 🔑 · incident_id 🔗→safety_incidents (CASCADE) · recipient_email · recipient_kind enum(configured_recipient/classroom_teacher/fallback) · sent_at

### `safety_alert_recipients` — per-school, per-category destination config
id 🔑 · school_domain · category · email · label · is_active · created_by_admin_id · created_at/updated_at

---

## 12. Automations & Campaigns

### `email_automations` — 10 fixed system-triggered email types (config only)
id 🔑 · event_key varchar(64) ⭐ · label · enabled · subject, body · reminder_days_before · updated_at

### `automation_executions` — **NEW this session**, real execution log
id 🔑 · event_key · recipient_email · status (success/failed/skipped) · error_message · duration_ms · fired_at

### `campaigns` — bulk newsletter campaigns
id 🔑 · subject · from_name/email · audience_status, audience_source, audience_group_id 🔗→contact_groups (SET NULL) · body, body_format · status (default 'Draft') · sent_at · recipient_count · created_at/updated_at

### `campaign_sends`
id 🔑 · campaign_id 🔗→campaigns (CASCADE) · contact_id 🔗→newsletter_contacts (SET NULL) · email · token ⭐ · status (default 'sent') · error_message · sent_at · opened_at, open_count · unsubscribed_at · clicked_at, click_count

### `campaign_link_targets`
id 🔑 · send_id 🔗→campaign_sends (CASCADE) · link_id ⭐ · destination_url · click_count · created_at

---

## 13. Analytics

### `analytics_sessions`
id varchar(36) 🔑 · entry_page, referrer, user_agent · first_seen, last_seen

### `analytics_events`
id 🔑 · session_id 🔗→analytics_sessions (CASCADE) · event_type · page · label · created_at

---

## 14. Settings

### `settings` — generic key/value store
setting_key varchar(64) 🔑 · setting_value text · updated_at

---

## Columns added this session (2026-08-27 – 2026-09-04)

| Table | Column | Purpose |
|---|---|---|
| `license_products` | `duration_days` | Admin-set license length (30/60/90/180/365 days) |
| `purchases` | `license_duration_days` | Snapshot of intended length at purchase time |
| `quote_requests` | `expiring_reminder_sent_at` | Dedup flag for the 7-day quote-expiry reminder |
| *(new table)* `automation_executions` | — | Real execution log for every automated email send |
| *(new table)* `student_quiz_drafts` | — | Partial quiz-progress save, separate from the write-once `student_quiz_responses` |

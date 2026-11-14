# Database schema

**120 tables, 1132 columns.** Generated 2026-11-14 from the live production database (fixernat_fixernation), dumped by dump-schema.js on 2026-11-14, by `server/scripts/schema-to-md.js`. Structure only: no data.

> **To refresh from production:** on cPanel run `node scripts/dump-schema.js > /home/fixernat/schema-live.sql` (nodevenv active, from the `server` folder), download the file, then run `node scripts/schema-to-md.js schema-live.sql ../SCHEMA.md --source "the live database"`. Update this file whenever a schema change ships.

`server/db/schema.sql` is the source for fresh installs but is **not complete**: many tables and columns arrived only through one-off `server/scripts/alter-*.js` scripts. This file shows the result of all of them.

## Contents

- **Users, licensing, sales, CRM and email** (37): [admin_invite_tokens](#admin_invite_tokens), [admin_users](#admin_users), [affiliate_applications](#affiliate_applications), [affiliate_commissions](#affiliate_commissions), [affiliate_territories](#affiliate_territories), [affiliates](#affiliates), [campaign_audience_groups](#campaign_audience_groups), [campaign_link_targets](#campaign_link_targets), [campaign_sends](#campaign_sends), [campaign_series](#campaign_series), [campaign_series_groups](#campaign_series_groups), [campaigns](#campaigns), [contact_group_members](#contact_group_members), [contact_groups](#contact_groups), [district_branding](#district_branding), [district_license_admins](#district_license_admins), [districts](#districts), [email_automations](#email_automations), [invoices](#invoices), [license_products](#license_products), [license_seats](#license_seats), [license_utilization_alerts](#license_utilization_alerts), [newsletter_contacts](#newsletter_contacts), [purchases](#purchases), [quote_content_profiles](#quote_content_profiles), [quote_requests](#quote_requests), [school_admin_notifications](#school_admin_notifications), [school_audit_log](#school_audit_log), [school_branding](#school_branding), [school_invitations](#school_invitations), [school_license_admins](#school_license_admins), [schools](#schools), [settings](#settings), [site_user_audiences](#site_user_audiences), [site_user_tokens](#site_user_tokens), [site_users](#site_users), [trial_curriculum_accesses](#trial_curriculum_accesses)
- **Community, blog, support and release content** (22): [blog_post_categories](#blog_post_categories), [blog_post_favorites](#blog_post_favorites), [blog_post_tags](#blog_post_tags), [blog_posts](#blog_posts), [blog_tags](#blog_tags), [client_errors](#client_errors), [morning_boost_audio_clips](#morning_boost_audio_clips), [morning_boost_calendar](#morning_boost_calendar), [morning_boost_email_config](#morning_boost_email_config), [morning_boost_email_groups](#morning_boost_email_groups), [morning_boost_send_recipients](#morning_boost_send_recipients), [morning_boost_sends](#morning_boost_sends), [social_comments](#social_comments), [social_group_members](#social_group_members), [social_group_reads](#social_group_reads), [social_groups](#social_groups), [social_messages](#social_messages), [social_posts](#social_posts), [social_profiles](#social_profiles), [social_reactions](#social_reactions), [support_request_messages](#support_request_messages), [support_requests](#support_requests)
- **Curriculum, classrooms, students and parents** (22): [classroom_assignments](#classroom_assignments), [classroom_students](#classroom_students), [classrooms](#classrooms), [curricula](#curricula), [curriculum_audiences](#curriculum_audiences), [curriculum_downloads](#curriculum_downloads), [curriculum_materials](#curriculum_materials), [curriculum_objectives](#curriculum_objectives), [curriculum_quiz_options](#curriculum_quiz_options), [curriculum_quiz_questions](#curriculum_quiz_questions), [curriculum_resources](#curriculum_resources), [curriculum_videos](#curriculum_videos), [lesson_favorites](#lesson_favorites), [parent_classroom_links](#parent_classroom_links), [parent_student_invitations](#parent_student_invitations), [student_goals](#student_goals), [student_lesson_progress](#student_lesson_progress), [student_quiz_drafts](#student_quiz_drafts), [student_quiz_responses](#student_quiz_responses), [student_reflections](#student_reflections), [teacher_lesson_plan_swaps](#teacher_lesson_plan_swaps), [teacher_lesson_plans](#teacher_lesson_plans)
- **Games, learning and standards** (22): [brain_badges](#brain_badges), [brain_game_privacy](#brain_game_privacy), [brain_game_sessions](#brain_game_sessions), [brain_game_user_progress](#brain_game_user_progress), [brain_games](#brain_games), [brain_user_streaks](#brain_user_streaks), [classroom_game_assignments](#classroom_game_assignments), [feature_flag_schools](#feature_flag_schools), [feature_flags](#feature_flags), [game_favorites](#game_favorites), [learning_events](#learning_events), [pog_evidence_snapshots](#pog_evidence_snapshots), [program_use_snapshots](#program_use_snapshots), [skill_prerequisites](#skill_prerequisites), [skills](#skills), [standards_alignments](#standards_alignments), [standards_frameworks](#standards_frameworks), [standards_items](#standards_items), [standards_state_coverage](#standards_state_coverage), [student_game_completions](#student_game_completions), [student_portrait_pins](#student_portrait_pins), [user_brain_badges](#user_brain_badges)
- **Demo (shared prospect demo)** (3): [public_demo_events](#public_demo_events), [public_demo_invitations](#public_demo_invitations), [public_demo_workspaces](#public_demo_workspaces)
- **Settings, analytics, content safety and everything else** (14): [analytics_events](#analytics_events), [analytics_sessions](#analytics_sessions), [automation_executions](#automation_executions), [book_tags](#book_tags), [books](#books), [safety_alert_recipients](#safety_alert_recipients), [safety_alerts](#safety_alerts), [safety_findings](#safety_findings), [safety_incidents](#safety_incidents), [safety_rules](#safety_rules), [safety_scans](#safety_scans), [safety_terms](#safety_terms), [territories](#territories), [territory_requests](#territory_requests)

## Users, licensing, sales, CRM and email

### admin_invite_tokens

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `admin_id` | int(10) unsigned | no |  |  |
| `token` | varchar(128) | no |  |  |
| `expires_at` | datetime | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `token`: token
- Index `admin_id`: admin_id
- **Foreign keys:** `admin_id` references `admin_users`(id) on delete cascade

### admin_users

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `username` | varchar(64) | no |  |  |
| `password_hash` | varchar(255) | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `email` | varchar(255) | yes | NULL |  |
| `email_verified` | tinyint(1) | no | 1 |  |
| `session_invalidated_at` | datetime | yes | NULL |  |

- **Primary key:** id
- **Unique** `username`: username
- **Unique** `email`: email

### affiliate_applications

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `first_name` | varchar(100) | no |  |  |
| `last_name` | varchar(100) | no |  |  |
| `email` | varchar(255) | no |  |  |
| `company` | varchar(255) | yes | NULL |  |
| `phone` | varchar(30) | yes | NULL |  |
| `requested_territory` | varchar(100) | yes | NULL |  |
| `requested_territory_state` | char(2) | yes | NULL |  |
| `requested_territory_county` | varchar(100) | yes | NULL |  |
| `pitch` | text | yes | NULL |  |
| `status` | varchar(16) | no | pending |  |
| `reviewed_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `reviewed_at` | datetime | yes | NULL |  |
| `rejection_reason` | varchar(500) | yes | NULL |  |
| `resulting_site_user_id` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_status_created`: status, created_at
- Index `idx_email`: email
- Index `reviewed_by_admin_id`: reviewed_by_admin_id
- Index `resulting_site_user_id`: resulting_site_user_id
- **Foreign keys:** `reviewed_by_admin_id` references `admin_users`(id) on delete set null; `resulting_site_user_id` references `site_users`(id) on delete set null

### affiliate_commissions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `affiliate_id` | int(10) unsigned | no |  |  |
| `purchase_id` | int(10) unsigned | yes | NULL |  |
| `status` | varchar(16) | no | pending |  |
| `source_type` | varchar(16) | no | referral |  |
| `description` | varchar(300) | yes | NULL |  |
| `gross_amount_cents` | int(10) unsigned | yes | NULL |  |
| `commission_rate` | decimal(5,2) | yes | NULL |  |
| `commission_cents` | int(11) | no |  |  |
| `approved_at` | datetime | yes | NULL |  |
| `approved_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `paid_at` | datetime | yes | NULL |  |
| `payout_reference` | varchar(64) | yes | NULL |  |
| `reversed_at` | datetime | yes | NULL |  |
| `reversed_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `reversal_reason` | varchar(500) | yes | NULL |  |
| `notes` | varchar(1000) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- Index `idx_affiliate_status`: affiliate_id, status
- Index `idx_status_created`: status, created_at
- Index `idx_purchase`: purchase_id
- Index `approved_by_admin_id`: approved_by_admin_id
- Index `reversed_by_admin_id`: reversed_by_admin_id
- **Foreign keys:** `affiliate_id` references `affiliates`(id) on delete cascade; `purchase_id` references `purchases`(id) on delete set null; `approved_by_admin_id` references `admin_users`(id) on delete set null; `reversed_by_admin_id` references `admin_users`(id) on delete set null

### affiliate_territories

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `affiliate_id` | int(10) unsigned | no |  |  |
| `territory_id` | int(10) unsigned | no |  |  |
| `status` | varchar(16) | no | active |  |
| `assigned_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `revoked_at` | datetime | yes | NULL |  |
| `revoked_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `notes` | varchar(500) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_affiliate_status`: affiliate_id, status
- Index `idx_territory_status`: territory_id, status
- Index `assigned_by_admin_id`: assigned_by_admin_id
- Index `revoked_by_admin_id`: revoked_by_admin_id
- **Foreign keys:** `affiliate_id` references `affiliates`(id) on delete cascade; `territory_id` references `territories`(id) on delete cascade; `assigned_by_admin_id` references `admin_users`(id) on delete set null; `revoked_by_admin_id` references `admin_users`(id) on delete set null

### affiliates

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `site_user_id` | int(10) unsigned | no |  |  |
| `application_id` | int(10) unsigned | yes | NULL |  |
| `referral_code` | varchar(32) | no |  |  |
| `commission_rate` | decimal(5,2) | no |  |  |
| `status` | varchar(16) | no | active |  |
| `approved_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `approved_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `site_user_id`: site_user_id
- **Unique** `referral_code`: referral_code
- Index `idx_territory_status`: status
- Index `application_id`: application_id
- Index `approved_by_admin_id`: approved_by_admin_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `application_id` references `affiliate_applications`(id) on delete set null; `approved_by_admin_id` references `admin_users`(id) on delete set null

### campaign_audience_groups

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `campaign_id` | int(10) unsigned | no |  |  |
| `group_id` | int(10) unsigned | no |  |  |

- **Primary key:** campaign_id, group_id
- Index `group_id`: group_id
- **Foreign keys:** `campaign_id` references `campaigns`(id) on delete cascade; `group_id` references `contact_groups`(id) on delete cascade

### campaign_link_targets

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `send_id` | int(10) unsigned | no |  |  |
| `link_id` | varchar(32) | no |  |  |
| `destination_url` | varchar(2048) | no |  |  |
| `click_count` | int(10) unsigned | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `link_id`: link_id
- Index `send_id`: send_id
- **Foreign keys:** `send_id` references `campaign_sends`(id) on delete cascade

### campaign_sends

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `campaign_id` | int(10) unsigned | no |  |  |
| `contact_id` | int(10) unsigned | yes | NULL |  |
| `email` | varchar(255) | no |  |  |
| `token` | varchar(64) | no |  |  |
| `status` | varchar(16) | no | sent |  |
| `error_message` | varchar(500) | yes | NULL |  |
| `sent_at` | datetime | no | current_timestamp() |  |
| `opened_at` | datetime | yes | NULL |  |
| `open_count` | int(10) unsigned | no | 0 |  |
| `unsubscribed_at` | datetime | yes | NULL |  |
| `clicked_at` | datetime | yes | NULL |  |
| `click_count` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- **Unique** `token`: token
- Index `campaign_id`: campaign_id
- Index `contact_id`: contact_id
- **Foreign keys:** `campaign_id` references `campaigns`(id) on delete cascade; `contact_id` references `newsletter_contacts`(id) on delete set null

### campaign_series

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `subject` | varchar(255) | no |  |  |
| `from_name` | varchar(255) | no | Fixer Nation |  |
| `from_email` | varchar(255) | no |  |  |
| `audience_status` | varchar(32) | no | Subscribed |  |
| `audience_source` | varchar(128) | no | All |  |
| `body` | mediumtext | yes | NULL |  |
| `body_format` | varchar(16) | no | text |  |
| `recurrence_type` | varchar(16) | no |  |  |
| `recurrence_day_of_week` | tinyint(3) unsigned | yes | NULL |  |
| `recurrence_day_of_month` | tinyint(3) unsigned | yes | NULL |  |
| `send_time` | time | no | 09:00:00 |  |
| `send_timezone` | varchar(64) | no | America/New_York |  |
| `is_active` | tinyint(1) | no | 1 |  |
| `next_fire_at` | datetime | yes | NULL |  |
| `last_fired_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- Index `idx_active_next_fire`: is_active, next_fire_at

### campaign_series_groups

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `series_id` | int(10) unsigned | no |  |  |
| `group_id` | int(10) unsigned | no |  |  |

- **Primary key:** series_id, group_id
- Index `group_id`: group_id
- **Foreign keys:** `series_id` references `campaign_series`(id) on delete cascade; `group_id` references `contact_groups`(id) on delete cascade

### campaigns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `subject` | varchar(255) | no |  |  |
| `from_name` | varchar(255) | no | Fixer Nation |  |
| `from_email` | varchar(255) | no | hello@fixernation.org |  |
| `audience_status` | varchar(32) | no | Subscribed |  |
| `audience_source` | varchar(128) | no | All |  |
| `audience_group_id` | int(10) unsigned | yes | NULL |  |
| `series_id` | int(10) unsigned | yes | NULL |  |
| `body` | mediumtext | yes | NULL |  |
| `body_format` | varchar(16) | no | text |  |
| `status` | varchar(16) | no | Draft |  |
| `scheduled_for` | datetime | yes | NULL |  |
| `next_batch_at` | datetime | yes | NULL |  |
| `sent_at` | datetime | yes | NULL |  |
| `recipient_count` | int(10) unsigned | yes | NULL |  |
| `total_recipients_at_send` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- Index `audience_group_id`: audience_group_id
- Index `campaigns_series_fk`: series_id
- **Foreign keys:** `audience_group_id` references `contact_groups`(id) on delete set null; `series_id` references `campaign_series`(id) on delete set null

### contact_group_members

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `contact_id` | int(10) unsigned | no |  |  |
| `group_id` | int(10) unsigned | no |  |  |

- **Primary key:** contact_id, group_id
- Index `group_id`: group_id
- **Foreign keys:** `contact_id` references `newsletter_contacts`(id) on delete cascade; `group_id` references `contact_groups`(id) on delete cascade

### contact_groups

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(128) | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `system_key` | varchar(50) | yes | NULL |  |

- **Primary key:** id
- **Unique** `name`: name
- **Unique** `idx_system_key`: system_key

### district_branding

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `district_id` | int(10) unsigned | no |  |  |
| `draft_logo_original_url` | varchar(500) | yes | NULL |  |
| `draft_logo_display_url` | varchar(500) | yes | NULL |  |
| `draft_primary_color` | varchar(7) | yes | NULL |  |
| `draft_secondary_color` | varchar(7) | yes | NULL |  |
| `draft_accent_color` | varchar(7) | yes | NULL |  |
| `published_logo_original_url` | varchar(500) | yes | NULL |  |
| `published_logo_display_url` | varchar(500) | yes | NULL |  |
| `published_primary_color` | varchar(7) | yes | NULL |  |
| `published_secondary_color` | varchar(7) | yes | NULL |  |
| `published_accent_color` | varchar(7) | yes | NULL |  |
| `branding_status` | enum('DEFAULT','DRAFT','PUBLISHED') | no | DEFAULT |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `updated_by` | int(10) unsigned | yes | NULL |  |
| `published_at` | datetime | yes | NULL |  |
| `draft_logo_crop` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`draft_logo_crop`)) |  |
| `published_logo_crop` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`published_logo_crop`)) |  |

- **Primary key:** district_id
- Index `fk_district_branding_updated_by`: updated_by
- **Foreign keys:** `district_id` references `districts`(id) on delete cascade; `updated_by` references `site_users`(id) on delete set null

### district_license_admins

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `site_user_id` | int(10) unsigned | no |  |  |
| `district_id` | int(10) unsigned | no |  |  |
| `is_active` | tinyint(1) | no | 1 |  |
| `created_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `notes` | varchar(500) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `uniq_user_district`: site_user_id, district_id
- Index `district_id`: district_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `district_id` references `districts`(id) on delete cascade

### districts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(255) | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id

### email_automations

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `event_key` | varchar(64) | no |  |  |
| `label` | varchar(255) | no |  |  |
| `enabled` | tinyint(1) | no | 1 |  |
| `subject` | varchar(255) | no |  |  |
| `body` | text | no |  |  |
| `reminder_days_before` | int(10) unsigned | yes | NULL |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `event_key`: event_key

### invoices

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `invoice_number` | varchar(32) | yes | NULL |  |
| `contact_id` | int(10) unsigned | no |  |  |
| `po_number` | varchar(128) | yes | NULL |  |
| `po_received_date` | datetime | yes | NULL |  |
| `total_cents` | int(10) unsigned | no | 0 |  |
| `status` | varchar(16) | no | unpaid |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `paid_at` | datetime | yes | NULL |  |
| `bill_to_name` | varchar(255) | yes | NULL |  |
| `bill_to_company` | varchar(255) | yes | NULL |  |
| `bill_to_email` | varchar(255) | yes | NULL |  |
| `bill_to_street` | varchar(255) | yes | NULL |  |
| `bill_to_city` | varchar(128) | yes | NULL |  |
| `bill_to_state` | varchar(64) | yes | NULL |  |
| `bill_to_zip` | varchar(32) | yes | NULL |  |
| `bill_to_saved_at` | datetime | yes | NULL |  |
| `ship_to_name` | varchar(255) | yes | NULL |  |
| `ship_to_company` | varchar(255) | yes | NULL |  |
| `ship_to_street` | varchar(255) | yes | NULL |  |
| `ship_to_city` | varchar(128) | yes | NULL |  |
| `ship_to_state` | varchar(64) | yes | NULL |  |
| `ship_to_zip` | varchar(32) | yes | NULL |  |

- **Primary key:** id
- **Unique** `invoice_number`: invoice_number
- Index `contact_id`: contact_id
- **Foreign keys:** `contact_id` references `newsletter_contacts`(id) on delete cascade

### license_products

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(255) | no |  |  |
| `description` | varchar(500) | yes | NULL |  |
| `seat_count` | int(10) unsigned | no |  |  |
| `price_cents` | int(10) unsigned | no |  |  |
| `sort_order` | int(10) unsigned | no | 0 |  |
| `active` | tinyint(1) | no | 1 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `call_for_quote` | tinyint(1) | no | 0 |  |
| `auto_assign_group_id` | int(10) unsigned | yes | NULL |  |
| `bullet_points` | text | yes | NULL |  |
| `footer_note` | varchar(255) | yes | NULL |  |
| `variable_seats` | tinyint(1) | no | 0 |  |
| `is_trial` | tinyint(1) | no | 0 |  |
| `trial_days` | int(10) unsigned | yes | NULL |  |
| `trial_lesson_limit` | int(10) unsigned | yes | NULL |  |
| `trial_library_limit` | int(10) unsigned | yes | NULL |  |
| `duration_days` | int(10) unsigned | yes | NULL |  |
| `addon_rate_cents` | int(10) unsigned | yes | NULL |  |

- **Primary key:** id

### license_seats

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `purchase_id` | int(10) unsigned | no |  |  |
| `invited_email` | varchar(255) | yes | NULL |  |
| `status` | varchar(16) | no | pending |  |
| `inactive_reason` | varchar(32) | yes | NULL |  |
| `registered_site_user_id` | int(10) unsigned | yes | NULL |  |
| `registered_at` | datetime | yes | NULL |  |
| `invitation_id` | int(10) unsigned | yes | NULL |  |
| `revoked_at` | datetime | yes | NULL |  |
| `revoked_by` | int(10) unsigned | yes | NULL |  |
| `revocation_reason` | varchar(255) | yes | NULL |  |
| `notes` | varchar(500) | yes | NULL |  |

- **Primary key:** id
- Index `purchase_id`: purchase_id
- Index `registered_site_user_id`: registered_site_user_id
- **Foreign keys:** `purchase_id` references `purchases`(id) on delete cascade; `registered_site_user_id` references `site_users`(id) on delete set null

### license_utilization_alerts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `purchase_id` | int(10) unsigned | no |  |  |
| `threshold_pct` | int(10) unsigned | no |  |  |
| `sent_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_purchase_threshold`: purchase_id, threshold_pct, sent_at

### newsletter_contacts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(255) | yes | NULL |  |
| `email` | varchar(255) | no |  |  |
| `street` | varchar(255) | yes | NULL |  |
| `city` | varchar(128) | yes | NULL |  |
| `state` | varchar(64) | yes | NULL |  |
| `zip` | varchar(16) | yes | NULL |  |
| `signup_date` | datetime | no | current_timestamp() |  |
| `source` | varchar(128) | no | Homepage |  |
| `status` | varchar(32) | no | Subscribed |  |
| `phone` | varchar(32) | yes | NULL |  |
| `company` | varchar(255) | yes | NULL |  |
| `notes` | text | yes | NULL |  |
| `morning_boost_unsubscribed_at` | datetime | yes | NULL |  |
| `ship_to_name` | varchar(255) | yes | NULL |  |
| `ship_to_company` | varchar(255) | yes | NULL |  |
| `ship_to_street` | varchar(255) | yes | NULL |  |
| `ship_to_city` | varchar(128) | yes | NULL |  |
| `ship_to_state` | varchar(64) | yes | NULL |  |
| `ship_to_zip` | varchar(32) | yes | NULL |  |

- **Primary key:** id
- **Unique** `email`: email

### purchases

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `contact_id` | int(10) unsigned | no |  |  |
| `product_type` | varchar(32) | no |  |  |
| `book_id` | int(10) unsigned | yes | NULL |  |
| `seat_count` | int(10) unsigned | yes | NULL |  |
| `purchased_at` | datetime | no | current_timestamp() |  |
| `source` | varchar(64) | no | Manual Entry |  |
| `notes` | varchar(500) | yes | NULL |  |
| `stripe_session_id` | varchar(255) | yes | NULL |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `school_id` | int(10) unsigned | yes | NULL |  |
| `license_product_id` | int(10) unsigned | yes | NULL |  |
| `payment_method` | varchar(16) | no | manual |  |
| `payment_status` | varchar(16) | no | paid |  |
| `license_status` | varchar(16) | no | active |  |
| `effective_date` | date | yes | NULL |  |
| `expiration_date` | date | yes | NULL |  |
| `license_duration_days` | int(10) unsigned | yes | NULL |  |
| `affiliate_id` | int(10) unsigned | yes | NULL |  |
| `affiliate_commission_cents` | int(10) unsigned | yes | NULL |  |
| `trial_expiration_date` | datetime | yes | NULL |  |
| `trial_lesson_limit` | int(10) unsigned | yes | NULL |  |
| `trial_library_limit` | int(10) unsigned | yes | NULL |  |
| `conversion_credit_cents` | int(10) unsigned | yes | NULL |  |
| `conversion_credit_redeemed_at` | datetime | yes | NULL |  |
| `converted_to_purchase_id` | int(10) unsigned | yes | NULL |  |
| `quote_id` | int(10) unsigned | yes | NULL |  |
| `renewal_reminder_sent_at` | datetime | yes | NULL |  |
| `po_number` | varchar(128) | yes | NULL |  |
| `invoice_id` | int(10) unsigned | yes | NULL |  |
| `amount_cents` | int(10) unsigned | yes | NULL |  |
| `stripe_invoice_id` | varchar(255) | yes | NULL |  |

- **Primary key:** id
- **Unique** `stripe_invoice_id`: stripe_invoice_id
- Index `contact_id`: contact_id
- Index `book_id`: book_id
- Index `license_product_id`: license_product_id
- Index `invoice_id`: invoice_id
- Index `fk_purchases_school_id`: school_id
- Index `affiliate_id`: affiliate_id
- **Foreign keys:** `school_id` references `schools`(id) on delete set null; `contact_id` references `newsletter_contacts`(id) on delete cascade; `book_id` references `books`(id) on delete set null; `license_product_id` references `license_products`(id) on delete set null; `invoice_id` references `invoices`(id) on delete set null; `affiliate_id` references `affiliates`(id) on delete set null

### quote_content_profiles

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(120) | no |  |  |
| `section_annual_includes` | text | yes | NULL |  |
| `section_lesson_package` | text | yes | NULL |  |
| `section_video_access` | text | yes | NULL |  |
| `section_license_terms` | text | yes | NULL |  |
| `is_default` | tinyint(1) | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `name`: name

### quote_requests

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `quote_number` | varchar(6) | yes | NULL |  |
| `quote_valid_until` | date | yes | NULL |  |
| `expiring_reminder_sent_at` | datetime | yes | NULL |  |
| `accept_token` | varchar(64) | yes | NULL |  |
| `accepted_at` | datetime | yes | NULL |  |
| `accepted_payment_method` | varchar(8) | yes | NULL |  |
| `first_name` | varchar(100) | yes | NULL |  |
| `last_name` | varchar(100) | yes | NULL |  |
| `email` | varchar(255) | no |  |  |
| `school` | varchar(255) | yes | NULL |  |
| `quoted_school_domain` | varchar(255) | yes | NULL |  |
| `content_profile_id` | int(10) unsigned | yes | NULL |  |
| `origin` | varchar(10) | no | inbound |  |
| `phone` | varchar(64) | yes | NULL |  |
| `message` | text | yes | NULL |  |
| `status` | enum('new','contacted','converted','closed') | no | new |  |
| `notes` | text | yes | NULL |  |
| `quoted_product_id` | int(10) unsigned | yes | NULL |  |
| `quoted_product_name` | varchar(255) | yes | NULL |  |
| `quoted_seat_count` | int(10) unsigned | yes | NULL |  |
| `quoted_amount_cents` | int(10) unsigned | yes | NULL |  |
| `quoted_at` | datetime | yes | NULL |  |
| `quote_sent_at` | datetime | yes | NULL |  |
| `quote_sent_via` | enum('email','phone') | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `quoted_tier_name` | varchar(100) | yes | NULL |  |
| `quoted_addon_seats` | tinyint(3) unsigned | yes | NULL |  |
| `quoted_proration_factor` | decimal(3,2) | yes | NULL |  |
| `quoted_term_years` | tinyint(3) unsigned | yes | NULL |  |
| `admin_invited_at` | datetime | yes | NULL |  |
| `bill_to_street` | varchar(255) | yes | NULL |  |
| `bill_to_city` | varchar(128) | yes | NULL |  |
| `bill_to_state` | varchar(64) | yes | NULL |  |
| `bill_to_zip` | varchar(32) | yes | NULL |  |
| `ship_to_name` | varchar(255) | yes | NULL |  |
| `ship_to_company` | varchar(255) | yes | NULL |  |
| `ship_to_street` | varchar(255) | yes | NULL |  |
| `ship_to_city` | varchar(128) | yes | NULL |  |
| `ship_to_state` | varchar(64) | yes | NULL |  |
| `ship_to_zip` | varchar(32) | yes | NULL |  |
| `demo_window` | int(10) unsigned | no | 0 |  |
| `demo_invitation_id` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- **Unique** `quote_number`: quote_number
- **Unique** `accept_token`: accept_token
- Index `fk_quote_requests_content_profile`: content_profile_id
- Index `idx_quote_requests_demo_invitation_id`: demo_invitation_id
- **Foreign keys:** `content_profile_id` references `quote_content_profiles`(id) on delete set null

### school_admin_notifications

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `school_domain` | varchar(255) | no |  |  |
| `reason` | varchar(64) | no |  |  |
| `teacher_email` | varchar(255) | no |  |  |
| `admin_contact_id` | int(10) unsigned | yes | NULL |  |
| `sent_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_domain_reason_sent`: school_domain, reason, sent_at

### school_audit_log

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `actor_type` | varchar(16) | no |  |  |
| `actor_id` | int(10) unsigned | yes | NULL |  |
| `actor_email` | varchar(255) | yes | NULL |  |
| `action` | varchar(64) | no |  |  |
| `entity_type` | varchar(32) | yes | NULL |  |
| `entity_id` | int(10) unsigned | yes | NULL |  |
| `purchase_id` | int(10) unsigned | yes | NULL |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `prev_value` | text | yes | NULL |  |
| `new_value` | text | yes | NULL |  |
| `reason` | varchar(255) | yes | NULL |  |
| `ip_address` | varchar(64) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_purchase`: purchase_id
- Index `idx_actor`: actor_type, actor_id
- Index `idx_entity`: entity_type, entity_id
- Index `idx_created`: created_at

### school_branding

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `school_id` | int(10) unsigned | no |  |  |
| `draft_logo_original_url` | varchar(500) | yes | NULL |  |
| `draft_logo_display_url` | varchar(500) | yes | NULL |  |
| `draft_primary_color` | varchar(7) | yes | NULL |  |
| `draft_secondary_color` | varchar(7) | yes | NULL |  |
| `draft_accent_color` | varchar(7) | yes | NULL |  |
| `published_logo_original_url` | varchar(500) | yes | NULL |  |
| `published_logo_display_url` | varchar(500) | yes | NULL |  |
| `published_primary_color` | varchar(7) | yes | NULL |  |
| `published_secondary_color` | varchar(7) | yes | NULL |  |
| `published_accent_color` | varchar(7) | yes | NULL |  |
| `branding_status` | enum('DEFAULT','DRAFT','PUBLISHED') | no | DEFAULT |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `updated_by` | int(10) unsigned | yes | NULL |  |
| `published_at` | datetime | yes | NULL |  |
| `draft_logo_crop` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`draft_logo_crop`)) |  |
| `published_logo_crop` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`published_logo_crop`)) |  |

- **Primary key:** school_id
- Index `fk_school_branding_updated_by`: updated_by
- **Foreign keys:** `school_id` references `schools`(id) on delete cascade; `updated_by` references `site_users`(id) on delete set null

### school_invitations

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `purchase_id` | int(10) unsigned | no |  |  |
| `seat_id` | int(10) unsigned | yes | NULL |  |
| `invited_email` | varchar(255) | no |  |  |
| `first_name` | varchar(100) | yes | NULL |  |
| `last_name` | varchar(100) | yes | NULL |  |
| `token` | varchar(128) | no |  |  |
| `status` | varchar(16) | no | pending |  |
| `grade_level` | varchar(64) | yes | NULL |  |
| `audiences` | varchar(255) | yes | NULL |  |
| `role_title` | varchar(128) | yes | NULL |  |
| `department` | varchar(128) | yes | NULL |  |
| `subject_area` | varchar(128) | yes | NULL |  |
| `personal_message` | text | yes | NULL |  |
| `invited_by_site_user_id` | int(10) unsigned | yes | NULL |  |
| `expires_at` | datetime | no |  |  |
| `resend_count` | int(10) unsigned | no | 0 |  |
| `last_resent_at` | datetime | yes | NULL |  |
| `revoked_at` | datetime | yes | NULL |  |
| `revoked_by_site_user_id` | int(10) unsigned | yes | NULL |  |
| `revocation_reason` | varchar(255) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `token`: token
- Index `idx_token`: token
- Index `idx_purchase`: purchase_id
- Index `idx_email`: invited_email
- Index `idx_status`: status
- Index `seat_id`: seat_id
- **Foreign keys:** `purchase_id` references `purchases`(id) on delete cascade; `seat_id` references `license_seats`(id) on delete set null

### school_license_admins

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `site_user_id` | int(10) unsigned | no |  |  |
| `purchase_id` | int(10) unsigned | no |  |  |
| `permission_level` | varchar(16) | no | primary |  |
| `is_active` | tinyint(1) | no | 1 |  |
| `created_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `notes` | varchar(500) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `uniq_user_purchase`: site_user_id, purchase_id
- Index `purchase_id`: purchase_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `purchase_id` references `purchases`(id) on delete cascade

### schools

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `domain` | varchar(255) | no |  |  |
| `district_id` | int(10) unsigned | yes | NULL |  |
| `display_name` | varchar(255) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `domain`: domain
- Index `fk_schools_district_id`: district_id
- **Foreign keys:** `district_id` references `districts`(id) on delete set null

### settings

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `setting_key` | varchar(64) | no |  |  |
| `setting_value` | text | no |  |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** setting_key

### site_user_audiences

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `site_user_id` | int(10) unsigned | no |  |  |
| `audience` | varchar(64) | no |  |  |

- **Primary key:** id
- **Unique** `uniq_user_audience`: site_user_id, audience
- Index `idx_site_user`: site_user_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade

### site_user_tokens

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | no |  |  |
| `token` | varchar(128) | no |  |  |
| `type` | varchar(20) | no |  |  |
| `expires_at` | datetime | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `token`: token
- Index `user_id`: user_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade

### site_users

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `first_name` | varchar(100) | no |  |  |
| `last_name` | varchar(100) | no |  |  |
| `email` | varchar(255) | no |  |  |
| `password_hash` | varchar(255) | yes | NULL |  |
| `microsoft_oid` | varchar(255) | yes | NULL |  |
| `email_verified` | tinyint(1) | no | 0 |  |
| `role` | varchar(32) | no | teacher |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `session_invalidated_at` | datetime | yes | NULL |  |
| `is_sales_demo` | tinyint(1) | no | 0 |  |
| `is_fne_staff` | tinyint(1) | no | 0 |  |
| `closed_at` | datetime | yes | NULL |  |
| `closed_reason` | varchar(64) | yes | NULL |  |
| `is_shared_demo` | tinyint(1) | no | 0 |  |
| `demo_workspace_id` | int(11) | yes | NULL |  |

- **Primary key:** id
- **Unique** `email`: email
- **Unique** `microsoft_oid`: microsoft_oid
- Index `idx_site_users_demo_workspace`: demo_workspace_id

### trial_curriculum_accesses

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `purchase_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `first_accessed_at` | datetime | no | current_timestamp() |  |

- **Primary key:** purchase_id, curriculum_id
- **Foreign keys:** `purchase_id` references `purchases`(id) on delete cascade

## Community, blog, support and release content

### blog_post_categories

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `post_id` | int(10) unsigned | no |  |  |
| `category` | varchar(64) | no |  |  |

- **Primary key:** id
- Index `post_id`: post_id
- **Foreign keys:** `post_id` references `blog_posts`(id) on delete cascade

### blog_post_favorites

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `site_user_id` | int(10) unsigned | no |  |  |
| `post_id` | int(10) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** site_user_id, post_id
- Index `idx_blog_fav_post`: post_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `post_id` references `blog_posts`(id) on delete cascade

### blog_post_tags

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `post_id` | int(10) unsigned | no |  |  |
| `tag` | varchar(128) | no |  |  |

- **Primary key:** id
- Index `post_id`: post_id
- **Foreign keys:** `post_id` references `blog_posts`(id) on delete cascade

### blog_posts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `title` | varchar(255) | no |  |  |
| `theme` | varchar(255) | yes | NULL |  |
| `series` | varchar(255) | yes | NULL |  |
| `slug` | varchar(255) | no |  |  |
| `author` | varchar(255) | yes | NULL |  |
| `category` | varchar(64) | no |  |  |
| `featured_image` | varchar(512) | yes | NULL |  |
| `excerpt` | text | yes | NULL |  |
| `body` | mediumtext | yes | NULL |  |
| `video_url` | varchar(512) | yes | NULL |  |
| `video_file_name` | varchar(255) | yes | NULL |  |
| `video_file_size_label` | varchar(128) | yes | NULL |  |
| `publish_date` | date | yes | NULL |  |
| `featured` | tinyint(1) | no | 0 |  |
| `published` | tinyint(1) | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `alt_text` | varchar(255) | yes | NULL |  |
| `meta_description` | varchar(500) | yes | NULL |  |
| `focus_keyword` | varchar(255) | yes | NULL |  |
| `requires_membership` | tinyint(1) | no | 0 |  |

- **Primary key:** id
- **Unique** `slug`: slug

### blog_tags

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `tag` | varchar(128) | no |  |  |

- **Primary key:** id
- **Unique** `tag`: tag

### client_errors

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `kind` | varchar(24) | no |  |  |
| `page_path` | varchar(200) | no |  |  |
| `api_path` | varchar(200) | no |  |  |
| `method` | varchar(8) | no |  |  |
| `http_status` | smallint(5) unsigned | no | 0 |  |
| `message` | varchar(300) | no |  |  |
| `source` | varchar(200) | no |  |  |
| `user_kind` | varchar(12) | no | visitor |  |
| `site_user_id` | int(10) unsigned | yes | NULL |  |
| `client_session_id` | varchar(64) | no |  |  |
| `user_agent` | varchar(300) | no |  |  |
| `occurrences` | int(10) unsigned | no | 1 |  |
| `first_seen` | datetime | no | current_timestamp() |  |
| `last_seen` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_last_seen`: last_seen
- Index `idx_kind`: kind, last_seen
- Index `idx_user`: site_user_id, last_seen
- Index `idx_session`: client_session_id, last_seen

### morning_boost_audio_clips

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(11) | no |  | auto increment |
| `filename` | varchar(255) | no |  |  |
| `script_text` | text | yes | NULL |  |
| `created_at` | timestamp | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `filename`: filename

### morning_boost_calendar

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `boost_date` | date | no |  |  |
| `theme` | varchar(255) | no |  |  |
| `series` | varchar(255) | no |  |  |
| `blog_post_id` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `boost_date`: boost_date
- Index `blog_post_id`: blog_post_id
- **Foreign keys:** `blog_post_id` references `blog_posts`(id) on delete set null

### morning_boost_email_config

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `enabled` | tinyint(1) | no | 0 |  |
| `send_time` | time | no | 07:00:00 |  |
| `send_timezone` | varchar(64) | no | America/New_York |  |
| `from_name` | varchar(255) | no | Fixer Nation |  |
| `from_email` | varchar(255) | no |  |  |
| `reply_to` | varchar(255) | yes | NULL |  |
| `subject` | varchar(255) | no | Morning Boost — {{title}} |  |
| `body` | text | no |  |  |
| `body_format` | varchar(8) | no | html |  |
| `cta_text` | varchar(255) | no | Read Today''s Morning Boost |  |
| `cta_url_override` | varchar(500) | yes | NULL |  |
| `fallback_message` | text | yes | NULL |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `updated_by` | int(10) unsigned | yes | NULL |  |

- **Primary key:** id

### morning_boost_email_groups

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `config_id` | int(10) unsigned | no |  |  |
| `group_id` | int(10) unsigned | no |  |  |

- **Primary key:** config_id, group_id
- Index `fk_mb_email_groups_group`: group_id
- **Foreign keys:** `group_id` references `contact_groups`(id) on delete cascade

### morning_boost_send_recipients

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `send_id` | int(10) unsigned | no |  |  |
| `contact_id` | int(10) unsigned | yes | NULL |  |
| `email` | varchar(255) | no |  |  |
| `status` | varchar(16) | no | pending |  |
| `error_message` | varchar(500) | yes | NULL |  |
| `sent_at` | datetime | yes | NULL |  |
| `open_token` | varchar(64) | yes | NULL |  |
| `opened_at` | datetime | yes | NULL |  |
| `click_token` | varchar(64) | yes | NULL |  |
| `clicked_at` | datetime | yes | NULL |  |

- **Primary key:** id
- **Unique** `open_token`: open_token
- **Unique** `click_token`: click_token
- Index `idx_send`: send_id

### morning_boost_sends

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `config_id` | int(10) unsigned | yes | NULL |  |
| `blog_post_id` | int(10) unsigned | yes | NULL |  |
| `boost_date` | date | no |  |  |
| `scheduled_for` | datetime | no |  |  |
| `sent_at` | datetime | yes | NULL |  |
| `status` | varchar(16) | no | pending |  |
| `subject` | varchar(255) | yes | NULL |  |
| `from_email` | varchar(255) | yes | NULL |  |
| `from_name` | varchar(255) | yes | NULL |  |
| `reply_to` | varchar(255) | yes | NULL |  |
| `cta_url` | varchar(500) | yes | NULL |  |
| `group_ids` | text | yes | NULL |  |
| `recipient_count` | int(10) unsigned | no | 0 |  |
| `sent_count` | int(10) unsigned | no | 0 |  |
| `failed_count` | int(10) unsigned | no | 0 |  |
| `skipped_count` | int(10) unsigned | no | 0 |  |
| `failure_reason` | text | yes | NULL |  |
| `is_resend` | tinyint(1) | no | 0 |  |
| `initiated_by` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_boost_date`: boost_date

### social_comments

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `post_id` | int(10) unsigned | no |  |  |
| `author_id` | int(10) unsigned | no |  |  |
| `content` | text | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `deleted_at` | datetime | yes | NULL |  |

- **Primary key:** id
- Index `idx_post`: post_id
- **Foreign keys:** `post_id` references `social_posts`(id) on delete cascade

### social_group_members

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `group_id` | int(10) unsigned | no |  |  |
| `user_id` | int(10) unsigned | no |  |  |
| `joined_at` | datetime | no | current_timestamp() |  |

- **Primary key:** group_id, user_id
- Index `idx_user`: user_id

### social_group_reads

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `group_id` | int(10) unsigned | no |  |  |
| `user_id` | int(10) unsigned | no |  |  |
| `last_read_at` | datetime | no | current_timestamp() |  |

- **Primary key:** group_id, user_id

### social_groups

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(255) | no |  |  |
| `type` | enum('all_teachers','school','membership','custom') | no | custom |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `description` | text | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `is_public` | tinyint(1) | no | 1 |  |

- **Primary key:** id
- Index `idx_type`: type
- Index `idx_school_domain`: school_domain

### social_messages

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `sender_id` | int(10) unsigned | no |  |  |
| `recipient_id` | int(10) unsigned | no |  |  |
| `content` | text | no |  |  |
| `attachments` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`attachments`)) |  |
| `read_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `deleted_at` | datetime | yes | NULL |  |

- **Primary key:** id
- Index `idx_thread`: sender_id, recipient_id, created_at
- Index `idx_recipient`: recipient_id, read_at

### social_posts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `group_id` | int(10) unsigned | no |  |  |
| `author_id` | int(10) unsigned | no |  |  |
| `content` | text | no |  |  |
| `attachments` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`attachments`)) |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `deleted_at` | datetime | yes | NULL |  |

- **Primary key:** id
- Index `idx_group_created`: group_id, created_at
- **Foreign keys:** `group_id` references `social_groups`(id) on delete cascade

### social_profiles

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `user_id` | int(10) unsigned | no |  |  |
| `bio` | text | yes | NULL |  |
| `bio_consent` | tinyint(1) | no | 0 |  |
| `avatar_url` | varchar(500) | yes | NULL |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** user_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade

### social_reactions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `post_id` | int(10) unsigned | no |  |  |
| `user_id` | int(10) unsigned | no |  |  |
| `reaction` | varchar(20) | no | like |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** post_id, user_id
- **Foreign keys:** `post_id` references `social_posts`(id) on delete cascade

### support_request_messages

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `request_id` | int(10) unsigned | no |  |  |
| `author_type` | varchar(16) | no |  |  |
| `author_admin_id` | int(10) unsigned | yes | NULL |  |
| `visibility` | varchar(16) | no | public |  |
| `body` | text | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_request`: request_id, created_at
- Index `author_admin_id`: author_admin_id
- **Foreign keys:** `request_id` references `support_requests`(id) on delete cascade; `author_admin_id` references `admin_users`(id) on delete set null

### support_requests

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `ref` | varchar(16) | no |  |  |
| `status` | varchar(24) | no | new |  |
| `category` | varchar(32) | no | other |  |
| `subject` | varchar(200) | no |  |  |
| `requester_name` | varchar(120) | no |  |  |
| `requester_email` | varchar(255) | no |  |  |
| `site_user_id` | int(10) unsigned | yes | NULL |  |
| `roles` | varchar(160) | yes | NULL |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `district_id` | int(10) unsigned | yes | NULL |  |
| `page_url` | varchar(500) | yes | NULL |  |
| `user_agent` | varchar(300) | yes | NULL |  |
| `assigned_admin_id` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `resolved_at` | datetime | yes | NULL |  |
| `requester_seen_message_id` | int(10) unsigned | no | 0 |  |
| `client_session_id` | varchar(64) | yes | NULL |  |
| `demo_window` | int(10) unsigned | no | 0 |  |
| `demo_invitation_id` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- **Unique** `ref`: ref
- Index `idx_status`: status, updated_at
- Index `idx_user`: site_user_id
- Index `idx_email`: requester_email
- Index `assigned_admin_id`: assigned_admin_id
- Index `idx_support_requests_demo_invitation_id`: demo_invitation_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete set null; `assigned_admin_id` references `admin_users`(id) on delete set null

## Curriculum, classrooms, students and parents

### classroom_assignments

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `classroom_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `assigned_by_id` | int(10) unsigned | no |  |  |
| `sort_order` | int(11) | no | 0 |  |
| `due_date` | date | yes | NULL |  |
| `assigned_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_classroom_curriculum`: classroom_id, curriculum_id
- Index `idx_classroom`: classroom_id
- **Foreign keys:** `classroom_id` references `classrooms`(id) on delete cascade

### classroom_students

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `classroom_id` | int(10) unsigned | no |  |  |
| `display_name` | varchar(100) | no |  |  |
| `username` | varchar(60) | no |  |  |
| `password_hash` | varchar(255) | no |  |  |
| `student_number` | varchar(50) | yes | NULL |  |
| `is_active` | tinyint(1) | no | 1 |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_username`: username
- Index `idx_classroom`: classroom_id
- **Foreign keys:** `classroom_id` references `classrooms`(id) on delete cascade

### classrooms

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(150) | no |  |  |
| `teacher_site_user_id` | int(10) unsigned | no |  |  |
| `purchase_id` | int(10) unsigned | yes | NULL |  |
| `join_code` | char(8) | no |  |  |
| `parent_code` | varchar(32) | yes | NULL |  |
| `grade_level` | varchar(60) | yes | NULL |  |
| `subject` | varchar(100) | yes | NULL |  |
| `academic_year` | varchar(20) | yes | NULL |  |
| `archived_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `keepsake_enabled` | tinyint(1) | no | 1 |  |

- **Primary key:** id
- **Unique** `uq_join_code`: join_code
- **Unique** `parent_code`: parent_code
- Index `idx_teacher`: teacher_site_user_id

### curricula

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `title` | varchar(255) | no |  |  |
| `series` | varchar(255) | yes | NULL |  |
| `short_description` | text | yes | NULL |  |
| `overview` | text | yes | NULL |  |
| `lesson_document` | varchar(255) | yes | NULL |  |
| `lesson_document_name` | varchar(255) | yes | NULL |  |
| `download_limit` | int(10) unsigned | no | 0 |  |
| `published` | tinyint(1) | no | 0 |  |
| `is_featured` | tinyint(1) | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `lessons_count` | int(10) unsigned | yes | NULL |  |
| `weeks_count` | int(10) unsigned | yes | NULL |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id

### curriculum_audiences

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `audience` | varchar(64) | no |  |  |

- **Primary key:** id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `curriculum_id` references `curricula`(id) on delete cascade

### curriculum_downloads

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `user_email` | varchar(255) | no |  |  |
| `user_type` | varchar(16) | no | teacher |  |
| `resource_type` | varchar(64) | no | any |  |
| `count` | int(10) unsigned | no | 0 |  |
| `last_download` | datetime | yes | NULL |  |

- **Primary key:** id
- **Unique** `uniq_resource_download`: curriculum_id, user_email, user_type, resource_type

### curriculum_materials

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `material` | text | no |  |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `curriculum_id` references `curricula`(id) on delete cascade

### curriculum_objectives

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `objective` | text | no |  |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `curriculum_id` references `curricula`(id) on delete cascade

### curriculum_quiz_options

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `question_id` | int(10) unsigned | no |  |  |
| `option_text` | text | no |  |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `question_id`: question_id
- **Foreign keys:** `question_id` references `curriculum_quiz_questions`(id) on delete cascade

### curriculum_quiz_questions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `question` | text | no |  |  |
| `correct_index` | int(10) unsigned | no | 0 |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `curriculum_id` references `curricula`(id) on delete cascade

### curriculum_resources

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `resource` | varchar(64) | no |  |  |
| `file_path` | varchar(512) | yes | NULL |  |
| `file_name` | varchar(255) | yes | NULL |  |
| `download_limit` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `curriculum_id` references `curricula`(id) on delete cascade

### curriculum_videos

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `name` | varchar(255) | no |  |  |
| `url` | varchar(512) | no |  |  |
| `size_label` | varchar(128) | yes | NULL |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `curriculum_id` references `curricula`(id) on delete cascade

### lesson_favorites

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `site_user_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** site_user_id, curriculum_id
- Index `idx_lesson_fav_curriculum`: curriculum_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `curriculum_id` references `curricula`(id) on delete cascade

### parent_classroom_links

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `site_user_id` | int(10) unsigned | no |  |  |
| `classroom_id` | int(10) unsigned | no |  |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `linked_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uniq_parent_classroom_student`: site_user_id, classroom_id, student_id
- Index `classroom_id`: classroom_id
- Index `student_id`: student_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `classroom_id` references `classrooms`(id) on delete cascade; `student_id` references `classroom_students`(id) on delete set null

### parent_student_invitations

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `classroom_id` | int(10) unsigned | no |  |  |
| `student_id` | int(10) unsigned | no |  |  |
| `invited_email` | varchar(255) | no |  |  |
| `invited_name` | varchar(150) | yes | NULL |  |
| `token` | varchar(128) | no |  |  |
| `status` | varchar(16) | no | pending |  |
| `invited_by_site_user_id` | int(10) unsigned | yes | NULL |  |
| `personal_message` | text | yes | NULL |  |
| `expires_at` | datetime | no |  |  |
| `revoked_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `token`: token
- Index `idx_classroom`: classroom_id
- Index `idx_student`: student_id
- **Foreign keys:** `classroom_id` references `classrooms`(id) on delete cascade; `student_id` references `classroom_students`(id) on delete cascade

### student_goals

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `goal_text` | text | no |  |  |
| `target_date` | date | yes | NULL |  |
| `is_achieved` | tinyint(1) | no | 0 |  |
| `achieved_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_student`: student_id
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade

### student_lesson_progress

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `started_at` | datetime | no | current_timestamp() |  |
| `completed_at` | datetime | yes | NULL |  |
| `last_activity_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `uq_student_curriculum`: student_id, curriculum_id
- Index `idx_student`: student_id
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade

### student_quiz_drafts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `question_id` | int(10) unsigned | no |  |  |
| `selected_option_index` | int(10) unsigned | no |  |  |
| `saved_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `uq_student_curriculum_question`: student_id, curriculum_id, question_id
- Index `idx_student_curriculum`: student_id, curriculum_id

### student_quiz_responses

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `question_id` | int(10) unsigned | no |  |  |
| `selected_option_index` | int(11) | no |  |  |
| `is_correct` | tinyint(1) | no |  |  |
| `submitted_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_student_question`: student_id, question_id
- Index `idx_student_curriculum`: student_id, curriculum_id
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade

### student_reflections

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `prompt_key` | varchar(60) | no |  |  |
| `response_text` | text | no |  |  |
| `submitted_at` | datetime | no | current_timestamp() |  |
| `teacher_seen_at` | datetime | yes | NULL |  |

- **Primary key:** id
- Index `idx_student_curriculum`: student_id, curriculum_id
- Index `idx_curriculum`: curriculum_id
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade

### teacher_lesson_plan_swaps

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `site_user_id` | int(10) unsigned | no |  |  |
| `removed_curriculum_id` | int(10) unsigned | no |  |  |
| `added_curriculum_id` | int(10) unsigned | yes | NULL |  |
| `swapped_at` | datetime | no | current_timestamp() |  |
| `voided_at` | datetime | yes | NULL |  |

- **Primary key:** id
- Index `idx_user_voided`: site_user_id, voided_at
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade

### teacher_lesson_plans

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `site_user_id` | int(10) unsigned | no |  |  |
| `curriculum_id` | int(10) unsigned | no |  |  |
| `selected_at` | datetime | no | current_timestamp() |  |

- **Primary key:** site_user_id, curriculum_id
- Index `curriculum_id`: curriculum_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `curriculum_id` references `curricula`(id) on delete cascade

## Games, learning and standards

### brain_badges

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(100) | no |  |  |
| `slug` | varchar(100) | no |  |  |
| `description` | text | yes | NULL |  |
| `game_id` | int(10) unsigned | yes | NULL |  |
| `category` | varchar(32) | no | achievement |  |
| `rarity` | varchar(16) | no | common |  |
| `criteria_type` | varchar(50) | no |  |  |
| `criteria_json` | text | no |  |  |
| `xp_reward` | int(10) unsigned | no | 50 |  |
| `emoji` | varchar(10) | yes | NULL |  |
| `active` | tinyint(1) | no | 1 |  |
| `publicly_displayable` | tinyint(1) | no | 1 |  |
| `display_order` | int(10) unsigned | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `slug`: slug
- Index `game_id`: game_id
- **Foreign keys:** `game_id` references `brain_games`(id) on delete set null

### brain_game_privacy

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | yes | NULL |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `show_activity` | tinyint(1) | no | 0 |  |
| `show_score` | tinyint(1) | no | 0 |  |
| `show_streaks` | tinyint(1) | no | 0 |  |
| `show_badges` | tinyint(1) | no | 1 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `user_id`: user_id
- **Unique** `uniq_student`: student_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade; `student_id` references `classroom_students`(id) on delete cascade

### brain_game_sessions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | yes | NULL |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `game_id` | int(10) unsigned | no |  |  |
| `session_token` | varchar(64) | no |  |  |
| `started_at` | datetime | no | current_timestamp() |  |
| `completed_at` | datetime | yes | NULL |  |
| `duration_ms` | int(10) unsigned | yes | NULL |  |
| `difficulty` | varchar(16) | no | medium |  |
| `raw_score` | int(10) unsigned | yes | NULL |  |
| `normalized_score` | int(10) unsigned | yes | NULL |  |
| `accuracy` | decimal(5,2) | yes | NULL |  |
| `status` | varchar(16) | no | started |  |
| `metrics_json` | text | yes | NULL |  |
| `scoring_version` | int(10) unsigned | no | 1 |  |
| `validation_status` | varchar(16) | no | valid |  |
| `leaderboard_eligible` | tinyint(1) | no | 1 |  |
| `xp_earned` | int(10) unsigned | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `session_token`: session_token
- Index `idx_user_game`: user_id, game_id
- Index `idx_user`: user_id
- Index `idx_token`: session_token
- Index `game_id`: game_id
- Index `idx_student_game`: student_id, game_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade; `game_id` references `brain_games`(id); `student_id` references `classroom_students`(id) on delete cascade

### brain_game_user_progress

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | yes | NULL |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `game_id` | int(10) unsigned | no |  |  |
| `level` | int(10) unsigned | no | 1 |  |
| `xp` | int(10) unsigned | no | 0 |  |
| `total_sessions` | int(10) unsigned | no | 0 |  |
| `total_completed` | int(10) unsigned | no | 0 |  |
| `best_raw_score` | int(10) unsigned | yes | NULL |  |
| `best_normalized_score` | int(10) unsigned | yes | NULL |  |
| `best_metrics_json` | text | yes | NULL |  |
| `last_played_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `uniq_user_game`: user_id, game_id
- **Unique** `uniq_student_game`: student_id, game_id
- Index `game_id`: game_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade; `game_id` references `brain_games`(id); `student_id` references `classroom_students`(id) on delete cascade

### brain_games

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `name` | varchar(100) | no |  |  |
| `slug` | varchar(50) | no |  |  |
| `description` | text | yes | NULL |  |
| `icon` | varchar(10) | yes | NULL |  |
| `primary_skill` | varchar(100) | yes | NULL |  |
| `active` | tinyint(1) | no | 1 |  |
| `display_order` | int(10) unsigned | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `reward_pipeline` | enum('legacy','classroom_generic') | no | classroom_generic |  |
| `band` | enum('discover','explore','challenge','advance') | yes | NULL |  |
| `domain` | enum('literacy','math','executive','sel','wellness') | yes | NULL |  |
| `casel_competencies` | set('self_awareness','self_management','social_awareness','relationship_skills','responsible_decision_making') | yes | NULL |  |
| `focus` | enum('self_awareness','self_management','social_awareness','relationship_skills','responsible_decision_making','literacy','math','thinking') | yes | NULL |  |

- **Primary key:** id
- **Unique** `slug`: slug

### brain_user_streaks

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | yes | NULL |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `current_streak` | int(10) unsigned | no | 0 |  |
| `longest_streak` | int(10) unsigned | no | 0 |  |
| `last_qualifying_date` | date | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `user_id`: user_id
- **Unique** `uniq_student`: student_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade; `student_id` references `classroom_students`(id) on delete cascade

### classroom_game_assignments

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `classroom_id` | int(10) unsigned | no |  |  |
| `game_id` | int(10) unsigned | no |  |  |
| `assigned_by_id` | int(10) unsigned | no |  |  |
| `due_date` | date | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_classroom`: classroom_id
- **Foreign keys:** `classroom_id` references `classrooms`(id) on delete cascade

### feature_flag_schools

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `flag_id` | int(10) unsigned | no |  |  |
| `school_id` | int(10) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uniq_flag_school`: flag_id, school_id
- Index `school_id`: school_id
- **Foreign keys:** `flag_id` references `feature_flags`(id) on delete cascade; `school_id` references `schools`(id) on delete cascade

### feature_flags

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `flag_key` | varchar(100) | no |  |  |
| `description` | varchar(255) | yes | NULL |  |
| `enabled_globally` | tinyint(1) | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `flag_key`: flag_key

### game_favorites

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `site_user_id` | int(10) unsigned | no |  |  |
| `game_id` | int(10) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** site_user_id, game_id
- Index `idx_game_fav_game`: game_id
- **Foreign keys:** `site_user_id` references `site_users`(id) on delete cascade; `game_id` references `brain_games`(id) on delete cascade

### learning_events

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | bigint(20) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | yes | NULL |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `school_id` | int(10) unsigned | yes | NULL |  |
| `session_token` | varchar(64) | yes | NULL |  |
| `event_type` | varchar(50) | no |  |  |
| `game_id` | int(10) unsigned | yes | NULL |  |
| `skill_id` | int(10) unsigned | yes | NULL |  |
| `content_version` | varchar(50) | yes | NULL |  |
| `metadata_json` | text | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_user`: user_id
- Index `idx_student`: student_id
- Index `idx_school_created`: school_id, created_at
- Index `idx_event_type`: event_type
- Index `idx_session`: session_token
- Index `game_id`: game_id
- Index `skill_id`: skill_id
- **Foreign keys:** `user_id` references `site_users`(id) on delete cascade; `student_id` references `classroom_students`(id) on delete cascade; `school_id` references `schools`(id) on delete cascade; `game_id` references `brain_games`(id) on delete set null; `skill_id` references `skills`(id) on delete set null

### pog_evidence_snapshots

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `state_code` | char(2) | no |  |  |
| `school_year_start` | smallint(5) unsigned | no |  |  |
| `classroom_id` | int(10) unsigned | no |  |  |
| `framework_id` | int(10) unsigned | no |  |  |
| `framework_name` | varchar(255) | no |  |  |
| `item_id` | int(10) unsigned | no |  |  |
| `item_code` | varchar(40) | no |  |  |
| `item_title` | varchar(255) | no |  |  |
| `students_counted` | int(10) unsigned | no |  |  |
| `practiced` | int(10) unsigned | no |  |  |
| `touched` | int(10) unsigned | no |  |  |
| `activities_finished` | int(10) unsigned | no |  |  |
| `direct_activities` | smallint(5) unsigned | no |  |  |
| `supporting_activities` | smallint(5) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_snapshot`: state_code, school_year_start, classroom_id, item_id
- Index `idx_classroom_year`: classroom_id, school_year_start

### program_use_snapshots

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `school_year_start` | smallint(5) unsigned | no |  |  |
| `month` | char(7) | no |  |  |
| `school_id` | int(10) unsigned | no |  |  |
| `district_id` | int(10) unsigned | yes | NULL |  |
| `teachers_licensed` | int(10) unsigned | no |  |  |
| `teachers_activated` | int(10) unsigned | no |  |  |
| `teachers_teaching` | int(10) unsigned | no |  |  |
| `teachers_teaching_ytd` | int(10) unsigned | no |  |  |
| `classrooms` | int(10) unsigned | no |  |  |
| `classrooms_active` | int(10) unsigned | no |  |  |
| `classrooms_regular` | int(10) unsigned | no |  |  |
| `students_enrolled` | int(10) unsigned | no |  |  |
| `students_active` | int(10) unsigned | no |  |  |
| `students_active_ytd` | int(10) unsigned | no |  |  |
| `activities` | int(10) unsigned | no |  |  |
| `source` | varchar(10) | no | monthly |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_snapshot`: school_year_start, month, school_id
- Index `idx_district_year`: district_id, school_year_start

### skill_prerequisites

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `skill_id` | int(10) unsigned | no |  |  |
| `prerequisite_skill_id` | int(10) unsigned | no |  |  |

- **Primary key:** id
- **Unique** `uniq_skill_prereq`: skill_id, prerequisite_skill_id
- Index `prerequisite_skill_id`: prerequisite_skill_id
- **Foreign keys:** `skill_id` references `skills`(id) on delete cascade; `prerequisite_skill_id` references `skills`(id) on delete cascade

### skills

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `skill_key` | varchar(64) | no |  |  |
| `label` | varchar(150) | no |  |  |
| `domain` | varchar(50) | no |  |  |
| `definition` | text | yes | NULL |  |
| `version` | int(10) unsigned | no | 1 |  |
| `is_active` | tinyint(1) | no | 1 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- **Unique** `skill_key`: skill_key

### standards_alignments

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `item_id` | int(10) unsigned | no |  |  |
| `target_type` | enum('program','curriculum','brain_game') | no |  |  |
| `target_id` | int(10) unsigned | no | 0 |  |
| `strength` | enum('direct','supporting') | no |  |  |
| `rationale` | varchar(1000) | no |  |  |
| `review_status` | enum('draft','verified') | no | draft |  |
| `reviewed_by` | int(10) unsigned | yes | NULL |  |
| `reviewed_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `suggested_by_site_user_id` | int(10) unsigned | yes | NULL |  |
| `district_note` | varchar(500) | yes | NULL |  |

- **Primary key:** id
- **Unique** `uq_item_target`: item_id, target_type, target_id
- Index `reviewed_by`: reviewed_by
- Index `fk_sa_suggested_by`: suggested_by_site_user_id
- **Foreign keys:** `suggested_by_site_user_id` references `site_users`(id) on delete set null; `item_id` references `standards_items`(id) on delete cascade; `reviewed_by` references `admin_users`(id) on delete set null

### standards_frameworks

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `state_code` | char(2) | no |  |  |
| `framework_type` | enum('sel_standards','portrait_of_graduate') | no |  |  |
| `name` | varchar(255) | no |  |  |
| `issuing_body` | varchar(255) | no |  |  |
| `official_url` | varchar(500) | no |  |  |
| `adopted_year` | smallint(5) unsigned | yes | NULL |  |
| `grade_span` | varchar(32) | yes | NULL |  |
| `source_accessed_on` | date | no |  |  |
| `notes` | varchar(1000) | yes | NULL |  |
| `review_status` | enum('draft','verified') | no | draft |  |
| `reviewed_by` | int(10) unsigned | yes | NULL |  |
| `reviewed_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `district_id` | int(10) unsigned | yes | NULL |  |
| `owner_key` | int(10) unsigned | no | 0 |  |
| `submitted_at` | datetime | yes | NULL |  |
| `submitted_by_site_user_id` | int(10) unsigned | yes | NULL |  |
| `attested_at` | datetime | yes | NULL |  |
| `attested_by_site_user_id` | int(10) unsigned | yes | NULL |  |

- **Primary key:** id
- **Unique** `uq_owner_type_name`: state_code, framework_type, name, owner_key
- Index `idx_state`: state_code
- Index `reviewed_by`: reviewed_by
- Index `idx_district`: district_id
- Index `fk_sf_submitted_by`: submitted_by_site_user_id
- Index `fk_sf_attested_by`: attested_by_site_user_id
- **Foreign keys:** `attested_by_site_user_id` references `site_users`(id) on delete set null; `district_id` references `districts`(id) on delete cascade; `submitted_by_site_user_id` references `site_users`(id) on delete set null; `reviewed_by` references `admin_users`(id) on delete set null

### standards_items

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `framework_id` | int(10) unsigned | no |  |  |
| `code` | varchar(64) | no |  |  |
| `title` | varchar(255) | no |  |  |
| `summary` | varchar(600) | yes | NULL |  |
| `grade_band` | varchar(32) | yes | NULL |  |
| `casel_competency` | enum('self_awareness','self_management','social_awareness','relationship_skills','responsible_decision_making') | yes | NULL |  |
| `sort_order` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- **Unique** `uq_framework_code`: framework_id, code
- **Foreign keys:** `framework_id` references `standards_frameworks`(id) on delete cascade

### standards_state_coverage

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `state_code` | char(2) | no |  |  |
| `sel_status` | enum('k12_standards','prek_only','guidance_only','none','unknown') | no | unknown |  |
| `pog_status` | enum('statewide','state_led_in_progress','district_led_only','none','unknown') | no | unknown |  |
| `sel_source_url` | varchar(500) | yes | NULL |  |
| `pog_source_url` | varchar(500) | yes | NULL |  |
| `source_accessed_on` | date | yes | NULL |  |
| `notes` | varchar(1000) | yes | NULL |  |
| `review_status` | enum('draft','verified') | no | draft |  |
| `reviewed_by` | int(10) unsigned | yes | NULL |  |
| `reviewed_at` | datetime | yes | NULL |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** state_code
- Index `reviewed_by`: reviewed_by
- **Foreign keys:** `reviewed_by` references `admin_users`(id) on delete set null

### student_game_completions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `game_assignment_id` | int(10) unsigned | no |  |  |
| `raw_score` | int(11) | yes | NULL |  |
| `duration_ms` | int(11) | yes | NULL |  |
| `completed_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_student`: student_id
- Index `idx_assignment`: game_assignment_id
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade; `game_assignment_id` references `classroom_game_assignments`(id) on delete cascade

### student_portrait_pins

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `student_id` | int(10) unsigned | no |  |  |
| `kind` | varchar(12) | no |  |  |
| `source_id` | int(10) unsigned | no |  |  |
| `item_id` | int(10) unsigned | yes | NULL |  |
| `school_year_start` | smallint(5) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_pin`: student_id, kind, source_id
- Index `idx_student_year`: student_id, school_year_start
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade

### user_brain_badges

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `user_id` | int(10) unsigned | yes | NULL |  |
| `student_id` | int(10) unsigned | yes | NULL |  |
| `badge_id` | int(10) unsigned | no |  |  |
| `earned_at` | datetime | no | current_timestamp() |  |
| `triggering_session_id` | int(10) unsigned | yes | NULL |  |
| `featured` | tinyint(1) | no | 0 |  |
| `featured_position` | int(10) unsigned | yes | NULL |  |
| `visibility` | varchar(16) | no | public |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uniq_user_badge`: user_id, badge_id
- **Unique** `uniq_student_badge`: student_id, badge_id
- Index `idx_user`: user_id
- Index `badge_id`: badge_id
- **Foreign keys:** `student_id` references `classroom_students`(id) on delete cascade; `user_id` references `site_users`(id) on delete cascade; `badge_id` references `brain_badges`(id)

## Demo (shared prospect demo)

### public_demo_events

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `window_id` | int(10) unsigned | no |  |  |
| `kind` | varchar(24) | no |  |  |
| `detail` | varchar(40) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `invitation_id` | int(10) unsigned | no | 0 |  |

- **Primary key:** id
- Index `idx_window_kind`: window_id, kind
- Index `idx_public_demo_events_invitation_id`: invitation_id

### public_demo_invitations

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `label` | varchar(120) | no |  |  |
| `workspace_id` | int(11) | no |  |  |
| `access_code` | varchar(20) | no |  |  |
| `code_version` | int(11) | no | 1 |  |
| `password` | varchar(100) | no |  |  |
| `pin` | varchar(20) | no |  |  |
| `status` | varchar(12) | no | active |  |
| `starts_at` | datetime | no |  |  |
| `ends_at` | datetime | no |  |  |
| `ended_at` | datetime | yes | NULL |  |
| `end_reason` | varchar(20) | yes | NULL |  |
| `created_by` | varchar(80) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uq_public_demo_invitation_code`: access_code
- Index `idx_public_demo_invitation_ws`: workspace_id, status

### public_demo_workspaces

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(11) | no |  |  |
| `district_id` | int(11) | yes | NULL |  |
| `school_id` | int(11) | yes | NULL |  |
| `purchase_id` | int(11) | yes | NULL |  |
| `status` | varchar(20) | no | free |  |
| `last_reset_at` | datetime | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id

## Settings, analytics, content safety and everything else

### analytics_events

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `session_id` | varchar(36) | no |  |  |
| `event_type` | varchar(32) | no |  |  |
| `page` | varchar(512) | yes | NULL |  |
| `label` | varchar(255) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `session_id`: session_id
- **Foreign keys:** `session_id` references `analytics_sessions`(id) on delete cascade

### analytics_sessions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | varchar(36) | no |  |  |
| `entry_page` | varchar(512) | yes | NULL |  |
| `referrer` | varchar(512) | yes | NULL |  |
| `user_agent` | varchar(255) | yes | NULL |  |
| `first_seen` | datetime | no | current_timestamp() |  |
| `last_seen` | datetime | no | current_timestamp() |  |

- **Primary key:** id

### automation_executions

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `event_key` | varchar(64) | no |  |  |
| `recipient_email` | varchar(255) | no |  |  |
| `status` | varchar(16) | no |  |  |
| `error_message` | varchar(500) | yes | NULL |  |
| `duration_ms` | int(10) unsigned | yes | NULL |  |
| `fired_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_event_key`: event_key
- Index `idx_fired_at`: fired_at
- Index `idx_recipient_email`: recipient_email

### book_tags

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `book_id` | int(10) unsigned | no |  |  |
| `tag` | varchar(128) | no |  |  |

- **Primary key:** id
- Index `book_id`: book_id
- **Foreign keys:** `book_id` references `books`(id) on delete cascade

### books

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `title` | varchar(255) | no |  |  |
| `author` | varchar(255) | no |  |  |
| `cover_image` | varchar(255) | yes | NULL |  |
| `short_description` | text | yes | NULL |  |
| `long_description` | text | yes | NULL |  |
| `price` | decimal(10,2) | yes | NULL |  |
| `compare_at_price` | decimal(10,2) | yes | NULL |  |
| `sku` | varchar(64) | yes | NULL |  |
| `category` | varchar(128) | yes | NULL |  |
| `stock_status` | varchar(32) | no | In Stock |  |
| `amazon_url` | varchar(512) | yes | NULL |  |
| `published` | tinyint(1) | no | 0 |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |
| `kindle_price` | decimal(10,2) | yes | NULL |  |
| `kindle_url` | varchar(512) | yes | NULL |  |
| `hardcover_price` | decimal(10,2) | yes | NULL |  |
| `hardcover_url` | varchar(512) | yes | NULL |  |
| `paperback_price` | decimal(10,2) | yes | NULL |  |
| `paperback_url` | varchar(512) | yes | NULL |  |

- **Primary key:** id

### safety_alert_recipients

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `school_domain` | varchar(255) | no |  |  |
| `category` | varchar(64) | yes | NULL |  |
| `email` | varchar(255) | no |  |  |
| `label` | varchar(100) | yes | NULL |  |
| `is_active` | tinyint(1) | no | 1 |  |
| `created_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- Index `idx_school_category`: school_domain, category

### safety_alerts

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `incident_id` | int(10) unsigned | no |  |  |
| `recipient_email` | varchar(255) | no |  |  |
| `recipient_kind` | enum('configured_recipient','classroom_teacher','fallback') | no |  |  |
| `sent_at` | datetime | yes | NULL |  |

- **Primary key:** id
- Index `incident_id`: incident_id
- **Foreign keys:** `incident_id` references `safety_incidents`(id) on delete cascade

### safety_findings

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `scan_id` | int(10) unsigned | no |  |  |
| `category` | varchar(64) | no |  |  |
| `severity` | tinyint(3) unsigned | no |  |  |
| `source` | enum('lexical','contextual','image') | no |  |  |
| `confidence` | float | yes | NULL |  |
| `rationale` | varchar(500) | yes | NULL |  |

- **Primary key:** id
- Index `scan_id`: scan_id
- **Foreign keys:** `scan_id` references `safety_scans`(id) on delete cascade

### safety_incidents

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `scan_id` | int(10) unsigned | no |  |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `classroom_id` | int(10) unsigned | yes | NULL |  |
| `category` | varchar(64) | no |  |  |
| `severity` | tinyint(3) unsigned | no |  |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `scan_id`: scan_id
- Index `idx_school`: school_domain
- **Foreign keys:** `scan_id` references `safety_scans`(id) on delete cascade

### safety_rules

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `scope` | enum('fne','school') | no | fne |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `category` | varchar(64) | no |  |  |
| `min_severity` | tinyint(3) unsigned | no |  |  |
| `action` | enum('allow','allow_log','block','block_alert','critical_block_alert') | no |  |  |
| `is_locked` | tinyint(1) | no | 0 |  |
| `created_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |
| `updated_at` | datetime | no | current_timestamp() | updates on change |

- **Primary key:** id
- Index `idx_category`: category, school_domain

### safety_scans

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `content_context` | varchar(64) | no |  |  |
| `author_site_user_id` | int(10) unsigned | yes | NULL |  |
| `author_student_id` | int(10) unsigned | yes | NULL |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `classroom_id` | int(10) unsigned | yes | NULL |  |
| `decision` | varchar(32) | no |  |  |
| `matched_rule_snapshot` | longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin | yes | NULL CHECK (json_valid(`matched_rule_snapshot`)) |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_author`: author_site_user_id, author_student_id
- Index `idx_created`: created_at

### safety_terms

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `scope` | enum('fne','school') | no | school |  |
| `school_domain` | varchar(255) | yes | NULL |  |
| `term` | varchar(255) | no |  |  |
| `category` | varchar(64) | no |  |  |
| `severity` | tinyint(3) unsigned | no | 2 |  |
| `is_allowlist` | tinyint(1) | no | 0 |  |
| `created_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_school`: school_domain

### territories

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `scope` | varchar(16) | no |  |  |
| `state` | char(2) | no |  |  |
| `county` | varchar(100) | no |  |  |
| `name` | varchar(150) | no |  |  |
| `status` | varchar(16) | no | active |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- **Unique** `uniq_geo`: state, county

### territory_requests

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | int(10) unsigned | no |  | auto increment |
| `affiliate_id` | int(10) unsigned | no |  |  |
| `request_type` | varchar(16) | no |  |  |
| `requested_state` | char(2) | no |  |  |
| `requested_county` | varchar(100) | no |  |  |
| `previous_assignment_id` | int(10) unsigned | yes | NULL |  |
| `status` | varchar(16) | no | pending |  |
| `reviewed_by_admin_id` | int(10) unsigned | yes | NULL |  |
| `reviewed_at` | datetime | yes | NULL |  |
| `rejection_reason` | varchar(500) | yes | NULL |  |
| `created_at` | datetime | no | current_timestamp() |  |

- **Primary key:** id
- Index `idx_affiliate_status`: affiliate_id, status
- Index `idx_status_created`: status, created_at
- Index `previous_assignment_id`: previous_assignment_id
- Index `reviewed_by_admin_id`: reviewed_by_admin_id
- **Foreign keys:** `affiliate_id` references `affiliates`(id) on delete cascade; `previous_assignment_id` references `affiliate_territories`(id) on delete set null; `reviewed_by_admin_id` references `admin_users`(id) on delete set null

---

## Appendix: earlier hand-written notes

The previous `SCHEMA.md` (generated 2026-09-04 from production, partly out of date: it covered 94 tables and several were added later). Kept because it explains why some tables exist. The tables above are the authority for columns and keys.

#### FixerNation Education — Live Database Schema

Pulled directly from the production database (`fixernat_fixernation`) via `SHOW CREATE TABLE`, not from `server/db/schema.sql` — that file is a known stale/incomplete source of truth (many tables and columns only ever arrived via one-off `alter-*.js` migration scripts and were never backfilled into it). This file is what to trust for "what does the live database actually look like."

> **Maintenance convention:** whenever a schema change ships to production (new table, new column, any `alter-*.js`/`backfill-*.js` script), update the relevant section below in the same session — don't let this drift the way `schema.sql` did. `server/scripts/dump-schema.js` (read-only, `SHOW CREATE TABLE` for every table) is the fastest way to re-verify against the live database if this doc is ever in doubt.

**Generated:** 2026-09-04, affiliate program section added 2026-09-24 after `alter-add-affiliate-program.js`, `alter-add-affiliate-commission-ledger.js`, and `alter-add-affiliate-territories.js` were confirmed run in production. That confirmation was indirect — the app restarted cleanly and `GET /api/affiliate-portal/me` returned 401 rather than 404 — not a fresh `SHOW CREATE TABLE` dump; re-run `node scripts/dump-schema.js` if this section is ever in doubt. · **94 tables total** · Grouped by subsystem for readability. Legend: 🔑 = primary key, 🔗 = foreign key, ⭐ = unique key.

---

#### 1. Admin & Site-User Auth

##### `admin_users` — FNE staff accounts (`fn_session` cookie)
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 auto_increment |
| username | varchar(64) | ⭐ NOT NULL |
| password_hash | varchar(255) | NOT NULL |
| created_at | datetime | default now |
| email | varchar(255) | ⭐ nullable |
| email_verified | tinyint(1) | default 1 |

##### `admin_invite_tokens` — staff invite links
id 🔑 · admin_id 🔗→admin_users (CASCADE) · token varchar(128) ⭐ · expires_at datetime · created_at datetime

##### `site_users` — teachers/parents/school & district admins (`fn_user_session` cookie)
| Column | Type | Notes |
|---|---|---|
| id | int unsigned | 🔑 |
| first_name / last_name | varchar(100) | NOT NULL |
| email | varchar(255) | ⭐ NOT NULL |
| password_hash | varchar(255) | NOT NULL |
| email_verified | tinyint(1) | default 0 |
| role | varchar(32) | default 'teacher' — 'parent'/'school_license_admin'/'district_admin'/**'affiliate' (NEW)** etc. (not exclusive; entitlements checked independently) |
| created_at | datetime | |
| session_invalidated_at | datetime | nullable — set on password reset/seat revoke to force-logout other sessions |

##### `site_user_tokens` — email verification / password reset tokens
id 🔑 · user_id 🔗→site_users (CASCADE) · token varchar(128) ⭐ · type varchar(20) · expires_at · created_at

##### `site_user_audiences` — grade levels a teacher teaches
id 🔑 · site_user_id 🔗→site_users (CASCADE) · audience varchar(64) · ⭐ (site_user_id, audience)

---

#### 2. CRM

##### `newsletter_contacts` — the CRM contact record (buyer of record for every purchase)
id 🔑 · name · email ⭐ NOT NULL · street/city/state/zip (the Bill To address) · ship_to_name/company/street/city/state/zip (optional shipping address) · signup_date · source (default 'Homepage') · status (default 'Subscribed') · phone · company · notes text · morning_boost_unsubscribed_at

##### `contact_groups` — CRM segments
id 🔑 · name varchar(128) ⭐ · created_at · system_key varchar(50) ⭐ nullable (marks a group as a reserved system category)

##### `contact_group_members` — join table
🔑 (contact_id, group_id) · contact_id 🔗→newsletter_contacts (CASCADE) · group_id 🔗→contact_groups (CASCADE)

---

#### 3. Licensing, Schools & Districts

##### `license_products` — admin-editable catalog
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

##### `purchases` — one row per order line (the central licensing table)
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
| **affiliate_id** | int unsigned | **NEW** — 🔗→affiliates (SET NULL), set only when a valid `?ref=` code was in play at checkout |
| **affiliate_commission_cents** | int unsigned | **NEW** — snapshot of the commission calculated at attribution time; the ledger (`affiliate_commissions`) is authoritative for what's actually owed, this is a display cache |

##### `license_seats` — one row per seat
id 🔑 · purchase_id 🔗→purchases (CASCADE) · invited_email · status (pending/registered/inactive/revoked/available) · registered_site_user_id 🔗→site_users (SET NULL) · registered_at · invitation_id · revoked_at/by/reason · notes

##### `license_utilization_alerts` — dedup log for seat-usage warning emails
id 🔑 · purchase_id · threshold_pct · sent_at

##### `invoices` — PO-order grouping (Stripe/card checkouts never create one)
id 🔑 · invoice_number varchar(32) ⭐ · contact_id 🔗→newsletter_contacts (CASCADE) · po_number · po_received_date · total_cents · status (unpaid/paid/cancelled) · created_at · paid_at · bill_to_name/company/email/street/city/state/zip + bill_to_saved_at (this invoice's own Bill To; null saved_at = older invoice, read from the contact) · ship_to_name/company/street/city/state/zip

##### `trial_curriculum_accesses` — trial-tier preview cap tracking
🔑 (purchase_id, curriculum_id) · purchase_id 🔗→purchases (CASCADE) · first_accessed_at

##### `school_invitations` — teacher invite links from a school admin
id 🔑 · purchase_id 🔗→purchases (CASCADE) · seat_id 🔗→license_seats (SET NULL) · invited_email · first/last_name · token ⭐ · status · grade_level (older free text; new invites write 'ES, MS')/audiences (grade levels chosen at invite, comma-joined full names, merged into `site_user_audiences` on accept)/role_title/department/subject_area · personal_message · invited_by_site_user_id · expires_at · resend_count · last_resent_at · revoked_at/by/reason · created_at

##### `school_license_admins` — school-admin role assignments (does NOT consume a seat)
id 🔑 · site_user_id 🔗→site_users (CASCADE) · purchase_id 🔗→purchases (CASCADE) · permission_level (primary/secondary/read_only) · is_active · created_by_admin_id · notes · ⭐ (site_user_id, purchase_id)

##### `district_license_admins` — district-admin role assignments
id 🔑 · site_user_id 🔗→site_users (CASCADE) · district_id 🔗→districts (CASCADE) · is_active · created_by_admin_id · notes · ⭐ (site_user_id, district_id)

##### `schools` — first-class school entity (backfilled from `purchases.school_domain`)
id 🔑 · domain varchar(255) ⭐ · district_id 🔗→districts (SET NULL) · display_name · created_at

##### `districts`
id 🔑 · name · created_at

##### `school_branding` / `district_branding` — draft/published logo+colors
PK is `school_id`/`district_id` 🔗 (CASCADE) · draft_logo_original_url/display_url · draft_primary/secondary/accent_color · published_* (mirror of draft_*) · branding_status enum(DEFAULT/DRAFT/PUBLISHED) · updated_at/by 🔗→site_users (SET NULL) · published_at · draft_logo_crop / published_logo_crop (JSON, validated via CHECK)

##### `school_audit_log` — append-only action log
id 🔑 · actor_type/id/email · action · entity_type/id · purchase_id · school_domain · prev_value/new_value (JSON-as-text) · reason · ip_address · created_at

**NEW consumer (2026-09-24):** the affiliate program (§15) also writes here via the shared `lib/audit.js` helper, tagged with its own `entity_type` values (`affiliate`, `affiliate_application`, `affiliate_commission`, `affiliate_territory`) rather than a second table. Every purchase-scoped query in `school-admin.js` explicitly excludes those values (`AFFILIATE_ENTITY_TYPES`, also from `lib/audit.js`) — this was NOT true on first ship and leaked a commission's `payout_reference` into a school admin's own activity view before it was caught and fixed.

##### `support_requests` / `support_request_messages` — help requests and their thread (Release 115)
`support_requests`: id 🔑 · ref (unique, e.g. SR-4F7K2) · status (`new`/`open`/`waiting_on_user`/`resolved`) · category · subject · requester_name/email · site_user_id 🔗 (SET NULL; only when signed in) · roles/school_domain/district_id (worked out on the server from the account, never the form) · page_url/user_agent (browser-sent, untrusted) · assigned_admin_id 🔗 (SET NULL) · requester_seen_message_id (newest staff reply the person opened; Release 118) · client_session_id (the visitor's anonymous browser session id; Release 122) · created_at/updated_at/resolved_at. `support_request_messages`: id 🔑 · request_id 🔗 (CASCADE) · author_type (`requester`/`staff`) · author_admin_id 🔗 · visibility (`public`/`internal`; internal is never selected by the person-side routes) · body · created_at. Staff actions are logged in `school_audit_log` with entity_type `support_request` and no purchase_id.

##### `client_errors` — error capture (Release 122)
id 🔑 · kind (`js_error`/`promise_rejection`/`failed_request`/`server_error`/`email_failed`) · page_path · api_path (numbers and tokens replaced) · method · http_status · message (≤300, emails/tokens removed) · source (script file:line, or for email_failed the recipient's DOMAIN and the subject) · user_kind (`visitor`/`signed_in`/`student`/`admin`/`server`) · site_user_id (only `signed_in`; never a student) · client_session_id (anonymous analytics session id) · user_agent · occurrences · first_seen/last_seen. No IP, no query string. Rows older than 30 days are deleted when a new report arrives.

##### `school_admin_notifications` — dedup log for school-admin alert emails
id 🔑 · school_domain · reason · teacher_email · admin_contact_id · sent_at

---

#### 4. Quotes

##### `quote_requests`
| Column | Type | Notes |
|---|---|---|
| bill_to_street/city/state/zip, ship_to_name/company/street/city/state/zip | varchar | Release 97: the quote's Bill To address and Ship To, copied onto the invoice on acceptance |
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

##### `quote_content_profiles` — reusable quote-email content sets
id 🔑 · name ⭐ · section_annual_includes/lesson_package/video_access/license_terms (text) · is_default · created_at/updated_at

---

#### 5. Curriculum & Content

##### `curricula` — lesson plans
id 🔑 · title · series · short_description, overview · lesson_document, lesson_document_name · download_limit · published · created_at/updated_at · lessons_count, weeks_count · sort_order

##### `curriculum_audiences` / `curriculum_materials` / `curriculum_objectives`
Each: id 🔑 · curriculum_id 🔗→curricula (CASCADE) · one text field (audience/material/objective) · sort_order where applicable

##### `curriculum_resources` — Teacher Copy / Student Handout / Classroom Poster files
id 🔑 · curriculum_id 🔗→curricula (CASCADE) · resource varchar(64) · file_path, file_name · download_limit

##### `curriculum_videos`
id 🔑 · curriculum_id 🔗→curricula (CASCADE) · name · url · size_label · sort_order

##### `curriculum_quiz_questions` / `curriculum_quiz_options`
questions: id 🔑 · curriculum_id 🔗 (CASCADE) · question text · correct_index · sort_order
options: id 🔑 · question_id 🔗→curriculum_quiz_questions (CASCADE) · option_text · sort_order

##### `curriculum_downloads` — per-resource download counter/rate-limit
id 🔑 · curriculum_id · user_email · user_type (teacher/parent) · resource_type (default 'any') · count · last_download · ⭐ (curriculum_id, user_email, user_type, resource_type)

---

#### 6. Books

##### `books`
id 🔑 · title, author · cover_image · short/long_description · price, compare_at_price · sku · category · stock_status (default 'In Stock') · amazon_url · published · created_at/updated_at · kindle/hardcover/paperback price+url

##### `book_tags`
id 🔑 · book_id 🔗→books (CASCADE) · tag

---

#### 7. Blog & Morning Boost

##### `blog_posts`
id 🔑 · title, theme, series, slug ⭐ · author · category · featured_image · excerpt, body (mediumtext) · video_url/file_name/size_label · publish_date · featured, published · created_at/updated_at · alt_text, meta_description, focus_keyword · requires_membership (legacy, membership system removed — internal field only)

##### `blog_post_categories` / `blog_post_tags`
Each: id 🔑 · post_id 🔗→blog_posts (CASCADE) · category/tag

##### `blog_tags`
id 🔑 · tag ⭐

##### `blog_post_favorites` (Release 91)
🔑 (site_user_id 🔗→site_users, post_id 🔗→blog_posts) · created_at — both CASCADE. A signed-in site user's starred posts; private to that user. Created by `scripts/alter-add-blog-post-favorites.js` and in `schema.sql`. Route: `routes/blog-favorites.js`.

##### `lesson_favorites` / `game_favorites` (Release 165)
Each: 🔑 (site_user_id 🔗→site_users, curriculum_id 🔗→curricula | game_id 🔗→brain_games) · created_at — all CASCADE. A signed-in site user's starred lessons and games; private to that user. Created by `scripts/alter-add-lesson-game-favorites.js` (safe to run twice). `game_favorites` sits after `brain_games` in `schema.sql`.

##### `morning_boost_calendar`
id 🔑 · boost_date date ⭐ · theme, series · blog_post_id 🔗→blog_posts (SET NULL) · created_at

##### `morning_boost_audio_clips`
id 🔑 · filename ⭐ · script_text · created_at

##### `morning_boost_email_config` — single-row campaign config
id 🔑 · enabled · send_time, send_timezone · from_name/email, reply_to · subject, body, body_format · cta_text, cta_url_override · fallback_message · updated_at/by

##### `morning_boost_email_groups`
🔑 (config_id, group_id)

##### `morning_boost_sends` / `morning_boost_send_recipients`
sends: id 🔑 · config_id, blog_post_id · boost_date · scheduled_for, sent_at · status · subject/from_email/from_name/reply_to/cta_url (snapshot) · group_ids (text) · recipient/sent/failed/skipped_count · failure_reason · is_resend · initiated_by · created_at
recipients: id 🔑 · send_id · contact_id · email · status · error_message · sent_at · open_token ⭐/opened_at · click_token ⭐/clicked_at

---

#### 8. Classroom / Student System

##### `classrooms`
id 🔑 · name · teacher_site_user_id · purchase_id (nullable) · join_code char(8) ⭐ · parent_code ⭐ nullable (legacy, no longer used for self-join) · grade_level, subject, academic_year · archived_at · created_at

##### `classroom_students` — classroom-PIN students (no email, ever)
id 🔑 · classroom_id 🔗→classrooms (CASCADE) · display_name · username ⭐ · password_hash (their PIN) · student_number · is_active · created_at

##### `classroom_assignments` / `classroom_game_assignments`
assignments: id 🔑 · classroom_id 🔗 (CASCADE) · curriculum_id · assigned_by_id · sort_order · due_date · assigned_at · ⭐ (classroom_id, curriculum_id)
game assignments: id 🔑 · classroom_id 🔗 (CASCADE) · game_id · assigned_by_id · due_date · created_at

##### `student_lesson_progress`
id 🔑 · student_id 🔗→classroom_students (CASCADE) · curriculum_id · started_at, completed_at, last_activity_at · ⭐ (student_id, curriculum_id)

##### `student_quiz_responses` — final, graded answers (write-once; existence = "submitted")
id 🔑 · student_id 🔗→classroom_students (CASCADE) · curriculum_id · question_id · selected_option_index · is_correct · submitted_at · ⭐ (student_id, question_id)

##### `student_quiz_drafts` — **NEW this session**, save-progress feature
id 🔑 · student_id · curriculum_id · question_id · selected_option_index · saved_at · ⭐ (student_id, curriculum_id, question_id) — deliberately separate from `student_quiz_responses` so an in-progress draft never trips the one-attempt lock

##### `student_reflections` / `student_goals`
reflections: id 🔑 · student_id 🔗 (CASCADE) · curriculum_id · prompt_key · response_text · submitted_at · teacher_seen_at
goals: id 🔑 · student_id 🔗 (CASCADE) · goal_text · target_date · is_achieved, achieved_at · created_at

##### `student_game_completions`
id 🔑 · student_id 🔗→classroom_students (CASCADE) · game_assignment_id 🔗→classroom_game_assignments (CASCADE) · raw_score · duration_ms · completed_at

##### `parent_classroom_links` — per-child parent↔classroom link
id 🔑 · site_user_id 🔗→site_users (CASCADE) · classroom_id 🔗 (CASCADE) · student_id 🔗→classroom_students (SET NULL) · linked_at · ⭐ (site_user_id, classroom_id, student_id)

##### `parent_student_invitations`
id 🔑 · classroom_id 🔗 (CASCADE) · student_id 🔗→classroom_students (CASCADE) · invited_email, invited_name · token ⭐ · status · invited_by_site_user_id · personal_message · expires_at · revoked_at · created_at

##### `teacher_lesson_plans` — a teacher's personal saved-lesson library
🔑 (site_user_id, curriculum_id) · both 🔗 (CASCADE) · selected_at

##### `teacher_lesson_plan_swaps` — each time a teacher removed or swapped out a library lesson
id 🔑 · site_user_id 🔗→site_users (CASCADE) · removed_curriculum_id · added_curriculum_id (null for a plain removal) · swapped_at · voided_at (set when FNE staff reset the teacher's swaps; swaps used = rows with voided_at null)

---

#### 9. Brain Games

##### `brain_games`
id 🔑 · name · slug ⭐ · description · icon · primary_skill · active · display_order · created_at

##### `brain_badges`
id 🔑 · name · slug ⭐ · description · game_id 🔗→brain_games (SET NULL) · category (default 'achievement') · rarity (default 'common') · criteria_type, criteria_json · xp_reward · emoji · active, publicly_displayable · display_order · created_at

##### `brain_game_sessions`
id 🔑 · user_id 🔗→site_users (CASCADE) · game_id 🔗→brain_games · session_token ⭐ · started_at, completed_at · duration_ms · difficulty · raw_score, normalized_score, accuracy · status · metrics_json · scoring_version · validation_status · leaderboard_eligible · xp_earned · created_at/updated_at

##### `brain_game_user_progress`
id 🔑 · user_id 🔗→site_users (CASCADE) · game_id 🔗→brain_games · level, xp · total_sessions, total_completed · best_raw_score, best_normalized_score, best_metrics_json · last_played_at · created_at/updated_at · ⭐ (user_id, game_id)

##### `brain_user_streaks`
id 🔑 · user_id 🔗→site_users (CASCADE) ⭐ · current_streak, longest_streak · last_qualifying_date · created_at/updated_at

##### `brain_game_privacy`
id 🔑 · user_id 🔗→site_users (CASCADE) ⭐ · show_activity/score/streaks/badges · created_at/updated_at

##### `user_brain_badges`
id 🔑 · user_id 🔗→site_users (CASCADE) · badge_id 🔗→brain_badges · earned_at · triggering_session_id · featured, featured_position · visibility (default 'public') · created_at · ⭐ (user_id, badge_id)

---

#### 10. Social / Community

##### `social_groups`
id 🔑 · name · type enum(all_teachers/school/membership/custom) · school_domain · description · created_at · is_public

##### `social_group_members` / `social_group_reads`
members: 🔑 (group_id, user_id) · joined_at
reads: 🔑 (group_id, user_id) · last_read_at

##### `social_posts`
id 🔑 · group_id 🔗→social_groups (CASCADE) · author_id · content · attachments (JSON, validated) · created_at/updated_at · deleted_at (soft-delete)

##### `social_comments`
id 🔑 · post_id 🔗→social_posts (CASCADE) · author_id · content · created_at · deleted_at

##### `social_reactions`
🔑 (post_id, user_id) · post_id 🔗→social_posts (CASCADE) · reaction (default 'like') · created_at

##### `social_messages` — direct messages
id 🔑 · sender_id, recipient_id · content · attachments (JSON) · read_at · created_at · deleted_at

##### `social_profiles`
PK `user_id` 🔗→site_users (CASCADE) · bio, bio_consent · avatar_url · updated_at

---

#### 11. Content Safety

##### `safety_rules` — admin-editable threshold config
id 🔑 · scope enum(fne/school) · school_domain · category · min_severity · action enum(allow/allow_log/block/block_alert/critical_block_alert) · is_locked · created_by_admin_id · created_at/updated_at

##### `safety_terms` — profanity/term lists
id 🔑 · scope, school_domain · term · category · severity (default 2) · is_allowlist · created_by_admin_id · created_at

##### `safety_scans` — one row per content-safety check performed
id 🔑 · content_context · author_site_user_id, author_student_id · school_domain, classroom_id · decision · matched_rule_snapshot (JSON) · created_at

##### `safety_findings`
id 🔑 · scan_id 🔗→safety_scans (CASCADE) · category · severity · source enum(lexical/contextual/image) · confidence · rationale

##### `safety_incidents`
id 🔑 · scan_id 🔗→safety_scans (CASCADE) · school_domain, classroom_id · category · severity · created_at

##### `safety_alerts` — outbound notification log for an incident
id 🔑 · incident_id 🔗→safety_incidents (CASCADE) · recipient_email · recipient_kind enum(configured_recipient/classroom_teacher/fallback) · sent_at

##### `safety_alert_recipients` — per-school, per-category destination config
id 🔑 · school_domain · category · email · label · is_active · created_by_admin_id · created_at/updated_at

---

#### 12. Automations & Campaigns

##### `email_automations` — 10 fixed system-triggered email types (config only)
id 🔑 · event_key varchar(64) ⭐ · label · enabled · subject, body · reminder_days_before · updated_at

##### `automation_executions` — **NEW this session**, real execution log
id 🔑 · event_key · recipient_email · status (success/failed/skipped) · error_message · duration_ms · fired_at

##### `campaigns` — bulk newsletter campaigns (one row per actual send, including each recurring-series occurrence)
id 🔑 · subject · from_name/email · audience_status, audience_source, audience_group_id (deprecated — see `campaign_audience_groups`) · **scheduled_for** (datetime, NEW) · **series_id** 🔗→campaign_series (SET NULL, NEW) · body, body_format · status (Draft/Scheduled/Sent) · sent_at · recipient_count · created_at/updated_at

##### `campaign_audience_groups` — **NEW**, one-or-many groups per campaign (UNION — reaches anyone in any selected group)
🔑 (campaign_id, group_id) · campaign_id 🔗→campaigns (CASCADE) · group_id 🔗→contact_groups (CASCADE)

##### `campaign_series` — **NEW**, recurring campaign definitions (daily/weekly/monthly template)
id 🔑 · subject · from_name/email · audience_status, audience_source · body, body_format · recurrence_type (daily/weekly/monthly) · recurrence_day_of_week (0-6, weekly) · recurrence_day_of_month (1-31, monthly — clamped to short months) · send_time · send_timezone (IANA) · is_active · next_fire_at · last_fired_at · created_at/updated_at

##### `campaign_series_groups` — **NEW**, one-or-many groups per series (copied to the spawned campaign's own `campaign_audience_groups` at fire time)
🔑 (series_id, group_id) · series_id 🔗→campaign_series (CASCADE) · group_id 🔗→contact_groups (CASCADE)

##### `campaign_sends`
id 🔑 · campaign_id 🔗→campaigns (CASCADE) · contact_id 🔗→newsletter_contacts (SET NULL) · email · token ⭐ · status (default 'sent') · error_message · sent_at · opened_at, open_count · unsubscribed_at · clicked_at, click_count

##### `campaign_link_targets`
id 🔑 · send_id 🔗→campaign_sends (CASCADE) · link_id ⭐ · destination_url · click_count · created_at

---

#### 13. Analytics

##### `analytics_sessions`
id varchar(36) 🔑 · entry_page, referrer, user_agent · first_seen, last_seen

##### `analytics_events`
id 🔑 · session_id 🔗→analytics_sessions (CASCADE) · event_type · page · label · created_at

---

#### 14. Settings

##### `settings` — generic key/value store
setting_key varchar(64) 🔑 · setting_value text · updated_at

---

#### 15. Affiliates *(new subsystem, 2026-09-24)*

B2B sales-affiliate program. Design: `docs/AFFILIATE_PROGRAM_SPIKE.md`, `docs/AFFILIATE_COMMISSION_LEDGER_SPIKE.md`. An affiliate is a role on `site_users` (`role = 'affiliate'`), same split as `district_license_admins` — no separate auth system.

##### `affiliate_applications` — a prospect's application
id 🔑 · first_name/last_name · email · company · phone · requested_territory (legacy free text, superseded 2026-09-26) · requested_territory_state char(2) · requested_territory_county varchar(100) (structured state+county ask, dropdown-backed) · pitch text · status varchar(16) (pending/approved/rejected) · reviewed_by_admin_id 🔗→admin_users (SET NULL) · reviewed_at · rejection_reason · resulting_site_user_id 🔗→site_users (SET NULL) · created_at

A rejected applicant may reapply at any time — no re-application block, no cooldown. Each attempt is a new row; the admin review queue shows prior decisions on the same email.

##### `affiliates` — an approved affiliate
id 🔑 · site_user_id 🔗→site_users (CASCADE) ⭐ · application_id 🔗→affiliate_applications (SET NULL) · referral_code varchar(32) ⭐ (shared as `?ref=CODE`) · commission_rate decimal(5,2) · status varchar(16) (active/suspended) · approved_by_admin_id 🔗→admin_users (SET NULL) · approved_at · created_at · updated_at

Had a `territory varchar(100)` column through 2026-09-24; dropped the same day once real territory records (below) existed. Commission rate is snapshotted onto each sale at attribution time — changing it here never rewrites a past commission.

##### `affiliate_commissions` — the commission ledger (authoritative for money owed)
id 🔑 · affiliate_id 🔗→affiliates (CASCADE) · purchase_id 🔗→purchases (SET NULL, nullable — NULL for a manual/bonus entry) · status varchar(16) (pending/approved/paid/on_hold/reversed) · source_type varchar(16) (referral/manual/bonus) · description · gross_amount_cents · commission_rate decimal(5,2) (snapshot) · commission_cents int **signed** (a manual correction can be negative; a reversal flips status, never writes a negative row) · approved_at/by_admin_id · paid_at · payout_reference varchar(64) (check number, transfer id — payment itself happens outside the system) · reversed_at/by_admin_id · reversal_reason · notes · created_at · updated_at

Status follows the money: a card sale opens `approved` (Stripe already took payment); a PO sale opens `pending` and is approved when the invoice is marked paid; cancelling an invoice reverses whatever hasn't been paid out. Every balance is a `SUM()` filtered by status — never a bare sum over the table.

##### `territories` — real US states/counties (not free text)
id 🔑 · scope varchar(16) (state/county — `state` is legacy-only as of 2026-09-26, see below) · state char(2) (USPS code) · county varchar(100) default `''` (empty only in a legacy state-scope row — `UNIQUE(state, county)` enforces one row per state/county) · name varchar(150) (display label) · status varchar(16) (active/retired) · created_at · ⭐ (state, county)

The 50 states + DC are seeded once and always exist as `scope='state'` reference rows. **As of 2026-09-26, a county is mandatory for every NEW territory** — `findOrCreateTerritory()` rejects an empty county, so a whole-state assignment can no longer be created going forward. A county-scope row is still created the first time anyone actually requests/assigns "this county, in this state" — the ~3,143 real US counties are pre-loaded as names-only reference data (`server/lib/us-counties.js`, sourced from the public-domain Census FIPS list), but a `territories` row for one still isn't created until first use. DC has exactly one county-equivalent ("District of Columbia" itself, from the same FIPS data), which satisfies the mandatory-county rule without a real subdivision.

##### `affiliate_territories` — assignment history (many-per-affiliate)
id 🔑 · affiliate_id 🔗→affiliates (CASCADE) · territory_id 🔗→territories (CASCADE) · status varchar(16) (active/revoked) · assigned_by_admin_id 🔗→admin_users (SET NULL) · revoked_at/by_admin_id · notes · created_at

Exclusivity (one active affiliate per territory) is an app-level check against this table's own `status`, not a DB constraint and not a join against the parent affiliate's active/suspended status — suspending an affiliate explicitly revokes their rows here in the same transaction, rather than relying on a filter elsewhere. This check is per exact `territory_id` — a legacy whole-state row and a county-within-it are different rows with no cross-check between them (unchanged, deliberately preserved; moot for new data now that county is mandatory).

##### `territory_requests` — an affiliate's own request for a territory *(new, 2026-09-26)*
id 🔑 · affiliate_id 🔗→affiliates (CASCADE) · request_type varchar(16) (initial/addition/change) · requested_state char(2) · requested_county varchar(100) (always required) · previous_assignment_id 🔗→affiliate_territories (SET NULL, `change` only — the assignment being replaced) · status varchar(16) (pending/approved/rejected) · reviewed_by_admin_id 🔗→admin_users (SET NULL) · reviewed_at · rejection_reason · created_at

Mirrors the `affiliate_applications` pattern one level down: a request row never touches `affiliate_territories` by itself. Approving one calls the same `assignTerritory()` every direct admin action uses (for `change`, `revokeTerritoryAssignment()` on `previous_assignment_id` runs first, in the same transaction — a true swap, not an addition). Rejecting one leaves `affiliate_territories` completely untouched. Only one `pending` row per affiliate is allowed, enforced in the app layer (same convention as territory exclusivity above), not a DB constraint.

---

#### Columns added this session (2026-08-27 – 2026-09-04)

| Table | Column | Purpose |
|---|---|---|
| `license_products` | `duration_days` | Admin-set license length (30/60/90/180/365 days) |
| `purchases` | `license_duration_days` | Snapshot of intended length at purchase time |
| `quote_requests` | `expiring_reminder_sent_at` | Dedup flag for the 7-day quote-expiry reminder |
| *(new table)* `automation_executions` | — | Real execution log for every automated email send |
| *(new table)* `student_quiz_drafts` | — | Partial quiz-progress save, separate from the write-once `student_quiz_responses` |
| `campaigns` | `scheduled_for`, `series_id` | Schedule-for-later + link back to the recurring series that spawned this occurrence |
| *(new table)* `campaign_audience_groups` | — | One-or-many audience groups per campaign (UNION), replacing the single `audience_group_id` |
| *(new table)* `campaign_series` | — | Recurring campaign definitions (daily/weekly/monthly) |
| *(new table)* `campaign_series_groups` | — | One-or-many audience groups per recurring series |

#### Columns added this session (2026-09-24) — sales-affiliate program

| Table | Column | Purpose |
|---|---|---|
| *(new table)* `affiliate_applications` | — | A prospect's application, reviewable and re-appliable |
| *(new table)* `affiliates` | — | An approved affiliate: referral code, commission rate, status |
| `site_users` | `role` gains `'affiliate'` | No new column — an existing enum-like value, not a schema change |
| `purchases` | `affiliate_id`, `affiliate_commission_cents` | Which affiliate earned this sale, and the commission snapshot at attribution time |
| *(new table)* `affiliate_commissions` | — | The commission ledger — authoritative for money owed, status follows the money |
| *(new table)* `territories` | — | Real US states/counties, fixed vocabulary |
| *(new table)* `affiliate_territories` | — | Assignment history, many territories per affiliate |
| `affiliates` | `territory` **dropped** | Superseded by `territories`/`affiliate_territories` same day, after backfill |

#### Columns added this session (2026-09-26) — territory requests + mandatory county

| Table | Column | Purpose |
|---|---|---|
| *(new table)* `territory_requests` | — | An affiliate's own pending request for a territory (initial/addition/change), always admin-reviewed before `affiliate_territories` changes |
| `affiliate_applications` | `requested_territory_state`, `requested_territory_county` | Structured state+county ask, replacing the free-text `requested_territory` (kept, unused going forward) |
| `territories` | *(no new column)* | `scope='state'` (county='') rows can no longer be newly created — enforced in `findOrCreateTerritory()`, not a schema change |


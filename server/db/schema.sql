-- Fixer Nation database schema (MariaDB / MySQL)
-- Replaces the browser-localStorage demo described in PROJECT.md with real, shared storage.

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  email_verified TINYINT(1) NOT NULL DEFAULT 1, -- 1 for the original admin (no invite flow); a newly-invited admin starts at 0 until they accept
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-use invite links for adding a new admin — a new admin_users row is
-- created with an unusable random password immediately, so they can't log in
-- until they follow this link to set their own password (mirrors the
-- site_user_tokens verification pattern, but for admins).
CREATE TABLE IF NOT EXISTS admin_invite_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id INT UNSIGNED NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Public site user accounts (separate from the single admin_users login)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Single-use tokens for email verification and password reset.
CREATE TABLE IF NOT EXISTS site_user_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  type VARCHAR(20) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES site_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Books
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS books (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255) NOT NULL,
  cover_image VARCHAR(255),
  short_description TEXT,
  long_description TEXT,
  price DECIMAL(10,2),
  compare_at_price DECIMAL(10,2),
  sku VARCHAR(64),
  category VARCHAR(128),
  stock_status VARCHAR(32) NOT NULL DEFAULT 'In Stock',
  amazon_url VARCHAR(512),
  kindle_price DECIMAL(10,2), -- these three are purely informational (link out to Amazon) — separate from `price` above, which is what our own Add to Cart/Stripe/PO checkout charges
  kindle_url VARCHAR(512),
  hardcover_price DECIMAL(10,2),
  hardcover_url VARCHAR(512),
  paperback_price DECIMAL(10,2),
  paperback_url VARCHAR(512),
  published TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS book_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  book_id INT UNSIGNED NOT NULL,
  tag VARCHAR(128) NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Newsletter CRM
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS newsletter_contacts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(32),
  company VARCHAR(255),
  street VARCHAR(255),
  city VARCHAR(128),
  state VARCHAR(64),
  zip VARCHAR(16),
  signup_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(128) NOT NULL DEFAULT 'Homepage',
  status VARCHAR(32) NOT NULL DEFAULT 'Subscribed',
  notes TEXT, -- catch-all for rarely-populated imported fields (secondary email/phone, extra addresses, etc.) so bulk imports don't have to silently drop them
  morning_boost_unsubscribed_at DATETIME NULL -- set when the contact clicks the MB-specific unsubscribe link; does not affect other email types
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contact groups, for categorizing contacts. A contact may belong to any
-- number of groups.
CREATE TABLE IF NOT EXISTS contact_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  system_key VARCHAR(50) NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS contact_group_members (
  contact_id INT UNSIGNED NOT NULL,
  group_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (contact_id, group_id),
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sellable school license tiers shown on education-portal.html and managed
-- from admin-license-products.html — e.g. "Small Team Plan (Up to 5
-- Educators)" at a fixed seat count and price. A group_license purchase
-- made through the cart references one of these (license_product_id on
-- purchases below); admin-added purchases and Stripe's flexible-seat-count
-- licenses.html flow don't require one.
CREATE TABLE IF NOT EXISTS license_products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  seat_count INT UNSIGNED NOT NULL,
  price_cents INT UNSIGNED NOT NULL,
  call_for_quote TINYINT(1) NOT NULL DEFAULT 0, -- for large (1000+ seat) tiers with no fixed price — shows "Call For Quote" instead and can't be added to the self-service cart
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  auto_assign_group_id INT UNSIGNED NULL,
  bullet_points TEXT NULL,   -- newline-separated list items for the registration card (education-schools.html)
  footer_note VARCHAR(255) NULL, -- small footer line, e.g. "Valid for 12 months"
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Memberships (Consumers, Service Providers, Brand Ambassadors) — a separate
-- catalog/system from school licensing (license_products above). A contact
-- can hold more than one membership at once (e.g. a Service Provider who's
-- also a Brand Ambassador), so member type is derived from active
-- contact_memberships joined to membership_plans, not stored as a single
-- fixed attribute on the contact.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  member_type VARCHAR(32) NOT NULL, -- 'consumer' | 'service_provider' | 'brand_ambassador'
  price_cents INT UNSIGNED NOT NULL,
  regular_price_cents INT UNSIGNED NULL, -- shown struck-through as the "regular price" comparison; NULL if there's no intro-discount framing
  billing_interval VARCHAR(16) NOT NULL, -- 'one_time' | 'monthly' | 'annual'
  trial_days INT UNSIGNED NOT NULL DEFAULT 0,
  duration_days INT UNSIGNED NULL, -- how long one purchase/cycle lasts before expiring or renewing; NULL means no expiration is tracked. For 'one_time' plans this is the real membership length (e.g. 90). For 'monthly'/'annual' plans this is informational only (Stripe governs the actual billing cycle) — used to estimate contact_memberships.ends_at for admin display and to size the renewal-reminder window.
  description VARCHAR(1000),
  benefits TEXT, -- one bullet per line, shown as a checklist on the public pricing cards
  policy TEXT NULL, -- cancellation / refund / terms policy text, shown below benefits on public plan pages
  stripe_price_id VARCHAR(255) NULL, -- synced to a real Stripe Product+Price on save, once Stripe is configured
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per contact per membership they've held — a contact resubscribing
-- to the same plan later gets a new row rather than reusing an old one, so
-- history (e.g. a lapsed-then-renewed member) stays intact. purchase_id
-- links to the "order" this membership's most recent charge created (see
-- purchases.membership_plan_id below); recurring renewals create additional
-- purchases rows but don't change which contact_memberships row they belong to.
CREATE TABLE IF NOT EXISTS contact_memberships (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contact_id INT UNSIGNED NOT NULL,
  membership_plan_id INT UNSIGNED NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired'
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME NULL, -- current cycle/expiration estimate — set on grant/renewal from the plan's duration_days (or trial_days while trialing), advanced on each real charge, and set on cancellation. NULL if the plan has no duration_days configured.
  reminder_sent_at DATETIME NULL, -- guards against re-sending the renewal reminder every day until ends_at actually changes (renewal clears this)
  purchase_id INT UNSIGNED NULL,
  stripe_subscription_id VARCHAR(255) NULL,
  stripe_customer_id VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (membership_plan_id) REFERENCES membership_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per notification event the system can send automatically — a fixed
-- set (seeded by server/scripts/seed-email-automations.js), not admin-creatable,
-- since the *code* is what actually fires each one; the admin only edits
-- whether it's on and what it says. event_key is what server/lib/automations.js
-- looks up by.
CREATE TABLE IF NOT EXISTS email_automations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_key VARCHAR(64) NOT NULL UNIQUE, -- 'book_purchase_thank_you' | 'membership_purchase_thank_you' | 'membership_renewal_reminder' | 'invoice_paid' | 'payment_failed' | 'license_seat_invite'
  label VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  subject VARCHAR(255) NOT NULL,
  body TEXT NOT NULL, -- plain text with {{mergeField}} tokens; rendered as both text and simple HTML on send
  reminder_days_before INT UNSIGNED NULL, -- only meaningful for membership_renewal_reminder — how many days before contact_memberships.ends_at to send
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One invoice per Purchase Order submission, grouping together the purchase
-- rows (line items) it created. Generated automatically by
-- server/routes/checkout.js's create-po-order; viewed/printed from
-- admin-invoices.html / admin-invoice-print.html.
CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(32) UNIQUE,
  contact_id INT UNSIGNED NOT NULL,
  po_number VARCHAR(128) NULL,
  total_cents INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'unpaid', -- 'unpaid' | 'paid' | 'cancelled'
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL,
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Purchases — books, single teacher licenses, and group (school) licenses.
-- Created either manually by an admin, automatically from a real Stripe
-- Checkout payment, or immediately upon a Purchase Order order (payment
-- pending until an admin marks it paid) — see server/routes/checkout.js.
-- A contact is the buyer of record either way.
CREATE TABLE IF NOT EXISTS purchases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contact_id INT UNSIGNED NOT NULL,
  product_type VARCHAR(32) NOT NULL, -- 'book' | 'single_license' | 'group_license' | 'membership'
  book_id INT UNSIGNED NULL,
  license_product_id INT UNSIGNED NULL, -- set when bought from the cart against a fixed license_products tier
  membership_plan_id INT UNSIGNED NULL, -- set for product_type='membership' — each recurring renewal charge creates its own purchases row against the same plan, so this stays an "order" record, not the subscription itself (see contact_memberships)
  seat_count INT UNSIGNED NULL, -- 1 for single_license, N for group_license, NULL for book/membership
  purchased_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(64) NOT NULL DEFAULT 'Manual Entry',
  notes VARCHAR(500),
  stripe_session_id VARCHAR(255) NULL, -- set when created from a real Stripe payment; one session can now produce multiple purchase rows (a cart), so this is intentionally NOT unique — idempotency is checked by existence, not a DB constraint
  stripe_invoice_id VARCHAR(255) NULL UNIQUE, -- set for membership renewal charges (Stripe invoice.paid), where there's no checkout session to key off of — unique so a retried webhook can't double-record the same renewal
  school_domain VARCHAR(255) NULL, -- meaningful for group_license only — lets the admin look up a school's whole license block by domain instead of hunting for the buyer's CRM contact
  payment_method VARCHAR(16) NOT NULL DEFAULT 'manual', -- 'manual' | 'stripe' | 'po'
  payment_status VARCHAR(16) NOT NULL DEFAULT 'paid', -- 'paid' | 'pending' — POs start pending until an admin marks them paid; access is granted immediately either way
  po_number VARCHAR(128) NULL,
  invoice_id INT UNSIGNED NULL, -- set for PO-sourced purchases, grouping them under one invoices row
  amount_cents INT UNSIGNED NULL, -- snapshot of what was actually charged for this line item — prices can change later, so this preserves invoice accuracy
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY (license_product_id) REFERENCES license_products(id) ON DELETE SET NULL,
  FOREIGN KEY (membership_plan_id) REFERENCES membership_plans(id) ON DELETE SET NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per license seat (single_license purchases always have exactly one,
-- pre-filled with the buyer's own email). For group_license purchases, the
-- buyer (e.g. a school administrator) assigns invited_email to each open seat
-- as they hand access out to teachers; a seat becomes 'registered' the moment
-- a site_user signs up with that exact email.
CREATE TABLE IF NOT EXISTS license_seats (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT UNSIGNED NOT NULL,
  invited_email VARCHAR(255) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending' | 'registered'
  registered_site_user_id INT UNSIGNED NULL,
  registered_at DATETIME NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (registered_site_user_id) REFERENCES site_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tracks admin notification emails sent when a teacher's self-service
-- eligibility check fails (no seats, plan not active). The 24-hour
-- window on (school_domain, reason) prevents notification spam when many
-- teachers attempt registration in quick succession.
CREATE TABLE IF NOT EXISTS school_admin_notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_domain VARCHAR(255) NOT NULL,
  reason VARCHAR(64) NOT NULL, -- 'no_seats' | 'no_plan' | 'no_school'
  teacher_email VARCHAR(255) NOT NULL,
  admin_contact_id INT UNSIGNED NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_domain_reason_sent (school_domain, reason, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Email campaigns (real SMTP sending, one individual email per recipient)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campaigns (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  from_name VARCHAR(255) NOT NULL DEFAULT 'Fixer Nation',
  from_email VARCHAR(255) NOT NULL DEFAULT 'noreply@fixernationeducation.com',
  audience_status VARCHAR(32) NOT NULL DEFAULT 'Subscribed',
  audience_source VARCHAR(128) NOT NULL DEFAULT 'All',
  audience_group_id INT UNSIGNED NULL,
  body MEDIUMTEXT,
  body_format VARCHAR(16) NOT NULL DEFAULT 'text',
  status VARCHAR(16) NOT NULL DEFAULT 'Draft',
  sent_at DATETIME NULL,
  recipient_count INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (audience_group_id) REFERENCES contact_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per (campaign, recipient) attempt — previously sending only wrote
-- an aggregate recipient_count onto the campaigns row with no way to see who
-- got it, whether it opened, or whether an unsubscribe came from this send.
-- opened_at/open_count are pixel-based (see server/routes/campaigns.js
-- track-open route) so they're directional, not exact: many clients block
-- remote images (undercounts), and some (e.g. Apple Mail Privacy Protection)
-- prefetch every image regardless of whether a human opened it (overcounts).
CREATE TABLE IF NOT EXISTS campaign_sends (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NULL,
  email VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  -- 'sent': accepted by the SMTP relay. 'bounced': the relay gave a permanent
  -- (5xx) rejection at send time — e.g. mailbox doesn't exist. 'undelivered':
  -- a temporary (4xx) rejection or a connection-level failure (timeout, DNS,
  -- etc.) — the relay never gave a definitive answer either way. This only
  -- catches failures the relay reports immediately; a bounce that arrives
  -- later as a separate email (the more common real-world path) isn't caught
  -- without polling the mailbox for bounce notifications (not implemented).
  status VARCHAR(16) NOT NULL DEFAULT 'sent',
  error_message VARCHAR(500) NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_at DATETIME NULL,
  open_count INT UNSIGNED NOT NULL DEFAULT 0,
  clicked_at DATETIME NULL,
  click_count INT UNSIGNED NOT NULL DEFAULT 0,
  unsubscribed_at DATETIME NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every link in an HTML campaign's body is rewritten to route through
-- GET /api/campaigns/click?l=<link_id> — the real destination is looked up
-- here server-side rather than trusted from the request's query string, so
-- the public click endpoint can never be abused as an open redirect.
CREATE TABLE IF NOT EXISTS campaign_link_targets (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  send_id INT UNSIGNED NOT NULL,
  link_id VARCHAR(32) NOT NULL UNIQUE,
  destination_url VARCHAR(2048) NOT NULL,
  click_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (send_id) REFERENCES campaign_sends(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Curriculum builder
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curricula (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  series VARCHAR(255),
  short_description TEXT,
  overview TEXT,
  lessons_count INT UNSIGNED,
  weeks_count INT UNSIGNED,
  lesson_document VARCHAR(255),
  lesson_document_name VARCHAR(255),
  download_limit INT UNSIGNED NOT NULL DEFAULT 0,
  published TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_audiences (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  audience VARCHAR(64) NOT NULL,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_objectives (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  objective TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_materials (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  material TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_resources (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  resource VARCHAR(64) NOT NULL,
  file_path VARCHAR(512),
  file_name VARCHAR(255),
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_videos (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(512) NOT NULL,
  size_label VARCHAR(128),
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_quiz_questions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  question TEXT NOT NULL,
  correct_index INT UNSIGNED NOT NULL DEFAULT 0,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_quiz_options (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question_id INT UNSIGNED NOT NULL,
  option_text TEXT NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (question_id) REFERENCES curriculum_quiz_questions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS curriculum_downloads (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  curriculum_id INT UNSIGNED NOT NULL,
  teacher_email VARCHAR(255) NOT NULL,
  count INT UNSIGNED NOT NULL DEFAULT 0,
  last_download DATETIME NULL,
  FOREIGN KEY (curriculum_id) REFERENCES curricula(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_curriculum_teacher (curriculum_id, teacher_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Blog
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blog_posts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  author VARCHAR(255),
  category VARCHAR(64) NOT NULL, -- primary category, kept for backward compat; blog_post_categories below is the authoritative filterable set (a post can belong to several)
  featured_image VARCHAR(512),
  excerpt TEXT,
  body MEDIUMTEXT,
  video_url VARCHAR(512),
  video_file_name VARCHAR(255),
  video_file_size_label VARCHAR(128),
  alt_text VARCHAR(255), -- accessibility/SEO alt text for the featured image or video thumbnail
  meta_description VARCHAR(500), -- SEO meta description; falls back to excerpt if blank
  focus_keyword VARCHAR(255), -- SEO focus keyword (Wix's "add focus keyword to title tag/URL slug" step)
  requires_membership TINYINT(1) NOT NULL DEFAULT 0, -- gates the post behind an active Fixer Nation membership (any type) — replaces Wix's "Monetize" tab
  publish_date DATE,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  published TINYINT(1) NOT NULL DEFAULT 0, -- combined with publish_date: published=1 with a future publish_date is "Scheduled", not yet publicly visible
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blog_post_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  tag VARCHAR(128) NOT NULL,
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every category a post belongs to (a Morning Boost post is typically in
-- several at once: Morning Boost + Health + Positivity + Wellness, etc.) —
-- backfilled from each post's single `category` column when this table was
-- added, and the authoritative set going forward.
CREATE TABLE IF NOT EXISTS blog_post_categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  category VARCHAR(64) NOT NULL,
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The planned Theme/Series for each weekday's Morning Boost post, imported
-- from the 2026 content calendar — drives auto-prefill on admin-blogs.html
-- so the admin doesn't have to look up "what's this week's theme" by hand.
-- blog_post_id is set once a post is actually created from this entry.
CREATE TABLE IF NOT EXISTS morning_boost_calendar (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  boost_date DATE NOT NULL UNIQUE,
  theme VARCHAR(255) NOT NULL,
  series VARCHAR(255) NOT NULL,
  blog_post_id INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Morning Boost daily email automation
-- ---------------------------------------------------------------------------

-- Single-row configuration for the daily Morning Boost email broadcast.
-- id=1 is always the active config; upserted by the admin UI.
CREATE TABLE IF NOT EXISTS morning_boost_email_config (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  send_time TIME NOT NULL DEFAULT '07:00:00', -- local time to send each day
  send_timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York',
  from_name VARCHAR(255) NOT NULL DEFAULT 'Fixer Nation',
  from_email VARCHAR(255) NOT NULL DEFAULT '',
  reply_to VARCHAR(255) NULL,
  subject VARCHAR(255) NOT NULL DEFAULT 'Morning Boost — {{title}}',
  body TEXT NOT NULL DEFAULT '',
  body_format VARCHAR(8) NOT NULL DEFAULT 'html',
  cta_text VARCHAR(255) NOT NULL DEFAULT 'Read Today''s Morning Boost',
  cta_url_override VARCHAR(500) NULL, -- overrides the post URL when set
  fallback_message TEXT NULL, -- body to use when no MB post exists for the day
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL -- admin_users.id of the last editor
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which contact groups are included in Morning Boost distribution.
CREATE TABLE IF NOT EXISTS morning_boost_email_groups (
  config_id INT UNSIGNED NOT NULL,
  group_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (config_id, group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per daily distribution attempt (automated or manual).
CREATE TABLE IF NOT EXISTS morning_boost_sends (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  config_id INT UNSIGNED NULL,
  blog_post_id INT UNSIGNED NULL,
  boost_date DATE NOT NULL,
  scheduled_for DATETIME NOT NULL,
  sent_at DATETIME NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending' | 'sending' | 'completed' | 'failed' | 'skipped'
  subject VARCHAR(255) NULL,
  from_email VARCHAR(255) NULL,
  from_name VARCHAR(255) NULL,
  reply_to VARCHAR(255) NULL,
  cta_url VARCHAR(500) NULL,
  group_ids TEXT NULL, -- JSON array of group IDs used
  recipient_count INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count INT UNSIGNED NOT NULL DEFAULT 0,
  failed_count INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
  failure_reason TEXT NULL,
  is_resend TINYINT(1) NOT NULL DEFAULT 0,
  initiated_by INT UNSIGNED NULL, -- NULL = automated; set = manual trigger/resend by admin
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_boost_date (boost_date),
  FOREIGN KEY (blog_post_id) REFERENCES blog_posts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-recipient tracking row for each Morning Boost send.
CREATE TABLE IF NOT EXISTS morning_boost_send_recipients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  send_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NULL,
  email VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'failed' | 'skipped'
  error_message VARCHAR(500) NULL,
  sent_at DATETIME NULL,
  open_token VARCHAR(64) NULL UNIQUE,
  opened_at DATETIME NULL,
  click_token VARCHAR(64) NULL UNIQUE,
  clicked_at DATETIME NULL,
  INDEX idx_send (send_id),
  FOREIGN KEY (send_id) REFERENCES morning_boost_sends(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master, growing list of selectable blog tags (separate from the fixed FN_BLOG_CATEGORIES set).
CREATE TABLE IF NOT EXISTS blog_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag VARCHAR(128) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Quote requests
-- ---------------------------------------------------------------------------

-- Submissions of the "Request a Formal Quotation" form (education-portal.html)
-- — previously only emailed to admin@fixernationeducation.com with no
-- persistent record; stored here so they show up in dashboard stats.
CREATE TABLE IF NOT EXISTS quote_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  email VARCHAR(255) NOT NULL,
  school VARCHAR(255),
  phone VARCHAR(64),
  message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Visitor analytics (public site only — anonymous, session-based)
-- ---------------------------------------------------------------------------

-- A "session" is one browser tab's visit, identified by a random id the
-- client generates and holds in sessionStorage (so it clears when the tab
-- closes) — never tied to a logged-in identity, no IP address stored.
CREATE TABLE IF NOT EXISTS analytics_sessions (
  id VARCHAR(36) PRIMARY KEY,
  entry_page VARCHAR(512),
  referrer VARCHAR(512),
  user_agent VARCHAR(255),
  first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per pageview or tracked interaction within a session — the
-- ordered sequence of rows for one session_id is that visitor's "path".
CREATE TABLE IF NOT EXISTS analytics_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(32) NOT NULL, -- 'pageview' | 'book_view' | 'add_to_cart' | 'resource_open' | 'quiz_open' | 'quote_request' | 'ask_the_fixer' | 'contact_us'
  page VARCHAR(512),
  label VARCHAR(255), -- human-readable detail, e.g. a book title or resource name
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES analytics_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Site-wide admin-configurable settings (generic key/value store)
-- ---------------------------------------------------------------------------

-- Simple key/value store for small admin-editable config values that don't
-- warrant their own table — e.g. where "Ask The Fixer"/"Request a Quote"
-- form submissions get emailed. Absent keys fall back to a hardcoded
-- default in code (see server/lib/settings.js), so this table can stay
-- empty until an admin actually changes something.
CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fixer Nation database schema (MariaDB / MySQL)
-- Replaces the browser-localStorage demo described in PROJECT.md with real, shared storage.

CREATE TABLE IF NOT EXISTS admin_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  notes TEXT -- catch-all for rarely-populated imported fields (secondary email/phone, extra addresses, etc.) so bulk imports don't have to silently drop them
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contact groups, for categorizing contacts. A contact may belong to any
-- number of groups.
CREATE TABLE IF NOT EXISTS contact_groups (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
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
  description VARCHAR(500),
  seat_count INT UNSIGNED NOT NULL,
  price_cents INT UNSIGNED NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Purchases — books, single teacher licenses, and group (school) licenses.
-- Created either manually by an admin, automatically from a real Stripe
-- Checkout payment, or immediately upon a Purchase Order order (payment
-- pending until an admin marks it paid) — see server/routes/checkout.js.
-- A contact is the buyer of record either way.
CREATE TABLE IF NOT EXISTS purchases (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  contact_id INT UNSIGNED NOT NULL,
  product_type VARCHAR(32) NOT NULL, -- 'book' | 'single_license' | 'group_license'
  book_id INT UNSIGNED NULL,
  license_product_id INT UNSIGNED NULL, -- set when bought from the cart against a fixed license_products tier
  seat_count INT UNSIGNED NULL, -- 1 for single_license, N for group_license, NULL for book
  purchased_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(64) NOT NULL DEFAULT 'Manual Entry',
  notes VARCHAR(500),
  stripe_session_id VARCHAR(255) NULL, -- set when created from a real Stripe payment; one session can now produce multiple purchase rows (a cart), so this is intentionally NOT unique — idempotency is checked by existence, not a DB constraint
  school_domain VARCHAR(255) NULL, -- meaningful for group_license only — lets the admin look up a school's whole license block by domain instead of hunting for the buyer's CRM contact
  payment_method VARCHAR(16) NOT NULL DEFAULT 'manual', -- 'manual' | 'stripe' | 'po'
  payment_status VARCHAR(16) NOT NULL DEFAULT 'paid', -- 'paid' | 'pending' — POs start pending until an admin marks them paid; access is granted immediately either way
  po_number VARCHAR(128) NULL,
  FOREIGN KEY (contact_id) REFERENCES newsletter_contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL,
  FOREIGN KEY (license_product_id) REFERENCES license_products(id) ON DELETE SET NULL
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

-- ---------------------------------------------------------------------------
-- Curriculum builder
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curricula (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  series VARCHAR(255),
  short_description TEXT,
  overview TEXT,
  estimated_duration VARCHAR(128),
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
  category VARCHAR(64) NOT NULL,
  featured_image VARCHAR(512),
  excerpt TEXT,
  body MEDIUMTEXT,
  video_url VARCHAR(512),
  video_file_name VARCHAR(255),
  video_file_size_label VARCHAR(128),
  publish_date DATE,
  featured TINYINT(1) NOT NULL DEFAULT 0,
  published TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blog_post_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  post_id INT UNSIGNED NOT NULL,
  tag VARCHAR(128) NOT NULL,
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Master, growing list of selectable blog tags (separate from the fixed FN_BLOG_CATEGORIES set).
CREATE TABLE IF NOT EXISTS blog_tags (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tag VARCHAR(128) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

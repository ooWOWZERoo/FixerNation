const pool = require('../db/pool');

// Defaults used when a key has never been set — keeps the settings table
// empty until an admin actually changes something, and keeps existing
// behavior (email admin@fixernationeducation.com) unchanged until they do.
const DEFAULTS = {
  contact_email_ask_the_fixer: 'admin@fixernationeducation.com',
  contact_email_quote: 'admin@fixernationeducation.com',
  contact_email_privacy: 'admin@fixernationeducation.com',
  contact_email_general: 'admin@fixernationeducation.com',
  // Where a new support request is announced, and the Reply-To on staff replies. See routes/support.js.
  contact_email_support: 'admin@fixernationeducation.com',
  // Real-time "money moved" staff alerts (quote accepted, new paid order,
  // PO submitted and awaiting Mark Received) — see mailer.js's
  // sendSalesAlertEmail(). Distinct from contact_email_quote, which only
  // routes *inbound* quote-request form submissions.
  contact_email_sales_alerts: 'admin@fixernationeducation.com',
  invoice_business_name: 'Fixer Nation Education',
  invoice_tagline: 'fixernationeducation.com',
  invoice_logo_url: '',
  // The logo in the public site header (nav.js) and footer (footer.js). Empty means the built-in logo-fne.png. See routes/settings.js.
  website_logo_url: '',
  teacher_lesson_plan_limit: '40',
  // Default trial-teacher library limit — used two ways: (1) as the
  // fallback for any trial purchase with no trial_library_limit snapshot of
  // its own (e.g. one created before this field existed), so an existing
  // trial doesn't silently fall through to the full-license default of 40;
  // and (2) to pre-fill a license product's own trial_library_limit field
  // the moment "Trial?" is checked on it in admin-licenses.html (a one-time
  // client-side pre-fill — the product's own field, once saved, is what
  // actually gets snapshotted onto purchases going forward).
  teacher_lesson_plan_limit_trial: '10',
  // How many times a teacher may take a lesson out of My Lesson Plans (removing it, or swapping it for another). Each removal
  // uses one. 0 turns removal off. One value for trial and paid teachers alike. See routes/teacher-lesson-plans.js.
  teacher_lesson_plan_swap_limit: '3',
  // Graduate Evidence: the smallest group of students any school or district view will show a figure for (never below 5). See routes/pog-evidence.js.
  pog_evidence_min_group: '10',
  // How large campaign sends get throttled — see processCampaignBatch() in
  // server/routes/campaigns.js. Sending the entire audience in one
  // uninterrupted burst risks getting flagged as spam/abuse by receiving
  // providers (or rate-capped by this host's own SMTP relay); batching
  // spreads a large send out over multiple cron ticks instead. A campaign
  // smaller than one batch is unaffected — it still goes out immediately.
  campaign_batch_size: '60',
  campaign_batch_interval_minutes: '60',
  // Tune Your Brain learning-event retention window, in days — provisional
  // default (~13 months, a school year plus a summer buffer). See D3 in
  // docs/tune-your-brain/LEADERSHIP_DECISIONS_REQUIRED.md. Adjustable here
  // with no schema change; enforced by scripts/purge-learning-events.js.
  learning_events_retention_days: '400',
  // Admin pages that show student names hide them after this many minutes without a mouse move, click or key press. See
  // admin-privacy-lock.js and docs/reference/support-console-requirements.md.
  admin_privacy_lock_minutes: '5',
  // District Program Use Report (docs/reference/district-program-report-requirements.md): a classroom is "in regular use" in a month when
  // students finished activities in at least this many different weeks; a school is flagged when under this percent of its classrooms were
  // in regular use last month; schools with fewer activated teachers than the minimum hide every teacher and classroom figure.
  program_report_regular_weeks: '3',
  program_report_low_use_pct: '50',
  program_report_min_teachers: '5',
  // Shared demo environment (docs/reference/shared-demo-environment-requirements.md). The demo is open only while the switch is 'true' AND the
  // end time (an ISO UTC string) is in the future: see lib/public-demo.js. It is off by default and stays off after any deploy.
  public_demo_enabled: 'false',
  public_demo_ends_at: '',
  public_demo_access_code: '',
  public_demo_password: '',
  public_demo_pin: '',
  public_demo_code_version: '1',
  // Counts the demo's windows (each fresh turn-on starts a new one). Requests and sign-ins from the demo are tagged with the window they happened in.
  public_demo_window_id: '0',
  public_demo_max_days: '30',
};

async function getSetting(key) {
  const [rows] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  return rows[0] ? rows[0].setting_value : (DEFAULTS[key] || null);
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
    [key, value, value]
  );
}

module.exports = { getSetting, setSetting, DEFAULTS };

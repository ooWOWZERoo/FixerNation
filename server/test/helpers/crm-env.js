// Shared setup for the Sales CRM tests: an in-memory SQLite database holding just the tables the CRM touches, a mysql2-shaped query wrapper, stubs for the
// database pool / admin auth / mail, and a tiny HTTP client. Each test file runs in its own process, so installing the stubs here is safe.
// Keep any SQL the CRM runs portable (no NOW(), no ON DUPLICATE KEY): that is what lets these tests run on a real SQL engine without a MariaDB server.
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const { DatabaseSync } = require('node:sqlite');
require('express-async-errors');

const SERVER = path.join(__dirname, '..', '..');

const SCHEMA = `
CREATE TABLE admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, email TEXT, email_verified INTEGER NOT NULL DEFAULT 1, crm_role TEXT NOT NULL DEFAULT 'admin', password_hash TEXT DEFAULT 'x');
CREATE TABLE settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
CREATE TABLE newsletter_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT NOT NULL UNIQUE, phone TEXT, company TEXT, state TEXT, signup_date TEXT DEFAULT '2026-01-01 00:00:00',
  source TEXT DEFAULT 'Homepage', status TEXT NOT NULL DEFAULT 'Subscribed',
  crm_classification TEXT NOT NULL DEFAULT 'suspect', classification_updated_at TEXT, classification_locked INTEGER NOT NULL DEFAULT 0,
  assigned_admin_id INTEGER, last_contacted_at TEXT, crm_source TEXT);
CREATE TABLE license_products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_trial INTEGER NOT NULL DEFAULT 0);
CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, product_type TEXT DEFAULT 'group_license', license_product_id INTEGER,
  payment_status TEXT NOT NULL DEFAULT 'paid', payment_method TEXT DEFAULT 'manual', amount_cents INTEGER, trial_lesson_limit INTEGER, trial_expiration_date TEXT,
  purchased_at TEXT DEFAULT '2026-01-01 00:00:00', license_status TEXT DEFAULT 'active', quote_id INTEGER, invoice_id INTEGER, school_id INTEGER, po_number TEXT);
CREATE TABLE quote_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_number TEXT, email TEXT NOT NULL, status TEXT DEFAULT 'new', accept_token TEXT,
  quoted_amount_cents INTEGER, quote_sent_at TEXT, quote_valid_until TEXT, accepted_at TEXT, contact_id INTEGER, opportunity_id INTEGER,
  first_name TEXT, last_name TEXT, school TEXT, quoted_product_name TEXT, created_at TEXT DEFAULT '2026-01-01 00:00:00', demo_invitation_id INTEGER NOT NULL DEFAULT 0,
  revision_number INTEGER NOT NULL DEFAULT 1, supersedes_quote_id INTEGER, version_status TEXT NOT NULL DEFAULT 'current', created_by_admin_id INTEGER, accepted_payment_method TEXT,
  acceptance_name TEXT, acceptance_title TEXT, acceptance_terms_version TEXT, acceptance_document_hash TEXT, acceptance_recorded_at TEXT, acceptance_recorded_by TEXT,
  phone TEXT, message TEXT, origin TEXT, quoted_product_id INTEGER, quoted_tier_name TEXT, quoted_seat_count INTEGER, quoted_addon_seats INTEGER, quoted_term_years INTEGER, quoted_school_domain TEXT,
  quoted_at TEXT, quote_sent_via TEXT, content_profile_id INTEGER, notes TEXT, bill_to_street TEXT, bill_to_city TEXT, bill_to_state TEXT, bill_to_zip TEXT,
  ship_to_name TEXT, ship_to_company TEXT, ship_to_street TEXT, ship_to_city TEXT, ship_to_state TEXT, ship_to_zip TEXT);
CREATE TABLE quote_content_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, is_default INTEGER DEFAULT 0, section_annual_includes TEXT, section_lesson_package TEXT, section_video_access TEXT, section_license_terms TEXT);
CREATE TABLE crm_quote_events (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, opportunity_id INTEGER, event_type TEXT NOT NULL, detail TEXT, actor_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE site_users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, closed_at TEXT);
CREATE TABLE contact_group_members (contact_id INTEGER NOT NULL, group_id INTEGER NOT NULL, PRIMARY KEY (contact_id, group_id));
CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT, contact_id INTEGER NOT NULL, status TEXT DEFAULT 'unpaid', created_at TEXT DEFAULT '2026-01-01 00:00:00', po_received_date TEXT);
CREATE TABLE schools (id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, district_id INTEGER, display_name TEXT);
CREATE TABLE districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
CREATE TABLE school_audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_type TEXT, actor_id INTEGER, actor_email TEXT, action TEXT, entity_type TEXT, entity_id INTEGER,
  purchase_id INTEGER, school_domain TEXT, prev_value TEXT, new_value TEXT, reason TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_pipeline_stages (id INTEGER PRIMARY KEY AUTOINCREMENT, stage_key TEXT UNIQUE, label TEXT, sort_order INTEGER, default_probability INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE crm_loss_reasons (id INTEGER PRIMARY KEY AUTOINCREMENT, reason_key TEXT UNIQUE, label TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
CREATE TABLE crm_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, account_type TEXT NOT NULL DEFAULT 'school', website_domain TEXT, state TEXT,
  assigned_admin_id INTEGER, source TEXT, parent_account_id INTEGER, school_id INTEGER UNIQUE, district_id INTEGER UNIQUE, description TEXT, archived_at TEXT,
  created_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_account_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, title TEXT, is_primary INTEGER DEFAULT 0,
  is_champion INTEGER DEFAULT 0, is_decision_maker INTEGER DEFAULT 0, is_procurement INTEGER DEFAULT 0, is_finance INTEGER DEFAULT 0, started_on TEXT, ended_on TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (account_id, contact_id));
CREATE TABLE crm_opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, owner_admin_id INTEGER, stage_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'open', stage_entered_at TEXT DEFAULT CURRENT_TIMESTAMP, primary_contact_id INTEGER, opp_type TEXT NOT NULL DEFAULT 'new_business',
  amount_cents INTEGER, source TEXT, product_focus TEXT, expected_close_date TEXT, target_implementation_date TEXT, probability_override INTEGER, next_step TEXT,
  next_step_due_at TEXT, loss_reason_id INTEGER, competitor TEXT, reengage_on TEXT, closed_at TEXT, renewal_of_purchase_id INTEGER, created_by_admin_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_opportunity_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'other',
  influence TEXT, stance TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (opportunity_id, contact_id));
CREATE TABLE crm_opportunity_stage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, from_stage_id INTEGER, to_stage_id INTEGER NOT NULL,
  from_state TEXT, to_state TEXT NOT NULL, actor_admin_id INTEGER, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_classification_events (id INTEGER PRIMARY KEY AUTOINCREMENT, contact_id INTEGER NOT NULL, from_classification TEXT, to_classification TEXT NOT NULL,
  event_type TEXT NOT NULL, source_ref TEXT, actor_admin_id INTEGER, reason TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE support_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, status TEXT DEFAULT 'new', category TEXT DEFAULT 'other', subject TEXT, requester_name TEXT, requester_email TEXT,
  school_domain TEXT, created_at TEXT DEFAULT '2026-01-01 00:00:00', demo_invitation_id INTEGER NOT NULL DEFAULT 0);
CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT);
CREATE TABLE campaign_sends (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign_id INTEGER NOT NULL, contact_id INTEGER, email TEXT, status TEXT DEFAULT 'sent', sent_at TEXT DEFAULT '2026-01-01 00:00:00', opened_at TEXT, clicked_at TEXT);
CREATE TABLE public_demo_invitations (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, workspace_id INTEGER, status TEXT DEFAULT 'ended', starts_at TEXT, ends_at TEXT, ended_at TEXT);
CREATE TABLE crm_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER, account_id INTEGER, contact_id INTEGER, title TEXT NOT NULL, details TEXT, due_on TEXT, state TEXT NOT NULL DEFAULT 'open',
  assigned_admin_id INTEGER, created_by_admin_id INTEGER, completed_at TEXT, completed_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER, account_id INTEGER, contact_id INTEGER, kind TEXT NOT NULL DEFAULT 'note', body TEXT NOT NULL,
  created_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER, account_id INTEGER, contact_id INTEGER, original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL, mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, uploaded_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER, account_id INTEGER, contact_id INTEGER, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  location TEXT, details TEXT, status TEXT NOT NULL DEFAULT 'scheduled', uid TEXT NOT NULL UNIQUE, sequence_no INTEGER NOT NULL DEFAULT 0, attendees_json TEXT, organizer_admin_id INTEGER,
  invite_sent_at TEXT, invite_sequence INTEGER, created_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_procurement_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, description TEXT, items_json TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
  created_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_opportunity_checklist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL, template_id INTEGER, label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  due_on TEXT, note TEXT, sort_order INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by_admin_id INTEGER, created_by_admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_attention_states (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id INTEGER NOT NULL, state TEXT NOT NULL, snooze_until TEXT,
  fingerprint TEXT NOT NULL DEFAULT '', reason TEXT, admin_id INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (rule_key, subject_type, subject_id));
CREATE TABLE crm_attention_events (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id INTEGER NOT NULL, fingerprint TEXT NOT NULL DEFAULT '',
  owner_admin_id INTEGER, first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, emailed_at TEXT, UNIQUE (rule_key, subject_type, subject_id, fingerprint));
`;

const STAGES = [['new_inquiry', 'New Inquiry', 10, 5], ['qualified', 'Qualified', 20, 15], ['discovery', 'Discovery', 30, 25], ['demo_evaluation', 'Demo / Evaluation', 40, 40],
  ['proposal_sent', 'Proposal / Quote Sent', 50, 55], ['procurement', 'Procurement / Review', 60, 70], ['verbal_commitment', 'Verbal Commitment', 70, 85], ['won', 'Won', 80, 100]];
const REASONS = [['no_budget', 'No budget'], ['chose_competitor', 'Chose a competitor'], ['other', 'Other']];

function makeDb({ withCrmTables = true } = {}) {
  const db = new DatabaseSync(':memory:');
  if (withCrmTables) db.exec(SCHEMA);
  else db.exec(SCHEMA.split('CREATE TABLE crm_pipeline_stages')[0]);
  if (withCrmTables) {
    for (const [k, l, s, p] of STAGES) db.prepare('INSERT INTO crm_pipeline_stages (stage_key, label, sort_order, default_probability) VALUES (?, ?, ?, ?)').run(k, l, s, p);
    for (const [k, l] of REASONS) db.prepare('INSERT INTO crm_loss_reasons (reason_key, label) VALUES (?, ?)').run(k, l);
  }
  // mysql2 expands an array parameter (IN (?)); SQLite does not, so do it here. A UNIQUE failure maps to the code MariaDB reports.
  const run = async (sql, rawParams = []) => {
    let i = 0;
    const params = [];
    const s = sql.trim().replace(/\bNOW\(\)/g, 'CURRENT_TIMESTAMP').replace(/\bINSERT IGNORE\b/gi, 'INSERT OR IGNORE').replace(/\s+FOR UPDATE\s*$/i, '').replace(/\?/g, () => {
      const p = rawParams[i++];
      if (Array.isArray(p)) { params.push(...p); return p.map(() => '?').join(','); }
      params.push(p === undefined ? null : p);
      return '?';
    });
    try {
      if (/^SELECT/i.test(s)) return [db.prepare(s).all(...params)];
      const r = db.prepare(s).run(...params);
      return [{ insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) }];
    } catch (e) {
      if (/UNIQUE constraint failed/.test(e.message)) e.code = 'ER_DUP_ENTRY';
      if (/no such table/.test(e.message)) e.code = 'ER_NO_SUCH_TABLE';
      if (/no such column|has no column named/.test(e.message)) e.code = 'ER_BAD_FIELD_ERROR';
      throw e;
    }
  };
  const conn = { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  return { db, run, conn, pool: { query: run, getConnection: async () => conn } };
}

// Installs the stubs. requireAuth reads the acting admin from the x-admin header (the real one reads the admin cookie).
function install(pool, extraStubs = {}) {
  const stubs = {
    [path.join(SERVER, 'db/pool.js')]: pool,
    [path.join(SERVER, 'middleware/auth.js')]: {
      requireAuth: (req, res, next) => {
        const id = Number(req.headers['x-admin']);
        if (!id) return res.status(401).json({ error: 'Unauthorized' });
        req.user = { userId: id, username: `admin${id}` };
        next();
      },
      getAuthUser: () => null,
    },
    [path.join(SERVER, 'lib/rate-limit.js')]: { limiter: () => (req, res, next) => next(), clientIp: () => '127.0.0.1', FailureTracker: class { }, rejectIfBlocked: () => false },
    [path.join(SERVER, 'lib/mailer.js')]: new Proxy({}, { get: () => async () => {} }),
    ...extraStubs,
  };
  const origLoad = Module._load;
  Module._load = function (request, parent) {
    try { const f = Module._resolveFilename(request, parent); if (stubs[f]) return stubs[f]; } catch { /* default */ }
    return origLoad.apply(this, arguments);
  };
}

function listen(mounts) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const [mount, router] of mounts) app.use(mount, router);
  app.use((err, req, res, next) => res.status(500).json({ error: String(err.message) }));
  const server = app.listen(0);
  const port = server.address().port;
  function call(method, p, body, adminId) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const headers = { 'Content-Type': 'application/json' };
      if (adminId) headers['x-admin'] = String(adminId);
      if (data) headers['Content-Length'] = Buffer.byteLength(data);
      const req = http.request({ port, method, path: p, headers }, (res) => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => { let json = null; try { json = JSON.parse(b); } catch { /* not json */ } resolve({ status: res.statusCode, json }); });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
  return { server, call };
}

const addAdmin = (db, username, role = 'admin', { email = `${username}@example.com`, verified = 1 } = {}) =>
  Number(db.prepare('INSERT INTO admin_users (username, email, email_verified, crm_role) VALUES (?, ?, ?, ?)').run(username, email, verified, role).lastInsertRowid);
const addContact = (db, email, name = 'Test Person', extra = {}) => {
  const r = db.prepare('INSERT INTO newsletter_contacts (name, email, status) VALUES (?, ?, ?)').run(name, email, extra.status || 'Subscribed');
  return Number(r.lastInsertRowid);
};
const addPurchase = (db, contactId, f = {}) =>
  Number(db.prepare(`INSERT INTO purchases (contact_id, license_product_id, payment_status, payment_method, amount_cents, trial_lesson_limit, trial_expiration_date, quote_id, invoice_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contactId, f.productId || null, f.paymentStatus || 'paid', f.method || 'manual', f.amountCents === undefined ? 10000 : f.amountCents,
    f.trialLessonLimit === undefined ? null : f.trialLessonLimit, f.trialExpirationDate || null, f.quoteId || null, f.invoiceId || null).lastInsertRowid);
const addQuote = (db, email, f = {}) =>
  Number(db.prepare('INSERT INTO quote_requests (quote_number, email, status, accept_token, quoted_amount_cents, contact_id, opportunity_id, first_name, last_name, school, quoted_product_name, quote_sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(f.number || '123456', email, f.status || 'new', 'secret-token-value', f.amountCents === undefined ? null : f.amountCents, f.contactId || null, f.opportunityId || null,
      f.firstName || 'Pat', f.lastName || 'Example', f.school === undefined ? 'Sample Elementary' : f.school, f.product || 'Group license', f.sentAt || null).lastInsertRowid);
const enable = (db, on = true) => db.prepare('INSERT OR REPLACE INTO settings (setting_key, setting_value) VALUES (?, ?)').run('crm_v2_enabled', on ? 'true' : 'false');
const classOf = (db, id) => db.prepare('SELECT crm_classification AS c FROM newsletter_contacts WHERE id = ?').get(id).c;

module.exports = { SERVER, makeDb, install, listen, addAdmin, addContact, addPurchase, addQuote, enable, classOf };

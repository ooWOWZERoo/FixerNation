// Support requests, the person's side (Release 115). Staff side: routes/admin-support.js.
// Requirements and access matrix: docs/reference/support-requests-requirements.md
//
//   POST /api/support                    anyone (signed in or not): open a request. Rate limited.
//   GET  /api/support/context            who the form will say you are (signed-in only fields)
//   GET  /api/support/mine               signed-in: my own requests
//   GET  /api/support/mine/:id           signed-in: one of my requests and the replies meant for me
//   POST /api/support/mine/:id/messages  signed-in: add to one of my requests
//
// Students (PIN login) have no route here by design. Role, school and district are looked up from the account, never taken from
// the form. Internal staff notes are never selected by a query on this side.
const express = require('express');
const pool = require('../db/pool');
const { getSiteUser } = require('../lib/site-user');
const { limiter, clientIp } = require('../lib/rate-limit');
const { getSetting } = require('../lib/settings');
const { sendSalesAlertEmail, sendSupportEmail } = require('../lib/mailer');
const { CATEGORIES, LIMITS, EMAIL_PATTERN, cleanText, resolveContext, addMessage, createRequest } = require('../lib/support');

const router = express.Router();

const siteUrl = () => process.env.SITE_URL || '';
const ipLimit = limiter({ name: 'support-ip', windowMs: 3600000, max: 10 });
const emailLimit = limiter({
  name: 'support-email', windowMs: 3600000, max: 5,
  key: (req) => (req.body && typeof req.body.email === 'string' && req.body.email.trim() ? req.body.email.trim().toLowerCase() : null),
});
const followUpLimit = limiter({ name: 'support-followup', windowMs: 3600000, max: 20, key: clientIp });

function demoRefused(user) {
  return user && user.is_sales_demo ? 'Demo accounts cannot send support requests.' : null;
}

async function requireSignedIn(req, res) {
  const user = await getSiteUser(req);
  if (!user) { res.status(401).json({ error: 'Please sign in to see your requests.' }); return null; }
  return user;
}

// Tells staff, by email, that something arrived. A failed email never blocks the person's request (it is saved either way).
async function tellStaff({ subject, fields, id }) {
  try {
    await sendSalesAlertEmail({
      to: await getSetting('contact_email_support'),
      subject,
      fields,
      linkUrl: `${siteUrl()}/admin-support.html?id=${id}`,
      linkLabel: 'Open in the support inbox',
    });
  } catch (err) {
    console.error('support: staff notice failed:', err.message);
  }
}

// GET /api/support/context
router.get('/context', async (req, res) => {
  const user = await getSiteUser(req);
  if (!user) return res.json({ signedIn: false });
  if (user.is_sales_demo) return res.json({ signedIn: true, demo: true });
  const context = await resolveContext(user);
  res.json({ signedIn: true, name: `${user.first_name} ${user.last_name}`.trim(), email: user.email, roles: context.roles });
});

// POST /api/support -- body: { name, email, category, subject, message, pageUrl, website }. `website` is a hidden trap for form-filling bots.
router.post('/', ipLimit, emailLimit, async (req, res) => {
  const body = req.body || {};
  if (typeof body.website === 'string' && body.website.trim()) return res.json({ ok: true }); // a bot filled the hidden field; pretend it worked

  const user = await getSiteUser(req);
  const demo = demoRefused(user);
  if (demo) return res.status(403).json({ error: demo });

  const who = user
    ? { name: `${user.first_name} ${user.last_name}`.trim(), email: user.email }
    : { name: cleanText(body.name, LIMITS.name), email: cleanText(body.email, LIMITS.email).toLowerCase() };
  if (!who.name) return res.status(400).json({ error: 'Please tell us your name.' });
  if (!EMAIL_PATTERN.test(who.email)) return res.status(400).json({ error: 'Please enter a valid email address so we can reply.' });

  const message = cleanText(body.message, LIMITS.message);
  if (!message) return res.status(400).json({ error: 'Please tell us what is happening.' });
  const category = typeof body.category === 'string' && CATEGORIES[body.category] ? body.category : 'other';
  const subject = cleanText(body.subject, LIMITS.subject) || CATEGORIES[category];

  const context = user ? await resolveContext(user) : null;
  const created = await createRequest({
    who, category, subject, message,
    pageUrl: cleanText(body.pageUrl, LIMITS.pageUrl),
    userAgent: cleanText(req.headers['user-agent'], LIMITS.userAgent),
    siteUserId: user ? user.id : null,
    context,
  });

  await tellStaff({
    subject: `New support request ${created.ref}`,
    id: created.id,
    fields: {
      Reference: created.ref,
      Topic: CATEGORIES[category],
      From: who.name,
      Email: who.email,
      'Signed in as': context ? context.roles : 'Not signed in',
      School: context && context.schoolDomain,
      Subject: subject,
      Message: message.length > 800 ? message.slice(0, 800) + '...' : message,
    },
  });
  try {
    await sendSupportEmail({
      to: who.email, name: who.name, ref: created.ref, subject: 'We got your request',
      intro: 'Thanks for reaching out. We have your request and will reply by email. Here is what you sent us:',
      body: message,
      replyTo: await getSetting('contact_email_support'),
    });
  } catch (err) {
    console.error('support: confirmation email failed:', err.message);
  }
  res.json({ ok: true, ref: created.ref });
});

// GET /api/support/mine
router.get('/mine', async (req, res) => {
  const user = await requireSignedIn(req, res);
  if (!user) return;
  const [rows] = await pool.query(
    'SELECT id, ref, status, category, subject, created_at, updated_at FROM support_requests WHERE site_user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100',
    [user.id]
  );
  res.json({ requests: rows.map(r => ({ ...r, categoryLabel: CATEGORIES[r.category] || CATEGORIES.other })) });
});

async function ownRequest(req, res, user) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(404).json({ error: 'Not found' }); return null; }
  const [[row]] = await pool.query(
    'SELECT id, ref, status, category, subject, created_at, updated_at FROM support_requests WHERE id = ? AND site_user_id = ?',
    [id, user.id]
  );
  if (!row) { res.status(404).json({ error: 'Not found' }); return null; }
  return row;
}

// GET /api/support/mine/:id
router.get('/mine/:id', async (req, res) => {
  const user = await requireSignedIn(req, res);
  if (!user) return;
  const row = await ownRequest(req, res, user);
  if (!row) return;
  const [messages] = await pool.query(
    "SELECT id, author_type, body, created_at FROM support_request_messages WHERE request_id = ? AND visibility = 'public' ORDER BY created_at, id",
    [row.id]
  );
  res.json({ request: { ...row, categoryLabel: CATEGORIES[row.category] || CATEGORIES.other }, messages });
});

// POST /api/support/mine/:id/messages -- body: { message }
router.post('/mine/:id/messages', followUpLimit, async (req, res) => {
  const user = await requireSignedIn(req, res);
  if (!user) return;
  const demo = demoRefused(user);
  if (demo) return res.status(403).json({ error: demo });
  const row = await ownRequest(req, res, user);
  if (!row) return;
  const message = cleanText((req.body || {}).message, LIMITS.message);
  if (!message) return res.status(400).json({ error: 'Please write a message.' });

  await addMessage(row.id, { authorType: 'requester', body: message });
  // An answer from the person puts a resolved or waiting request back in front of staff; a brand-new one stays new.
  if (row.status === 'resolved' || row.status === 'waiting_on_user') {
    await pool.query("UPDATE support_requests SET status = 'open', resolved_at = NULL WHERE id = ?", [row.id]);
  } else {
    await pool.query('UPDATE support_requests SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
  }
  await tellStaff({
    subject: `New reply on support request ${row.ref}`,
    id: row.id,
    fields: { Reference: row.ref, From: `${user.first_name} ${user.last_name}`.trim(), Subject: row.subject, Message: message.length > 800 ? message.slice(0, 800) + '...' : message },
  });
  res.json({ ok: true });
});

module.exports = router;

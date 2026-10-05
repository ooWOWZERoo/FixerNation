// White-glove "concierge" admin actions — lets an FNE admin carry a quote
// all the way through to a working license on a customer's behalf (phone/
// email deals), reusing the exact same logic the customer's own self-service
// flow uses rather than duplicating it:
//   - accepting a quote via Purchase Order -> acceptQuoteViaPO() in
//     server/routes/quote-accept.js (the School License Administrator
//     assignment that comes with it is part of that same function)
//   - inviting a teacher -> inviteTeacherToSeat() in
//     server/lib/teacher-invitations.js
//   - district branding (colors/logo/publish) -> the same
//     server/lib/branding-editor.js district-admin-branding.html itself
//     calls, just under requireAuth instead of requireDistrictAdmin, and
//     with updatedBy left NULL (the FNE admin session here is a one-off JWT,
//     not a site_users row, so there's no real site_user id to attribute it
//     to). Crop is deliberately NOT exposed here — concierge's job is
//     getting a reasonable starting look live, not pixel-perfect framing;
//     the district admin can always refine the crop themselves later from
//     their own portal once handed off.
// District Administrator ASSIGNMENT and marking a PO received are NOT
// duplicated here at all — admin-districts.html and admin-invoices.html
// already do those, unchanged; admin-concierge.html just links to them.
//
// Card payment is deliberately out of scope here (PCI/compliance) — a
// card-paying customer always completes their own checkout via the existing
// accept-quote.html link, never through an admin action.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { acceptQuoteViaPO } = require('./quote-accept');
const { inviteTeacherToSeat } = require('../lib/teacher-invitations');
const {
  logoUpload,
  getRow: getBrandingRow,
  upsertDraftColors,
  processLogoUpload,
  publishBranding,
  resetBranding,
} = require('../lib/branding-editor');

const router = express.Router();

// GET /api/admin/concierge/quotes/:quoteId — everything the concierge page
// needs to render current state in one call: the quote itself, whether it's
// been accepted (and the resulting purchase/invoice), whether a School
// License Administrator is already assigned, whether the contact holds any
// active District Administrator assignment, and the current teacher roster
// for the purchase (so invited/registered teachers show immediately).
router.get('/quotes/:quoteId', requireAuth, async (req, res) => {
  const [[quote]] = await pool.query('SELECT * FROM quote_requests WHERE id = ?', [req.params.quoteId]);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });

  const [[purchase]] = await pool.query(
    `SELECT p.id, p.invoice_id, p.license_status, p.payment_status, p.po_number, p.school_domain, p.seat_count,
            i.invoice_number, i.status AS invoice_status
     FROM purchases p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE p.quote_id = ? ORDER BY p.id DESC LIMIT 1`,
    [quote.id]
  );

  let schoolAdmin = null;
  let districtAdmin = null;
  let seats = [];
  if (purchase) {
    const [[sla]] = await pool.query(
      `SELECT sla.id, sla.permission_level, su.first_name, su.last_name, su.email
       FROM school_license_admins sla JOIN site_users su ON su.id = sla.site_user_id
       WHERE sla.purchase_id = ? AND sla.is_active = 1 LIMIT 1`,
      [purchase.id]
    );
    schoolAdmin = sla || null;

    const [[site]] = await pool.query('SELECT id FROM site_users WHERE email = ?', [(quote.email || '').toLowerCase()]);
    if (site) {
      const [[dla]] = await pool.query(
        `SELECT dla.id, d.id AS district_id, d.name AS district_name
         FROM district_license_admins dla JOIN districts d ON d.id = dla.district_id
         WHERE dla.site_user_id = ? AND dla.is_active = 1 LIMIT 1`,
        [site.id]
      );
      districtAdmin = dla || null;
    }

    const [seatRows] = await pool.query(
      `SELECT ls.id, ls.status, ls.invited_email, si.first_name AS invitation_first_name, si.last_name AS invitation_last_name
       FROM license_seats ls
       LEFT JOIN school_invitations si ON si.seat_id = ls.id
       WHERE ls.purchase_id = ? AND ls.status <> 'available'
       ORDER BY ls.id DESC`,
      [purchase.id]
    );
    seats = seatRows;
  }

  res.json({
    quote: {
      id: quote.id,
      quoteNumber: quote.quote_number,
      firstName: quote.first_name,
      lastName: quote.last_name,
      email: quote.email,
      school: quote.school,
      schoolDomain: quote.quoted_school_domain,
      productName: quote.quoted_product_name,
      seatCount: quote.quoted_seat_count,
      amountCents: quote.quoted_amount_cents,
      acceptedAt: quote.accepted_at,
    },
    purchase: purchase || null,
    schoolAdmin,
    districtAdmin,
    seats,
  });
});

// POST /api/admin/concierge/quotes/:quoteId/accept — accept a quote on the
// customer's behalf via Purchase Order. Identical end state to the
// customer clicking accept-quote.html themselves (same function, same
// purchase/invoice/school-admin/email side effects) — this just adds one
// audit entry naming the admin who did it.
router.post('/quotes/:quoteId/accept', requireAuth, async (req, res) => {
  const poNumber = ((req.body || {}).poNumber || '').trim();
  try {
    const result = await acceptQuoteViaPO(req.params.quoteId, poNumber);

    await audit(pool, {
      actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
      action: 'quote_accepted_by_admin', entityType: 'quote_request', entityId: Number(req.params.quoteId),
      newValue: { purchaseId: result.purchaseId, invoiceId: result.invoiceId, poNumber },
      ipAddress: req.ip,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// POST /api/admin/concierge/purchases/:purchaseId/invite-teacher — invite a
// teacher into a purchase's seats on the school's behalf. No ownership-scope
// check (unlike the school admin's own version of this) — trusted because
// the route itself is requireAuth (FNE admin only).
router.post('/purchases/:purchaseId/invite-teacher', requireAuth, async (req, res) => {
  const b = req.body || {};
  try {
    const result = await inviteTeacherToSeat({
      purchaseId: Number(req.params.purchaseId),
      email: b.email, firstName: b.firstName, lastName: b.lastName,
      gradeLevel: b.gradeLevel || null, roleName: b.roleName || null,
      department: b.department || null, subjectArea: b.subjectArea || null,
      personalMessage: b.personalMessage || null,
      invitedBy: { siteUserId: req.user.userId, email: req.user.username, name: 'Fixer Nation Education', actorType: 'admin' },
      ipAddress: req.ip,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

// POST /api/admin/concierge/purchases/:purchaseId/invite-teachers/bulk
router.post('/purchases/:purchaseId/invite-teachers/bulk', requireAuth, async (req, res) => {
  const { invitations } = req.body || {};
  if (!Array.isArray(invitations) || !invitations.length) {
    return res.status(400).json({ error: 'invitations array is required' });
  }
  if (invitations.length > 200) {
    return res.status(400).json({ error: 'Maximum 200 invitations per batch' });
  }

  const purchaseId = Number(req.params.purchaseId);
  const invitedBy = { siteUserId: req.user.userId, email: req.user.username, name: 'Fixer Nation Education', actorType: 'admin' };
  const results = { sent: [], skipped: [], errors: [] };

  for (const inv of invitations) {
    const email = (inv.email || '').trim().toLowerCase();
    try {
      const result = await inviteTeacherToSeat({
        purchaseId, email, firstName: inv.firstName, lastName: inv.lastName,
        gradeLevel: inv.gradeLevel || null, roleName: inv.roleName || null,
        department: inv.department || null, subjectArea: inv.subjectArea || null,
        invitedBy, ipAddress: req.ip,
      });
      results.sent.push({ email, invitationId: result.invitationId });
    } catch (err) {
      if (err.status === 409) {
        results.skipped.push({ email, reason: err.message });
      } else {
        results.errors.push({ email: email || inv.email, reason: err.message || 'Server error' });
      }
    }
  }

  res.json(results);
});

// ---------------------------------------------------------------------------
// District branding — lets an FNE admin set a reasonable starting logo/
// colors for a district and publish it during concierge setup, instead of
// leaving the district on FNE's default look until the district admin logs
// in and does it themselves. Same shared logic district-admin-branding.html
// uses (server/lib/branding-editor.js), just reachable by an FNE admin for
// ANY district (no ownership-scope check, same as every other route in this
// file -- trusted because the route itself is requireAuth).
// ---------------------------------------------------------------------------

const BRANDING_COLOR_FIELDS = ['primary_color', 'secondary_color', 'accent_color'];
const BRANDING_LOGO_FIELDS = ['logo_original_url', 'logo_display_url'];
const BRANDING_LOGO_EXTRA_FIELDS = ['logo_crop'];

function pickBranding(row, prefix) {
  const out = {};
  [...BRANDING_LOGO_FIELDS, ...BRANDING_LOGO_EXTRA_FIELDS, ...BRANDING_COLOR_FIELDS].forEach((f) => {
    out[f] = row ? row[`${prefix}_${f}`] : null;
  });
  return out;
}

// GET /api/admin/concierge/districts/:districtId/branding
router.get('/districts/:districtId/branding', requireAuth, async (req, res) => {
  const districtId = Number(req.params.districtId);
  const [[district]] = await pool.query('SELECT name FROM districts WHERE id = ?', [districtId]);
  if (!district) return res.status(404).json({ error: 'District not found' });

  const row = await getBrandingRow('district_branding', 'district_id', districtId);

  const published = pickBranding(row, 'published');
  const draft = pickBranding(row, 'draft');
  const draftForEditing = { ...published, ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v != null)) };

  const hasUnpublishedChanges = row
    ? [...BRANDING_LOGO_FIELDS, ...BRANDING_COLOR_FIELDS].some(f => row[`draft_${f}`] != null && row[`draft_${f}`] !== row[`published_${f}`])
    : false;

  res.json({
    districtId,
    districtName: district.name,
    status: row ? row.branding_status : 'DEFAULT',
    published,
    draft: draftForEditing,
    hasUnpublishedChanges,
  });
});

// PUT /api/admin/concierge/districts/:districtId/branding — save draft colors
router.put('/districts/:districtId/branding', requireAuth, async (req, res) => {
  const districtId = Number(req.params.districtId);
  const { primaryColor, secondaryColor, accentColor } = req.body || {};
  const hexOk = (v) => !v || /^#[0-9a-fA-F]{6}$/.test(v);
  if (!hexOk(primaryColor)) return res.status(400).json({ error: 'Primary color must be a valid hex value, e.g. #003B71' });
  if (!hexOk(secondaryColor)) return res.status(400).json({ error: 'Secondary color must be a valid hex value.' });
  if (!hexOk(accentColor)) return res.status(400).json({ error: 'Accent color must be a valid hex value.' });

  await upsertDraftColors({
    table: 'district_branding', idColumn: 'district_id', id: districtId,
    primaryColor, secondaryColor, accentColor, updatedBy: null,
  });

  res.json({ ok: true });
});

// POST /api/admin/concierge/districts/:districtId/branding/logo
router.post('/districts/:districtId/branding/logo', requireAuth, (req, res, next) => {
  logoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  const districtId = Number(req.params.districtId);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const result = await processLogoUpload({
      table: 'district_branding', idColumn: 'district_id', id: districtId,
      fileBuffer: req.file.buffer, mimetype: req.file.mimetype, updatedBy: null,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST /api/admin/concierge/districts/:districtId/branding/publish
router.post('/districts/:districtId/branding/publish', requireAuth, async (req, res) => {
  const districtId = Number(req.params.districtId);

  try {
    await publishBranding({ table: 'district_branding', idColumn: 'district_id', id: districtId, updatedBy: null });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }

  await audit(pool, {
    actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
    action: 'district_branding_published_by_admin', entityType: 'district_branding', entityId: districtId,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// POST /api/admin/concierge/districts/:districtId/branding/reset
router.post('/districts/:districtId/branding/reset', requireAuth, async (req, res) => {
  const districtId = Number(req.params.districtId);

  await resetBranding({ table: 'district_branding', idColumn: 'district_id', id: districtId, updatedBy: null });

  await audit(pool, {
    actorType: 'admin', actorId: req.user.userId, actorEmail: req.user.username,
    action: 'district_branding_reset_by_admin', entityType: 'district_branding', entityId: districtId,
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

module.exports = router;

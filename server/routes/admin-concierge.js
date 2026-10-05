// White-glove "concierge" admin actions — lets an FNE admin carry a quote
// all the way through to a working license on a customer's behalf (phone/
// email deals), reusing the exact same logic the customer's own self-service
// flow uses rather than duplicating it:
//   - accepting a quote via Purchase Order -> acceptQuoteViaPO() in
//     server/routes/quote-accept.js (the School License Administrator
//     assignment that comes with it is part of that same function)
//   - inviting a teacher -> inviteTeacherToSeat() in
//     server/lib/teacher-invitations.js
// District Administrator assignment and marking a PO received are NOT
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
    `SELECT p.id, p.invoice_id, p.license_status, p.payment_status, p.po_number, p.school_domain,
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
        `SELECT dla.id, d.name AS district_name
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

module.exports = router;

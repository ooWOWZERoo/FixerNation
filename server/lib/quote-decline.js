// Sales CRM punch list G13 (PRD QUOTE-03): a quote can be DECLINED, by the customer on the accept page or by staff on the customer's behalf; staff can undo it.
//
// Rules this file keeps (each has a test):
//  - Declining writes ONLY the quote's three decline columns, one quote event and one audit row. It never closes or changes the deal, never changes a price, never touches a
//    purchase, invoice or contact label. Staff decide what a decline means (a Needs Attention item asks them: send a revised quote, or close the deal Lost).
//  - A declined quote cannot be accepted: quoteStatus() in routes/quote-accept.js says "declined" and the accept UPDATE itself requires declined_at IS NULL. Staff who want it back
//    must undo the decline first (CRM write role, audited, with an event), so a click by mistake is recoverable and nothing accepts silently.
//  - Compare-and-set: only an unaccepted, unreplaced, not-yet-declined quote can be declined; a repeat is reported as already declined and changes nothing.
//  - The reason is the customer's own plain text (500 characters at most). It is never trusted as markup: every page that shows it escapes it, and the staff email goes through
//    lib/mailer.js, which escapes it. No IP address, browser string or token is stored.
// `conn` is the pool in the app and any query-capable handle in tests. SQL stays portable.
const { audit } = require('./audit');
const crmHooks = require('./crm-hooks');

const REASON_MAX = 500;
const plain = (v, max) => { if (typeof v !== 'string') return null; const t = v.trim(); return t ? t.slice(0, max) : null; };
const isMissing = (err) => err && (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE' || /no such (table|column)|has no column named/i.test(String(err.message)));

class Refusal extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }

// by: 'customer' | 'staff'. Returns { id, quoteNumber, opportunityId, already, reason }. Throws Refusal.
async function declineQuote(conn, quoteId, { by, reason, adminId = null, now }) {
  const why = plain(reason, REASON_MAX);
  let q;
  try {
    [[q]] = await conn.query('SELECT id, quote_number, opportunity_id, school, accepted_at, declined_at, version_status FROM quote_requests WHERE id = ?', [quoteId]);
  } catch (err) { if (isMissing(err)) throw new Refusal(503, 'not_available', 'Declining a quote is not available yet.'); throw err; }
  if (!q) throw new Refusal(404, 'not_found', 'Quote not found.');
  if (q.accepted_at) throw new Refusal(409, 'already_accepted', 'This quote was already accepted.');
  if (q.version_status === 'superseded') throw new Refusal(409, 'superseded', 'A newer version of this quote was sent.');
  const out = { id: Number(q.id), quoteNumber: q.quote_number || null, opportunityId: q.opportunity_id ? Number(q.opportunity_id) : null, school: q.school || null, reason: why, already: false };
  if (q.declined_at) return { ...out, already: true };
  const [u] = await conn.query(
    "UPDATE quote_requests SET declined_at = ?, declined_by = ?, decline_reason = ? WHERE id = ? AND accepted_at IS NULL AND declined_at IS NULL AND version_status <> 'superseded'",
    [now, by === 'staff' ? 'staff' : 'customer', why, q.id]);
  if (!u.affectedRows) return { ...out, already: true }; // someone got there first (a decline, an acceptance or a revision): nothing more to do
  await crmHooks.quoteEvent(q.id, 'declined', { detail: `${by === 'staff' ? 'recorded by staff' : 'by the customer'}${why ? `: ${why.slice(0, 150)}` : ''}`, actorAdminId: by === 'staff' ? adminId : null });
  await audit(conn, {
    actorType: by === 'staff' ? 'admin' : 'public', actorId: by === 'staff' ? adminId : null, action: 'crm_quote_declined', entityType: 'crm_quote', entityId: q.id,
    newValue: { by: by === 'staff' ? 'staff' : 'customer', hasReason: !!why }, reason: by === 'staff' ? why : null,
  });
  return out;
}

// Staff only. Puts a declined quote back (so it can be accepted again). Throws Refusal.
async function undoDecline(conn, quoteId, { adminId, reason, now }) {
  let q;
  try {
    [[q]] = await conn.query('SELECT id, declined_at, accepted_at, version_status FROM quote_requests WHERE id = ?', [quoteId]);
  } catch (err) { if (isMissing(err)) throw new Refusal(503, 'not_available', 'Declining a quote is not available yet.'); throw err; }
  if (!q) throw new Refusal(404, 'not_found', 'Quote not found.');
  if (!q.declined_at) throw new Refusal(409, 'not_declined', 'This quote is not declined.');
  const [u] = await conn.query('UPDATE quote_requests SET declined_at = NULL, declined_by = NULL, decline_reason = NULL WHERE id = ? AND declined_at IS NOT NULL AND accepted_at IS NULL', [q.id]);
  if (!u.affectedRows) throw new Refusal(409, 'not_declined', 'This quote changed. Reload and look again.');
  const why = plain(reason, 255);
  await crmHooks.quoteEvent(q.id, 'decline_undone', { detail: why || null, actorAdminId: adminId });
  await audit(conn, { actorType: 'admin', actorId: adminId, action: 'crm_quote_decline_undone', entityType: 'crm_quote', entityId: q.id, reason: why });
  return { id: Number(q.id) };
}

module.exports = { declineQuote, undoDecline, Refusal, REASON_MAX };

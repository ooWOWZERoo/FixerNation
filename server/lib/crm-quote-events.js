// What happened to a quote (Sales CRM phase 4b): created, sent, superseded, accepted, page_opened. Reached only through lib/crm-hooks.js, so it never throws,
// never blocks the request that caused it, and does nothing while the Hub is off. 'page_opened' is APPROXIMATE (an email scanner that runs scripts could trigger
// it), is written at most once an hour per quote, and carries no IP address, no browser string and no token.
const { sqlNow } = require('./crm-classification');

const TYPES = ['created', 'sent', 'superseded', 'accepted', 'page_opened'];
const VIEW_GAP_MS = 60 * 60 * 1000;

async function recordQuoteEvent(db, quoteId, type, { detail = null, actorAdminId = null } = {}) {
  if (!TYPES.includes(type) || !quoteId) return false;
  const [[q]] = await db.query('SELECT id, opportunity_id FROM quote_requests WHERE id = ?', [quoteId]);
  if (!q) return false;
  if (type === 'page_opened') {
    const since = new Date(Date.now() - VIEW_GAP_MS).toISOString().slice(0, 19).replace('T', ' ');
    const [recent] = await db.query("SELECT id FROM crm_quote_events WHERE quote_id = ? AND event_type = 'page_opened' AND created_at >= ? LIMIT 1", [q.id, since]);
    if (recent.length) return false;
  }
  await db.query(
    'INSERT INTO crm_quote_events (quote_id, opportunity_id, event_type, detail, actor_admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [q.id, q.opportunity_id || null, type, detail ? String(detail).slice(0, 255) : null, actorAdminId || null, sqlNow()]
  );
  return true;
}

module.exports = { recordQuoteEvent, TYPES };

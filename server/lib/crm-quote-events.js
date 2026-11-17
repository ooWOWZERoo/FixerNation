// What happened to a quote (Sales CRM phase 4b, and G13): created, sent, superseded, accepted, page_opened, declined, decline_undone, send_failed (the mail server refused the email), expired. Reached only through lib/crm-hooks.js, so it never throws,
// never blocks the request that caused it, and does nothing while the Hub is off. 'page_opened' is APPROXIMATE (an email scanner that runs scripts could trigger
// it), is written at most once an hour per quote, and carries no IP address, no browser string and no token.
const { sqlNow } = require('./crm-classification');

const TYPES = ['created', 'sent', 'superseded', 'accepted', 'page_opened', 'declined', 'decline_undone', 'send_failed', 'expired'];
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

// G13: one 'expired' event for each quote that was sent, never answered, and whose valid-until date has passed. Written by the daily check, once per quote ever (the INSERT itself
// refuses a second one), and nothing else changes: not the quote, the deal or any label. A declined, accepted or replaced quote did not "expire", so it gets none.
// apply=false only counts. Returns { available, eligible, made }.
async function recordExpired(db, { today, apply = false }) {
  const out = { available: true, eligible: 0, made: 0 };
  const where = `q.quote_sent_at IS NOT NULL AND q.accepted_at IS NULL AND q.version_status <> 'superseded' AND q.status IN ('new', 'contacted') AND q.quote_valid_until IS NOT NULL AND q.quote_valid_until < ?
     AND LOWER(TRIM(q.email)) NOT LIKE '%@example.com' AND NOT EXISTS (SELECT 1 FROM crm_quote_events e WHERE e.quote_id = q.id AND e.event_type = 'expired')`;
  const run = async (declined) => (await db.query(`SELECT q.id, q.quote_valid_until FROM quote_requests q WHERE ${where}${declined} ORDER BY q.id`, [today]))[0];
  let rows;
  try {
    try { rows = await run(' AND q.declined_at IS NULL'); } catch (err) { if (!/declined_at/.test(String(err.message)) && err.code !== 'ER_BAD_FIELD_ERROR') throw err; rows = await run(''); }
  } catch (err) {
    if (err && (err.code === 'ER_NO_SUCH_TABLE' || /no such table/i.test(String(err.message)))) return { ...out, available: false };
    throw err;
  }
  out.eligible = rows.length;
  if (!apply) return out;
  const at = sqlNow();
  for (const r of rows) {
    const [ins] = await db.query(
      `INSERT INTO crm_quote_events (quote_id, opportunity_id, event_type, detail, actor_admin_id, created_at)
       SELECT q.id, q.opportunity_id, 'expired', ?, NULL, ? FROM quote_requests q WHERE q.id = ? AND NOT EXISTS (SELECT 1 FROM crm_quote_events e WHERE e.quote_id = q.id AND e.event_type = 'expired')`,
      [`valid until ${String(r.quote_valid_until).slice(0, 10)}`, at, r.id]);
    out.made += Number(ins.affectedRows || 0);
  }
  return out;
}

module.exports = { recordQuoteEvent, recordExpired, TYPES };

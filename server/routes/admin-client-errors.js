// Error capture, the staff side (Release 122). Read-only except "Clear" (delete one group once it is fixed).
// Requirements and access matrix: docs/reference/error-capture-requirements.md.
//
//   GET  /api/admin/client-errors?hours=&kind=     errors grouped by kind, place and message, with counts
//   POST /api/admin/client-errors/clear            delete one group
//   GET  /api/admin/client-errors/for-request/:id  errors from the same signed-in person or browser, 7 days before a support request
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/rate-limit');
const { ALL_KINDS } = require('../lib/client-errors');

const router = express.Router();
const HOURS = [24, 168, 720]; // 24 hours, 7 days, 30 days
const GROUP_FIELDS = ['kind', 'page_path', 'api_path', 'method', 'http_status', 'message', 'source'];

// GET /api/admin/client-errors
router.get('/', requireAuth, async (req, res) => {
  const hours = HOURS.includes(Number(req.query.hours)) ? Number(req.query.hours) : 24;
  const where = ['last_seen >= ?'];
  const params = [new Date(Date.now() - hours * 3600 * 1000)];
  if (typeof req.query.kind === 'string' && ALL_KINDS.includes(req.query.kind)) { where.push('kind = ?'); params.push(req.query.kind); }
  const [groups] = await pool.query(
    `SELECT kind, page_path, api_path, method, http_status, message, source,
            SUM(occurrences) AS total, COUNT(*) AS rows_seen, MIN(first_seen) AS first_seen, MAX(last_seen) AS last_seen,
            COUNT(DISTINCT CASE WHEN client_session_id <> '' THEN client_session_id END) AS browsers
     FROM client_errors WHERE ${where.join(' AND ')}
     GROUP BY kind, page_path, api_path, method, http_status, message, source
     ORDER BY MAX(last_seen) DESC LIMIT 200`, params);
  const [[day]] = await pool.query('SELECT COALESCE(SUM(occurrences), 0) AS n FROM client_errors WHERE last_seen >= ?', [new Date(Date.now() - 24 * 3600 * 1000)]);
  res.json({
    hours, last24Hours: Number(day.n) || 0, kinds: ALL_KINDS,
    groups: groups.map(g => ({ ...g, total: Number(g.total), browsers: Number(g.browsers) })),
  });
});

// POST /api/admin/client-errors/clear -- body: the group's fields exactly as listed
router.post('/clear', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (typeof b.kind !== 'string' || !ALL_KINDS.includes(b.kind)) return res.status(400).json({ error: 'Unknown kind' });
  const values = GROUP_FIELDS.map(f => (f === 'http_status' ? (Number.isInteger(b[f]) ? b[f] : 0) : (typeof b[f] === 'string' ? b[f] : '')));
  const [r] = await pool.query(`DELETE FROM client_errors WHERE ${GROUP_FIELDS.map(f => `${f} = ?`).join(' AND ')}`, values);
  await audit(pool, { actorType: 'admin', actorId: req.user && req.user.userId, action: 'support_errors_cleared', entityType: 'client_error_group', newValue: { kind: b.kind, rows: r.affectedRows }, ipAddress: clientIp(req) });
  res.json({ ok: true, removed: r.affectedRows });
});

// GET /api/admin/client-errors/for-request/:id
router.get('/for-request/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'Not found' });
  const [[sr]] = await pool.query('SELECT id, site_user_id, client_session_id, created_at FROM support_requests WHERE id = ?', [id]);
  if (!sr) return res.status(404).json({ error: 'Not found' });
  const since = new Date(new Date(String(sr.created_at).replace(' ', 'T')).getTime() - 7 * 24 * 3600 * 1000);
  const [rows] = await pool.query(
    `SELECT kind, page_path, api_path, method, http_status, message, source, user_kind, occurrences, first_seen, last_seen
     FROM client_errors
     WHERE last_seen >= ? AND ((? IS NOT NULL AND site_user_id = ?) OR (? <> '' AND client_session_id = ?))
     ORDER BY last_seen DESC LIMIT 50`,
    [since, sr.site_user_id, sr.site_user_id, sr.client_session_id || '', sr.client_session_id || '']);
  res.json({ errors: rows, matchedBy: { account: !!sr.site_user_id, browser: !!sr.client_session_id } });
});

module.exports = router;

// Sales CRM audit viewer (punch list S11), mounted at /api/crm/audit. CRM Admin only (the audit_view right in lib/crm-permissions.js); it only reads. The list is the CRM's own rows
// in school_audit_log: every row whose entity type is one of CRM_ENTITY_TYPES, plus any row whose action starts with "crm_". Opening it is not itself audited (the runbook says
// to use it freely); looking at a quote's full acceptance record is (that route writes its own row). Values are shown as stored, so they can name a person: that is why it is
// CRM Admin only and why there is no export.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { CRM_ENTITY_TYPES } = require('../lib/audit');
const { text, posInt, dateOnly, oneOf, paging, likeTerm } = require('../lib/crm-common');

const router = express.Router();
const SCOPE = `(a.entity_type IN (${CRM_ENTITY_TYPES.map(() => '?').join(',')}) OR a.action LIKE 'crm!_%' ESCAPE '!')`;

function parsed(v) {
  if (v === null || v === undefined || v === '') return null;
  try { return JSON.parse(v); } catch { return String(v).slice(0, 2000); }
}

// ?action=<exact action>  ?entityType=<one of CRM_ENTITY_TYPES>  ?entityId=<n>  ?actor=<part of an email or username>  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?page= &pageSize=
router.get('/', requireAuth, requireCrm('audit_view'), async (req, res) => {
  const { page, size, offset } = paging(req.query, { defaultSize: 50, maxSize: 100 });
  const where = [SCOPE];
  const params = [...CRM_ENTITY_TYPES];
  const action = text(req.query.action, 64);
  if (action) { where.push('a.action = ?'); params.push(action); }
  const entityType = oneOf(req.query.entityType, CRM_ENTITY_TYPES);
  if (entityType) { where.push('a.entity_type = ?'); params.push(entityType); }
  const entityId = posInt(req.query.entityId);
  if (entityId) { where.push('a.entity_id = ?'); params.push(entityId); }
  const like = likeTerm(req.query.actor);
  if (like) { where.push("(a.actor_email LIKE ? ESCAPE '!' OR u.username LIKE ? ESCAPE '!')"); params.push(like, like); }
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    if (req.query[key] === undefined || req.query[key] === '') continue;
    const d = dateOnly(req.query[key]);
    if (!d) return res.status(400).json({ error: `${key} must be a real date (YYYY-MM-DD).` });
    where.push(`a.created_at ${op} ?`); params.push(key === 'from' ? `${d} 00:00:00` : `${d} 23:59:59`);
  }
  const from = 'FROM school_audit_log a LEFT JOIN admin_users u ON (a.actor_type = \'admin_user\' AND u.id = a.actor_id)';
  const w = `WHERE ${where.join(' AND ')}`;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${w}`, params);
  const [rows] = await pool.query(
    `SELECT a.id, a.created_at, a.actor_type, a.actor_id, a.actor_email, u.username AS actor_name, a.action, a.entity_type, a.entity_id, a.prev_value, a.new_value, a.reason
     ${from} ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  res.json({
    entries: rows.map(r => ({
      id: r.id, at: r.created_at, actorType: r.actor_type, actorId: r.actor_id || null, actor: r.actor_name || r.actor_email || (r.actor_type === 'system' ? 'The system' : null),
      action: r.action, entityType: r.entity_type || null, entityId: r.entity_id || null, before: parsed(r.prev_value), after: parsed(r.new_value), reason: r.reason || null,
    })),
    total: Number(total), page, pageSize: size, entityTypes: CRM_ENTITY_TYPES,
  });
});

// The distinct actions on file, for the page's filter.
router.get('/actions', requireAuth, requireCrm('audit_view'), async (req, res) => {
  const [rows] = await pool.query(`SELECT DISTINCT a.action FROM school_audit_log a WHERE ${SCOPE} ORDER BY a.action`, [...CRM_ENTITY_TYPES]);
  res.json({ actions: rows.map(r => r.action) });
});

module.exports = router;

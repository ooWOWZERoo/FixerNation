// Tune Your Brain, Phase 3 — write path for the learning_events table built
// in Phase 1 (server/scripts/alter-add-tune-your-brain-phase1-foundation.js).
// Called by engine-sdk.js from any new (Phase 3+) game engine. NOT used by
// the 6 legacy brain-*.html games — they keep writing to the brain_games
// tables via /api/brain-games, unchanged.
//
// Dual-identity, same principle as brain-games.js: either a site-user
// (fn_user_session) or a classroom-PIN student (fn_student_session) may
// log events. Uses lib/site-user.js's getSiteUser for the site-user side —
// the SAME check routes/site-auth.js's requireSiteAuth uses internally
// (corrected 2026-09-17: an earlier pass here built a second, redundant
// server/middleware/siteUserAuth.js without realizing routes/site-auth.js
// already had a real, actively-used requireSiteAuth; that file has been
// removed and this now points at the one real implementation). The
// student-session check is written locally here rather than extracted
// into a shared helper yet — brain-games.js's own copy is separate,
// working, production code that stays untouched.
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { getSiteUser } = require('../lib/site-user');
const { STUDENT_COOKIE_NAME } = require('../lib/session');

const router = express.Router();

async function getStudentPrincipal(req) {
  const token = req.cookies?.[STUDENT_COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    const [rows] = await pool.query(
      `SELECT cs.id FROM classroom_students cs
       JOIN classrooms c ON c.id = cs.classroom_id
       WHERE cs.id = ? AND cs.is_active = 1 AND c.archived_at IS NULL`,
      [payload.studentId]
    );
    return rows[0] ? { type: 'student', id: rows[0].id } : null;
  } catch { return null; }
}

async function getPrincipal(req) {
  const user = await getSiteUser(req);
  if (user) return { type: 'user', id: user.id };
  return getStudentPrincipal(req);
}

// Small, explicit allowlist — matches the blueprint's §9.8 event vocabulary.
// Reject anything else rather than accepting an arbitrary free-form string,
// so this table can't silently become a dumping ground for whatever an
// engine author felt like naming.
const ALLOWED_EVENT_TYPES = new Set([
  'session_started', 'session_resumed', 'session_completed', 'session_abandoned',
  'item_presented', 'response_submitted', 'item_correct', 'item_incorrect',
  'hint_requested', 'retry_attempted',
]);

// metadata is for small structured facts only (e.g. {"moves":4}) — never
// free text. One level deep, primitives only, capped size, so this can
// never become a backdoor for reflection/PII content the way the blueprint
// (§9.8, §10.3) explicitly prohibits for general analytics events.
function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    if (typeof value === 'string' && value.length > 200) continue;
    out[key] = value;
  }
  const json = JSON.stringify(out);
  if (json.length > 2000) return null;
  return json;
}

router.post('/', async (req, res) => {
  const principal = await getPrincipal(req);
  if (!principal) return res.status(401).json({ error: 'Login required' });

  const { eventType, gameId, skillId, contentVersion, metadata } = req.body || {};
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    return res.status(400).json({ error: 'Invalid eventType' });
  }

  const idCol = principal.type === 'student' ? 'student_id' : 'user_id';
  await pool.query(
    `INSERT INTO learning_events (${idCol}, event_type, game_id, skill_id, content_version, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [principal.id, eventType, gameId || null, skillId || null, contentVersion || null, sanitizeMetadata(metadata)]
  );

  res.status(201).json({ ok: true });
});

module.exports = router;

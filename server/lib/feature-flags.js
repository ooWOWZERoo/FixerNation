const pool = require('../db/pool');

// Minimal feature-flag check: a flag is on for a request either because
// it's enabled globally, or because the request's school is specifically
// opted in. No admin UI yet (Phase 1 is the mechanism, not the toggle
// screen) — flip a flag directly via feature_flags.enabled_globally or a
// feature_flag_schools row until one exists.
async function isFeatureEnabled(flagKey, { schoolId } = {}) {
  const [[flag]] = await pool.query('SELECT id, enabled_globally FROM feature_flags WHERE flag_key=?', [flagKey]);
  if (!flag) return false;
  if (flag.enabled_globally) return true;
  if (!schoolId) return false;
  const [[row]] = await pool.query(
    'SELECT 1 AS x FROM feature_flag_schools WHERE flag_id=? AND school_id=?',
    [flag.id, schoolId]
  );
  return !!row;
}

module.exports = { isFeatureEnabled };

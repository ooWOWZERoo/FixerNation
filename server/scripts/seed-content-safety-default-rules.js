// Seeds the initial FNE-locked default safety_rules — DATA, not code, so
// every value here is an admin-editable row from the moment this runs, not
// a constant baked into policy.js. is_locked=1 means a School License
// Administrator can add MORE (stricter) coverage for a category but can
// never edit or remove these baseline rows.
//
// The category->severity mappings for the local layers (lexical.js's fixed
// "profanity" severity, image.js's nudity score->severity bucketing) come
// straight from spec §20's own documented severity table, not from this
// script — this script only decides what ACTION each severity tier
// triggers, which the spec deliberately leaves to implementation.
//
// Safe to re-run: skips any (scope, school_domain, category, min_severity)
// combination that already exists.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const DEFAULT_RULES = [
  // Local lexical/image categories
  { category: 'profanity', min_severity: 2, action: 'block' },
  { category: 'bullying', min_severity: 2, action: 'allow_log' },
  { category: 'bullying', min_severity: 3, action: 'block_alert' },
  { category: 'hostility', min_severity: 1, action: 'allow_log' },
  { category: 'hostility', min_severity: 3, action: 'block_alert' },
  { category: 'hate_bias', min_severity: 2, action: 'block' },
  { category: 'hate_bias', min_severity: 3, action: 'block_alert' },
  { category: 'sexual_safety', min_severity: 2, action: 'block' },
  { category: 'sexual_safety', min_severity: 3, action: 'block_alert' },
  { category: 'sexual_safety', min_severity: 4, action: 'critical_block_alert' },
  { category: 'self_harm', min_severity: 2, action: 'block_alert' },
  { category: 'self_harm', min_severity: 4, action: 'critical_block_alert' },
  { category: 'threat_violence', min_severity: 2, action: 'block_alert' },
  { category: 'threat_violence', min_severity: 4, action: 'critical_block_alert' },
  { category: 'unsafe_conduct', min_severity: 2, action: 'block' },
  { category: 'privacy_pii', min_severity: 2, action: 'block_alert' },
  { category: 'image_nudity', min_severity: 2, action: 'block' },
  { category: 'image_nudity', min_severity: 4, action: 'critical_block_alert' },

  // OpenAI omni-moderation categories (only reachable once the admin flag +
  // OPENAI_API_KEY are both set — see lib/safety/contextual.js) — seeded so
  // the provider is immediately useful for evaluation rather than a no-op
  // until someone hand-builds a rule table first.
  { category: 'openai_sexual/minors', min_severity: 0, action: 'critical_block_alert' },
  { category: 'openai_self-harm/intent', min_severity: 0, action: 'critical_block_alert' },
  { category: 'openai_self-harm', min_severity: 0, action: 'block_alert' },
  { category: 'openai_violence/graphic', min_severity: 0, action: 'block_alert' },
  { category: 'openai_violence', min_severity: 0, action: 'allow_log' },
  { category: 'openai_harassment/threatening', min_severity: 0, action: 'block_alert' },
  { category: 'openai_harassment', min_severity: 0, action: 'allow_log' },
  { category: 'openai_hate/threatening', min_severity: 0, action: 'block_alert' },
  { category: 'openai_hate', min_severity: 0, action: 'block' },
  { category: 'openai_sexual', min_severity: 0, action: 'block' },
];

async function main() {
  const conn = await pool.getConnection();
  try {
    let inserted = 0;
    for (const r of DEFAULT_RULES) {
      const [existing] = await conn.query(
        `SELECT id FROM safety_rules WHERE scope = 'fne' AND school_domain IS NULL AND category = ? AND min_severity = ?`,
        [r.category, r.min_severity]
      );
      if (existing.length) continue;
      await conn.query(
        `INSERT INTO safety_rules (scope, school_domain, category, min_severity, action, is_locked) VALUES ('fne', NULL, ?, ?, ?, 1)`,
        [r.category, r.min_severity, r.action]
      );
      inserted++;
    }
    console.log(`Inserted ${inserted} default rule(s); ${DEFAULT_RULES.length - inserted} already present.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('seed-content-safety-default-rules failed:', err.message);
  process.exit(1);
});

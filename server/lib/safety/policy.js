// Merges findings from the lexical/contextual/image layers into one
// decision by looking up admin-configurable rules from safety_rules —
// never a hardcoded threshold. School-scoped rules apply on top of FNE
// rules for the same category, but a school can never touch (or have
// applied instead of) an is_locked=1 FNE rule (spec §21 "Locked FNE
// Guardrails" — enforced here, server-side, not just hidden in a UI).
const pool = require('../../db/pool');

const ACTION_RANK = { allow: 0, allow_log: 1, block: 2, block_alert: 3, critical_block_alert: 4 };

// Continuous model confidence (0–1) -> discrete severity tier (0–4). This is
// a technical scaling function, not a policy judgment — the actual judgment
// call (what ACTION a given severity triggers) lives entirely in the
// admin-editable safety_rules table below.
function scoreToSeverity(score) {
  if (score >= 0.9) return 4;
  if (score >= 0.7) return 3;
  if (score >= 0.5) return 2;
  if (score >= 0.2) return 1;
  return 0;
}

let rulesCache = null;
let rulesCacheAt = 0;
const RULES_CACHE_MS = 30 * 1000;

async function loadRules() {
  const now = Date.now();
  if (rulesCache && now - rulesCacheAt < RULES_CACHE_MS) return rulesCache;
  const [rows] = await pool.query('SELECT * FROM safety_rules ORDER BY min_severity DESC');
  rulesCache = rows;
  rulesCacheAt = now;
  return rows;
}

// Picks the highest-min_severity rule that (a) matches the finding's
// category, (b) has min_severity <= the finding's severity, and (c) is
// either an FNE-wide rule (school_domain NULL) or scoped to this school.
// A locked FNE rule always wins over a school rule for the same category —
// a school row can only ever ADD stricter coverage the spec doesn't already
// lock, never loosen a locked one.
function pickRule(rules, category, severity, schoolDomain) {
  const candidates = rules.filter(r =>
    r.category === category &&
    r.min_severity <= severity &&
    (r.school_domain === null || r.school_domain === schoolDomain)
  );
  if (!candidates.length) return null;

  const locked = candidates.filter(r => r.is_locked);
  const pool_ = locked.length ? locked : candidates;
  return pool_.reduce((best, r) => (!best || r.min_severity > best.min_severity ? r : best), null);
}

async function decide(findings, schoolDomain) {
  const rules = await loadRules();
  let bestAction = 'allow';
  let bestRule = null;

  for (const f of findings) {
    const severity = f.severity != null ? f.severity : scoreToSeverity(f.confidence || 0);
    const rule = pickRule(rules, f.category, severity, schoolDomain);
    if (!rule) continue;
    if (ACTION_RANK[rule.action] > ACTION_RANK[bestAction]) {
      bestAction = rule.action;
      bestRule = { ruleId: rule.id, category: rule.category, minSeverity: rule.min_severity, action: rule.action, isLocked: !!rule.is_locked };
    }
  }

  return { decision: bestAction, matchedRuleSnapshot: bestRule };
}

module.exports = { decide, scoreToSeverity, loadRules };

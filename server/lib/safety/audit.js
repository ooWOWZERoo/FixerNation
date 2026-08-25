// Writes the permanent scan/findings record — every scan gets one, even a
// plain ALLOW with zero findings, so there's a complete audit trail (spec
// FR-048: "every safety decision shall record policy/source/provider/model
// versions and final action").
const pool = require('../../db/pool');

async function recordScan({ contentContext, authorSiteUserId, authorStudentId, schoolDomain, classroomId, decision, findings, matchedRuleSnapshot }) {
  const [result] = await pool.query(
    `INSERT INTO safety_scans
       (content_context, author_site_user_id, author_student_id, school_domain, classroom_id, decision, matched_rule_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [contentContext, authorSiteUserId || null, authorStudentId || null, schoolDomain || null, classroomId || null, decision, matchedRuleSnapshot ? JSON.stringify(matchedRuleSnapshot) : null]
  );
  const scanId = result.insertId;

  if (findings && findings.length) {
    const values = findings.map(f => [scanId, f.category, f.severity != null ? f.severity : 0, f.source, f.confidence != null ? f.confidence : null, f.rationale || null]);
    await pool.query(
      'INSERT INTO safety_findings (scan_id, category, severity, source, confidence, rationale) VALUES ?',
      [values]
    );
  }

  return scanId;
}

module.exports = { recordScan };

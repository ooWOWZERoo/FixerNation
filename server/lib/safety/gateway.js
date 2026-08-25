// Single entry point for the FNE Content Safety pre-publication gateway.
// Every covered submission path (server/routes/social.js posts/comments/
// DMs/uploads, server/routes/student.js reflections/goals, server/routes/
// site-auth.js avatar upload) calls this BEFORE inserting the content.
//
// See CONTENT_SAFETY_IMPLEMENTATION_PLAN.md for the full design and what's
// deliberately out of scope for this pass (behavioral-pattern timelines,
// OCR, encrypted quarantine/evidence retention, COACH_REWRITE/QUARANTINE).
const lexical = require('./lexical');
const { runContextualCheck } = require('./contextual');
const { classifyImageBuffer } = require('./image');
const policy = require('./policy');
const audit = require('./audit');
const { createIncidentAndAlert } = require('./incident');

const NEUTRAL_MESSAGES = {
  block: 'This content cannot be shared because it may violate FNE or your school\'s safety guidelines.',
  block_image: 'This image cannot be shared because it may not meet FNE or your school\'s content-safety requirements.',
  unavailable: 'We\'re unable to verify this content right now. Your content has not been posted. Please try again shortly.',
};

async function screenContent({ contentContext, text, images, authorSiteUserId, authorStudentId, schoolDomain, classroomId }) {
  const findings = [];
  let failedClosed = false;

  try {
    if (text) {
      const { findings: lexFindings } = await lexical.screenText(text, schoolDomain);
      findings.push(...lexFindings);
    }

    const { findings: ctxFindings, error: ctxError } = await runContextualCheck({ text, images });
    findings.push(...ctxFindings);
    if (ctxError) {
      // The contextual layer degrades to "no finding" rather than throwing,
      // but per spec §5's fail-closed rule, a mandatory contextual check
      // that couldn't complete must not silently allow — the local lexical/
      // image layers still ran, so we don't discard those findings, but we
      // do force the final decision to at least BLOCK below.
      failedClosed = true;
    }

    if (images && images.length) {
      for (const img of images) {
        const scores = await classifyImageBuffer(img.buffer);
        findings.push({
          category: 'image_nudity',
          severity: policy.scoreToSeverity(scores.nudityRisk),
          source: 'image',
          confidence: scores.nudityRisk,
          rationale: `nsfwjs scores: ${JSON.stringify(scores.raw)}`,
        });
      }
    }
  } catch (err) {
    // Any unhandled error anywhere in the pipeline fails closed (spec §5) —
    // still record what we can.
    const scanId = await audit.recordScan({
      contentContext, authorSiteUserId, authorStudentId, schoolDomain, classroomId,
      decision: 'block', findings, matchedRuleSnapshot: { error: err.message },
    });
    return { decision: 'block', findings, scanId, message: NEUTRAL_MESSAGES.unavailable };
  }

  let { decision, matchedRuleSnapshot } = await policy.decide(findings, schoolDomain);
  if (failedClosed && decision === 'allow') decision = 'block';

  const scanId = await audit.recordScan({
    contentContext, authorSiteUserId, authorStudentId, schoolDomain, classroomId,
    decision, findings, matchedRuleSnapshot,
  });

  if (decision === 'block_alert' || decision === 'critical_block_alert') {
    const worst = findings.reduce((a, b) => ((b.severity || 0) > (a?.severity || 0) ? b : a), null);
    await createIncidentAndAlert({
      scanId,
      contentContext,
      category: (worst && worst.category) || 'unknown',
      severity: (worst && worst.severity) || 0,
      schoolDomain,
      classroomId,
      decision,
    });
  }

  const isImageDecision = images && images.length > 0 && !text;
  const message = decision === 'allow' || decision === 'allow_log'
    ? null
    : (isImageDecision ? NEUTRAL_MESSAGES.block_image : NEUTRAL_MESSAGES.block);

  return { decision, findings, scanId, message };
}

function isPublishable(decision) {
  return decision === 'allow' || decision === 'allow_log';
}

module.exports = { screenContent, isPublishable };

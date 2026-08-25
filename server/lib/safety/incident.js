// Incident creation + email alert routing for BLOCK_ALERT/CRITICAL_BLOCK_ALERT
// decisions. Phase 1 is notification-only — no role, no in-app review
// portal, no status workflow. safety_incidents/safety_alerts exist purely
// as an audit record of what happened and who was told.
const pool = require('../../db/pool');
const { getSetting } = require('../settings');
const { sendSalesAlertEmail } = require('../mailer');
const { resolveTeacherForClassroom } = require('./school-context');

const CATEGORY_LABELS = {
  profanity: 'Language/Profanity',
  bullying: 'Bullying',
  hostility: 'Targeted Hostility',
  hate_bias: 'Hate/Bias',
  sexual_safety: 'Sexual Safety',
  self_harm: 'Self-Harm',
  threat_violence: 'Threats/Violence',
  unsafe_conduct: 'Unsafe Conduct',
  privacy_pii: 'Privacy/Doxing',
  image_nudity: 'Image/Media',
};

async function getRecipientEmails(schoolDomain, category) {
  const [rows] = await pool.query(
    `SELECT DISTINCT email FROM safety_alert_recipients
     WHERE school_domain = ? AND is_active = 1 AND (category = ? OR category IS NULL)`,
    [schoolDomain, category]
  );
  return rows.map(r => r.email);
}

async function createIncidentAndAlert({ scanId, contentContext, category, severity, schoolDomain, classroomId, decision }) {
  const [result] = await pool.query(
    'INSERT INTO safety_incidents (scan_id, school_domain, classroom_id, category, severity) VALUES (?, ?, ?, ?, ?)',
    [scanId, schoolDomain || null, classroomId || null, category, severity]
  );
  const incidentId = result.insertId;

  const recipients = []; // [{ email, kind }]

  if (schoolDomain) {
    for (const email of await getRecipientEmails(schoolDomain, category)) {
      recipients.push({ email, kind: 'configured_recipient' });
    }
  }

  const isStudentContext = contentContext === 'STUDENT_REFLECTION' || contentContext === 'STUDENT_GOAL';
  if (isStudentContext && classroomId) {
    const teacherId = await resolveTeacherForClassroom(classroomId);
    if (teacherId) {
      const [[teacher]] = await pool.query('SELECT email FROM site_users WHERE id = ?', [teacherId]);
      if (teacher && teacher.email && !recipients.some(r => r.email === teacher.email)) {
        recipients.push({ email: teacher.email, kind: 'classroom_teacher' });
      }
    }
  }

  // Critical-alert fallback safeguard: if a CRITICAL_BLOCK_ALERT has zero
  // recipients (school hasn't configured anyone for this category or a
  // catch-all), still notify FNE's own configured fallback address rather
  // than let a potential self-harm/threat finding reach no one at all.
  if (decision === 'critical_block_alert' && recipients.length === 0) {
    const fallback = await getSetting('content_safety_fallback_email');
    if (fallback) recipients.push({ email: fallback, kind: 'fallback' });
  }

  const label = CATEGORY_LABELS[category] || category;
  const subject = decision === 'critical_block_alert'
    ? `CRITICAL Safety Alert — ${label}`
    : `Safety Alert — ${label}`;

  for (const r of recipients) {
    await sendSalesAlertEmail({
      to: r.email,
      subject,
      fields: {
        'Incident ID': String(incidentId),
        'Category': label,
        'Severity': String(severity),
        'School': schoolDomain || '—',
        'Content Type': contentContext,
        'Time': new Date().toISOString(),
      },
    });
    await pool.query(
      'INSERT INTO safety_alerts (incident_id, recipient_email, recipient_kind, sent_at) VALUES (?, ?, ?, NOW())',
      [incidentId, r.email, r.kind]
    );
  }

  return { incidentId, notifiedCount: recipients.length };
}

module.exports = { createIncidentAndAlert };

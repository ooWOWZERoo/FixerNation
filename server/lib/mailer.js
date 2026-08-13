const crypto = require('crypto');
const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) {
    throw new Error('SMTP is not configured — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD in server/.env');
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
  return transporter;
}

function unsubscribeToken(email) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(email.toLowerCase()).digest('hex');
}

// sendToken (optional) attributes an unsubscribe click back to the specific
// campaign_sends row it came from — the base email+HMAC token still gates
// who's allowed to unsubscribe whom, this just adds the extra context.
function unsubscribeUrl(email, sendToken) {
  const base = process.env.SITE_URL || '';
  const token = unsubscribeToken(email);
  let url = `${base}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
  if (sendToken) url += `&send=${sendToken}`;
  return url;
}

function trackingPixelUrl(sendToken) {
  const base = process.env.SITE_URL || '';
  return `${base}/api/campaigns/track-open?token=${sendToken}`;
}

// Sends one campaign email to one contact, appending a real unsubscribe link.
// trackingToken (optional — set by campaigns.js per recipient) enables both
// open-tracking (HTML campaigns only — a plain-text email can't load a pixel)
// and attributing an unsubscribe click back to this specific send.
async function sendCampaignEmail({ to, fromName, fromEmail, subject, body, bodyFormat, trackingToken }) {
  const url = unsubscribeUrl(to, trackingToken);
  const mail = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    headers: { 'List-Unsubscribe': `<${url}>` },
  };
  if (bodyFormat === 'html') {
    // No display:none — some mail clients skip fetching images they'll
    // never render, which would silently defeat the pixel. 1x1 with no
    // border is invisible enough on its own.
    const pixel = trackingToken ? `<img src="${trackingPixelUrl(trackingToken)}" width="1" height="1" border="0" alt="">` : '';
    mail.html = `${body}${pixel}\n<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">\n<p style="font-family:Arial,sans-serif;font-size:11px;color:#999;">You're receiving this because you subscribed to Fixer Nation updates. <a href="${url}" style="color:#999;">Unsubscribe</a>.</p>`;
  } else {
    mail.text = `${body}\n\n---\nYou're receiving this because you subscribed to Fixer Nation updates.\nUnsubscribe: ${url}`;
  }
  await getTransporter().sendMail(mail);
}

// Transactional emails (verification, password reset) always send from the
// authenticated SMTP account itself, unlike campaigns which let the admin
// pick a from-address — these need to reliably land, not be customized.
function systemFromAddress() {
  return `"Fixer Nation" <${process.env.SMTP_USER}>`;
}

async function sendVerificationEmail({ to, firstName, verifyUrl }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: 'Verify your Fixer Nation account',
    text: `Hi ${firstName},\n\nWelcome to Fixer Nation! Please verify your email address by visiting this link:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${firstName},</p><p>Welcome to Fixer Nation! Please verify your email address by clicking the link below:</p><p><a href="${verifyUrl}">Verify my email</a></p><p>This link expires in 24 hours.</p>`,
  });
}

async function sendPasswordResetEmail({ to, firstName, resetUrl }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: 'Reset your Fixer Nation password',
    text: `Hi ${firstName},\n\nWe received a request to reset your Fixer Nation password. Visit this link to choose a new one:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
    html: `<p>Hi ${firstName},</p><p>We received a request to reset your Fixer Nation password. Click below to choose a new one:</p><p><a href="${resetUrl}">Reset my password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
  });
}

// Same structure/tone as sendVerificationEmail (a link to click, 24-hour
// expiry) but distinct wording per the admin-invite requirement — this is
// someone being granted admin access, not a self-signup.
async function sendAdminInviteEmail({ to, username, inviteUrl }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: 'You have been assigned an admin role on Fixer Nation Education',
    text: `Hi ${username},\n\nYou have been assigned an admin role on the Fixer Nation Education domain. Please verify your email address and set your password by visiting this link:\n${inviteUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${username},</p><p>You have been assigned an admin role on the Fixer Nation Education domain. Please verify your email address and set your password by clicking the link below:</p><p><a href="${inviteUrl}">Activate my admin account</a></p><p>This link expires in 24 hours.</p>`,
  });
}

// Same token/landing-page mechanism as sendAdminInviteEmail, distinct copy
// since this is a password reset for an already-active admin, not an invite.
async function sendAdminPasswordResetEmail({ to, username, resetUrl }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: 'Reset your Fixer Nation admin password',
    text: `Hi ${username},\n\nAn admin password reset was requested for your Fixer Nation Education account. Visit this link to set a new password:\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
    html: `<p>Hi ${username},</p><p>An admin password reset was requested for your Fixer Nation Education account. Click below to set a new password:</p><p><a href="${resetUrl}">Reset my password</a></p><p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>`,
  });
}

// Fallback only for the rare case a caller doesn't pass `to` explicitly —
// every real caller looks up the admin-configured address via
// server/lib/settings.js (contact_email_ask_the_fixer / contact_email_quote).
const CONTACT_INBOX = 'admin@fixernationeducation.com';

async function sendContactFormEmail({ to, formName, fields, replyTo }) {
  const rows = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${label}:</strong> ${value}</p>`)
    .join('');
  const text = Object.entries(fields).filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n');

  await getTransporter().sendMail({
    from: systemFromAddress(),
    to: to || CONTACT_INBOX,
    replyTo,
    subject: `New ${formName} submission — Fixer Nation`,
    text,
    html: rows,
  });
}

// There's no customer-facing invoice page (admin-invoice-print.html requires
// admin login), so the invoice contents are embedded directly in the email
// body rather than linked to.
async function sendInvoiceEmail({ to, buyerName, invoiceNumber, poNumber, total, status, lineItems }) {
  const rows = lineItems.map(li =>
    `<tr><td style="padding:6px 10px;">${li.description}${li.seatCount ? ` (${li.seatCount} seats)` : ''}</td><td style="padding:6px 10px; text-align:right;">${li.amount !== null ? '$' + li.amount.toFixed(2) : '—'}</td></tr>`
  ).join('');
  const textRows = lineItems.map(li =>
    `- ${li.description}${li.seatCount ? ` (${li.seatCount} seats)` : ''}: ${li.amount !== null ? '$' + li.amount.toFixed(2) : '—'}`
  ).join('\n');
  const statusLabel = status === 'paid' ? 'Paid' : (status === 'cancelled' ? 'Cancelled' : 'Unpaid');

  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: `Invoice ${invoiceNumber} — Fixer Nation`,
    text: `Hi ${buyerName || 'there'},\n\nHere is invoice ${invoiceNumber}${poNumber ? ` (PO ${poNumber})` : ''}, status: ${statusLabel}.\n\n${textRows}\n\nTotal: $${total.toFixed(2)}\n\nQuestions? Just reply to this email.`,
    html: `<p>Hi ${buyerName || 'there'},</p>
      <p>Here is invoice <strong>${invoiceNumber}</strong>${poNumber ? ` (PO ${poNumber})` : ''} — status: <strong>${statusLabel}</strong>.</p>
      <table style="border-collapse:collapse; width:100%; max-width:480px;">${rows}
        <tr><td style="padding:10px; font-weight:700; border-top:2px solid #ddd;">Total</td><td style="padding:10px; font-weight:700; text-align:right; border-top:2px solid #ddd;">$${total.toFixed(2)}</td></tr>
      </table>
      <p>Questions? Just reply to this email.</p>`,
  });
}

// Generic sender for admin-editable automation emails (server/lib/automations.js)
// — subject/body have already had their {{mergeField}} tokens rendered by
// the time they get here. Plain text is the source of truth (matches how
// the admin edits it); HTML just turns newlines into <br>-separated
// paragraphs rather than re-parsing any markup, since the editor is a plain
// textarea, not a rich-text one.
async function sendAutomationEmail({ to, subject, body }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject,
    text: body,
    html: body.split('\n').filter(line => line.trim()).map(line => `<p>${line}</p>`).join(''),
  });
}

// Teacher invitation sent by a school license administrator
async function sendTeacherInvitationEmail({ to, firstName, inviteUrl, schoolDomain, adminName, personalMessage, expiresAt }) {
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '14 days';
  const personal = personalMessage ? `<p style="font-style:italic;color:#555;">"${personalMessage}"</p>` : '';
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: `You're invited to join ${schoolDomain || 'your school'} on Fixer Nation Education`,
    text: `Hi ${firstName},\n\n${adminName || 'Your school administrator'} has invited you to access licensed 2D SEL curriculum on Fixer Nation Education.\n\n${personalMessage ? `"${personalMessage}"\n\n` : ''}Click the link below to accept your invitation and create your account:\n${inviteUrl}\n\nThis invitation expires on ${expiry}.\n\nIf you have any questions, contact your school administrator.`,
    html: `<p>Hi ${firstName},</p>
      <p><strong>${adminName || 'Your school administrator'}</strong> has invited you to access licensed 2D SEL curriculum on Fixer Nation Education.</p>
      ${personal}
      <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#E06D2C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Accept Invitation</a></p>
      <p style="font-size:13px;color:#888;">This invitation expires on ${expiry}. If you didn't expect this email, you can safely ignore it.</p>`,
  });
}

// Reminder for a previously sent but unaccepted invitation
async function sendInvitationReminderEmail({ to, firstName, inviteUrl, schoolDomain, expiresAt }) {
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'soon';
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: `Reminder: Your invitation to Fixer Nation Education expires ${expiry}`,
    text: `Hi ${firstName},\n\nA reminder that you have a pending invitation to join ${schoolDomain || 'your school'} on Fixer Nation Education.\n\nAccept your invitation here:\n${inviteUrl}\n\nThis invitation expires on ${expiry}.`,
    html: `<p>Hi ${firstName},</p>
      <p>Just a reminder that your invitation to join <strong>${schoolDomain || 'your school'}</strong> on Fixer Nation Education is still waiting.</p>
      <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#E06D2C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Accept Invitation</a></p>
      <p style="font-size:13px;color:#888;">This invitation expires on ${expiry}.</p>`,
  });
}

// Sent to a newly assigned school license administrator
async function sendSchoolAdminWelcomeEmail({ to, firstName, schoolDomain, portalUrl, activateUrl, isNewUser }) {
  const actionLine = isNewUser
    ? `Please set your password and access your portal here:\n${activateUrl}`
    : `Access your School License Administrator portal here:\n${portalUrl}`;
  const actionHtml = isNewUser
    ? `<p><a href="${activateUrl}" style="display:inline-block;padding:12px 24px;background:#E06D2C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Set Password &amp; Access Portal</a></p>`
    : `<p><a href="${portalUrl}" style="display:inline-block;padding:12px 24px;background:#E06D2C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Go to School Admin Portal</a></p>`;

  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: `You're now a School License Administrator for ${schoolDomain || 'your school'} on Fixer Nation Education`,
    text: `Hi ${firstName},\n\nYou have been assigned as a School License Administrator for ${schoolDomain || 'your school'} on Fixer Nation Education.\n\nAs a School License Administrator, you can invite teachers, manage licenses, and monitor usage from your portal.\n\n${actionLine}\n\nIf you have questions, contact Fixer Nation Education support.`,
    html: `<p>Hi ${firstName},</p>
      <p>You have been assigned as a <strong>School License Administrator</strong> for <strong>${schoolDomain || 'your school'}</strong> on Fixer Nation Education.</p>
      <p>As a School License Administrator, you can:</p>
      <ul><li>Invite teachers and manage invitations</li><li>Assign and revoke licenses</li><li>Monitor license utilization</li><li>View teacher activity and reports</li></ul>
      ${actionHtml}
      <p style="font-size:13px;color:#888;">If you didn't expect this email, contact Fixer Nation Education support.</p>`,
  });
}

// Utilization threshold alert to school license administrator
async function sendLicenseUtilizationAlertEmail({ to, adminName, schoolDomain, totalSeats, assignedSeats, pctUsed, purchaseMoreUrl }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: `License alert: ${pctUsed}% of seats used for ${schoolDomain || 'your school'}`,
    text: `Hi ${adminName || 'Administrator'},\n\nYour school license for ${schoolDomain} has reached ${pctUsed}% utilization.\n\n${assignedSeats} of ${totalSeats} seats are assigned.\n\nTo purchase additional licenses, visit:\n${purchaseMoreUrl}\n\nFixer Nation Education`,
    html: `<p>Hi ${adminName || 'Administrator'},</p>
      <p>Your school license for <strong>${schoolDomain}</strong> has reached <strong>${pctUsed}% utilization</strong>.</p>
      <p>${assignedSeats} of ${totalSeats} seats are currently assigned.</p>
      <p><a href="${purchaseMoreUrl}" style="display:inline-block;padding:10px 20px;background:#E06D2C;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;">Request Additional Licenses</a></p>`,
  });
}

// Notifies admin when a teacher successfully registers
async function sendTeacherRegisteredNotificationEmail({ to, adminName, teacherName, teacherEmail, schoolDomain }) {
  await getTransporter().sendMail({
    from: systemFromAddress(),
    to,
    subject: `${teacherName} has joined ${schoolDomain || 'your school'} on Fixer Nation Education`,
    text: `Hi ${adminName || 'Administrator'},\n\n${teacherName} (${teacherEmail}) has accepted their invitation and registered on Fixer Nation Education.\n\nOne license has been consumed from your school's pool.\n\nFixer Nation Education`,
    html: `<p>Hi ${adminName || 'Administrator'},</p>
      <p><strong>${teacherName}</strong> (${teacherEmail}) has accepted their invitation and registered on Fixer Nation Education.</p>
      <p>One license has been consumed from your school's pool.</p>`,
  });
}

function renderSectionHtml(text) {
  if (!text) return '';
  return /<[a-zA-Z][^>]*>/.test(text) ? text : text.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

function renderSectionPlain(text) {
  if (!text) return '';
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

async function sendQuoteEmail({ to, firstName, lastName, school, quoteNumber, productName, seatCount, amountDollars, replyTo, fromEmail, addonSeats, termYears, discountPct, quoteValidUntil, acceptUrl, contentSections }) {
  const name = [firstName, lastName].filter(Boolean).join(' ') || 'there';
  const total = `$${Number(amountDollars).toFixed(2)}`;
  const fromAddr = fromEmail ? `"Fixer Nation Education" <${fromEmail}>` : systemFromAddress();
  const subject = quoteNumber
    ? `Your Fixer Nation Education License Quote #${quoteNumber}`
    : `Your Fixer Nation Education License Quote`;

  // Format valid-until text
  let validUntilText = 'This quote is valid for 30 days.';
  let validUntilHtml = 'This quote is valid for 30 days.';
  if (quoteValidUntil) {
    const d = new Date(String(quoteValidUntil) + 'T00:00');
    const formatted = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    validUntilText = `This quote is valid until ${formatted}.`;
    validUntilHtml = `This quote is valid until ${formatted}.`;
  }

  // Build itemized rows when breakdown data is present
  const hasBreakdown = addonSeats != null && termYears != null;

  let htmlRows = '';
  let textLines = '';

  if (hasBreakdown) {
    const years = Number(termYears) || 1;
    const disc = Number(discountPct) || 0;
    const addOn = Number(addonSeats) || 0;
    const seats = Number(seatCount) || 0;

    const row = (label, val) =>
      `<tr><td style="padding:8px 14px;border:1px solid #e5e7eb;background:#f9fafb;">${label}</td><td style="padding:8px 14px;border:1px solid #e5e7eb;text-align:right;">${val}</td></tr>`;

    htmlRows += row(`${productName} (${seats} seat${seats !== 1 ? 's' : ''})`, `See total below`);
    if (addOn > 0) htmlRows += row(`+ ${addOn} added seat${addOn !== 1 ? 's' : ''}`, `included`);
    if (years > 1) htmlRows += row(`${years}-year term`, `included`);
    if (disc > 0)  htmlRows += row(`Multi-year discount`, `${disc}% off`);
    htmlRows += `<tr><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:700;border-top:2px solid #d1d5db;">Total</td><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:700;font-size:18px;text-align:right;border-top:2px solid #d1d5db;">${total}</td></tr>`;

    textLines = [
      `  ${productName} (${seats} seat${seats !== 1 ? 's' : ''})`,
      addOn > 0 ? `  + ${addOn} added seat${addOn !== 1 ? 's' : ''}` : '',
      years > 1 ? `  ${years}-year term` : '',
      disc > 0  ? `  Multi-year discount: ${disc}% off` : '',
      `  Total: ${total}`,
    ].filter(Boolean).join('\n');
  } else {
    const seats = seatCount ? `${seatCount} seat${seatCount === 1 ? '' : 's'}` : null;
    const descLine = seats ? `${productName} — ${seats}` : productName;
    htmlRows = `
      <tr><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">License</td><td style="padding:10px 14px;border:1px solid #e5e7eb;">${descLine}</td></tr>
      <tr><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Total</td><td style="padding:10px 14px;border:1px solid #e5e7eb;font-weight:700;font-size:18px;">${total}</td></tr>`;
    textLines = `  License: ${descLine}\n  Total:   ${total}`;
  }

  const SECTION_DEFS = [
    { key: 'annualIncludes', label: 'What Every Annual License Includes' },
    { key: 'lessonPackage',  label: 'A Complete Lesson Package Contains' },
    { key: 'videoAccess',    label: 'Video Access and Reasonable Use' },
    { key: 'licenseTerms',   label: 'License, Download, and School-Year Terms' },
  ];

  let sectionsHtml = '';
  let sectionsText = '';

  if (contentSections) {
    SECTION_DEFS.forEach(({ key, label }) => {
      const raw = (contentSections[key] || '').trim();
      if (!raw) return;
      sectionsHtml += `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb;"><p style="font-size:13px;font-weight:700;color:#111827;margin:0 0 8px;">${label}</p><div style="font-size:13px;color:#374151;line-height:1.6;">${renderSectionHtml(raw)}</div></div>`;
      sectionsText += `\n\n${label}\n${renderSectionPlain(raw)}`;
    });
  }

  const acceptCtaHtml = acceptUrl ? `
    <div style="text-align:center;margin:24px 0;">
      <a href="${acceptUrl}" style="display:inline-block;background:#F26B4D;color:#fff;font-weight:700;padding:14px 32px;border-radius:999px;text-decoration:none;font-size:15px;">Accept Quote</a>
    </div>
    <p style="font-size:12px;color:#9ca3af;text-align:center;">${validUntilHtml} Clicking Accept Quote takes you to our secure order processing page.</p>` : `<p style="font-size:13px;color:#6b7280;">${validUntilHtml} To move forward or ask any questions, just reply to this email.</p>`;

  const acceptCtaText = acceptUrl
    ? `Accept this quote: ${acceptUrl}\n\n${validUntilText}`
    : validUntilText;

  await getTransporter().sendMail({
    from: fromAddr,
    to,
    replyTo: replyTo || undefined,
    subject,
    text: [
      `Hi ${name},`,
      ``,
      `Thank you for your interest in Fixer Nation Education. Here is the quote for ${school || 'your school'}:`,
      sectionsText,
      ``,
      textLines,
      ``,
      acceptCtaText,
      ``,
      `Fixer Nation Education`,
    ].join('\n'),
    html: `
      <p>Hi ${name},</p>
      <p>Thank you for your interest in Fixer Nation Education. Here is the quote for <strong>${school || 'your school'}</strong>:</p>
      ${sectionsHtml}
      <table style="border-collapse:collapse;width:100%;max-width:520px;margin:16px 0;">${htmlRows}</table>
      ${acceptCtaHtml}
      <p style="margin-top:20px;">Fixer Nation Education</p>
    `,
  });
}

module.exports = { sendCampaignEmail, unsubscribeToken, sendVerificationEmail, sendPasswordResetEmail, sendAdminInviteEmail, sendAdminPasswordResetEmail, sendContactFormEmail, sendInvoiceEmail, sendAutomationEmail, sendTeacherInvitationEmail, sendInvitationReminderEmail, sendSchoolAdminWelcomeEmail, sendLicenseUtilizationAlertEmail, sendTeacherRegisteredNotificationEmail, sendQuoteEmail };

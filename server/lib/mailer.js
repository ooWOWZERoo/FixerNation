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

const CONTACT_INBOX = 'admin@fixernationeducation.com';

async function sendContactFormEmail({ formName, fields, replyTo }) {
  const rows = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${label}:</strong> ${value}</p>`)
    .join('');
  const text = Object.entries(fields).filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`).join('\n');

  await getTransporter().sendMail({
    from: systemFromAddress(),
    to: CONTACT_INBOX,
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

module.exports = { sendCampaignEmail, unsubscribeToken, sendVerificationEmail, sendPasswordResetEmail, sendAdminInviteEmail, sendContactFormEmail, sendInvoiceEmail };

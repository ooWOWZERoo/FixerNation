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

function unsubscribeUrl(email) {
  const base = process.env.SITE_URL || '';
  const token = unsubscribeToken(email);
  return `${base}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

// Sends one campaign email to one contact, appending a real unsubscribe link.
async function sendCampaignEmail({ to, fromName, fromEmail, subject, body, bodyFormat }) {
  const url = unsubscribeUrl(to);
  const mail = {
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject,
    headers: { 'List-Unsubscribe': `<${url}>` },
  };
  if (bodyFormat === 'html') {
    mail.html = `${body}\n<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">\n<p style="font-family:Arial,sans-serif;font-size:11px;color:#999;">You're receiving this because you subscribed to Fixer Nation updates. <a href="${url}" style="color:#999;">Unsubscribe</a>.</p>`;
  } else {
    mail.text = `${body}\n\n---\nYou're receiving this because you subscribed to Fixer Nation updates.\nUnsubscribe: ${url}`;
  }
  await getTransporter().sendMail(mail);
}

module.exports = { sendCampaignEmail, unsubscribeToken };

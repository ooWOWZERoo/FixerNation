// Sends the "Confirm your Microsoft sign-in" email for a made-up person, the way the site does right after someone returns from
// Microsoft's sign-in page. The test site cannot reach Microsoft, so this stands in for that step only; the email, the link and the
// Confirm page that follow are the real ones. Run from the server/ folder (it borrows server/node_modules), local test site only.
//   node tests/howto/ms-link.js <email> <first name> <last name> <return path>
const path = require('path');
const SERVER = path.join(process.cwd());
if (!/^(127\.0\.0\.1|localhost)$/.test(process.env.DB_HOST || '')) { console.error('Refusing: not the local test site.'); process.exit(1); }
const { signSession } = require(path.join(SERVER, 'lib/session-tokens'));
const { sendMicrosoftLinkEmail } = require(path.join(SERVER, 'lib/mailer'));
const [email, firstName, lastName, returnTo] = process.argv.slice(2);
(async () => {
  const token = signSession('msLink', { oid: 'howto-local-oid-' + email, email, firstName, lastName, returnTo }, '1h');
  await sendMicrosoftLinkEmail({ to: email, firstName, confirmUrl: `${process.env.SITE_URL}/microsoft-confirm.html?token=${encodeURIComponent(token)}` });
  console.log('sent');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });

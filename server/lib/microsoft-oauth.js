// Microsoft Entra ID (Azure AD) sign-in for site users — teachers, parents,
// school/district admins. "Coded but not live until configured" (same
// pattern as ELEVENLABS_API_KEY/STRIPE_SECRET_KEY): isConfigured() lets the
// route handlers degrade gracefully instead of throwing on a missing
// MS_OAUTH_CLIENT_ID before the Azure app registration exists.
//
// Authority is the multi-tenant "common" endpoint, not a single tenant —
// FNE serves many separate school districts, each with its own Microsoft
// 365 tenant, plus parents who may only have a personal Microsoft account.
const msal = require('@azure/msal-node');

function isConfigured() {
  return !!(process.env.MS_OAUTH_CLIENT_ID && process.env.MS_OAUTH_CLIENT_SECRET && process.env.MS_OAUTH_REDIRECT_URI);
}

function getMsalClient() {
  return new msal.ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_OAUTH_CLIENT_ID,
      authority: 'https://login.microsoftonline.com/common',
      clientSecret: process.env.MS_OAUTH_CLIENT_SECRET,
    },
  });
}

// User.Read lets us call Graph's /me for a reliable email address — the ID
// token's own email claim isn't guaranteed present for every account type.
const SCOPES = ['openid', 'profile', 'email', 'User.Read'];

async function fetchGraphProfile(accessToken) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return r.json();
}

module.exports = { isConfigured, getMsalClient, fetchGraphProfile, SCOPES };

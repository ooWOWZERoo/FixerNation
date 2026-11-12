// The one rule for "is the shared demo open?" (docs/reference/shared-demo-environment-requirements.md, R1). Pure, with no database or settings
// access, so the server (lib/public-demo.js) and the command-line scripts (which open their own database connection) use the very same code.

// `enabled` is the setting's text ('true' or 'false'); `endsAt` its ISO string (or empty). Open only when switched on AND the end time is still
// ahead. A switch left on past its date is off, and on with no end date is off.
function evaluateDemoWindow({ enabled, endsAt }, now = new Date()) {
  if (String(enabled).trim().toLowerCase() !== 'true') return { open: false, reason: 'off' };
  const end = endsAt ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return { open: false, reason: 'no_end_date' };
  if (end.getTime() <= now.getTime()) return { open: false, reason: 'expired', endsAt: end };
  return { open: true, reason: 'open', endsAt: end };
}

// "Friday, November 21 at 5:00 PM EST" -- the end time as the owner and the prospects read it (US Eastern, decision D1).
function formatEastern(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

module.exports = { evaluateDemoWindow, formatEastern };

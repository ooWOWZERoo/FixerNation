// Showing an end time (docs/reference/shared-demo-workspaces-requirements.md): the demo's times are read as US Eastern, decision D1. Pure, with no database or
// settings access, so the server and the command-line scripts share it. (The rule for the original single demo's on/off window was retired in phase 5.)

// "Friday, November 21 at 5:00 PM EST" -- the end time as the owner and the prospects read it (US Eastern, decision D1).
function formatEastern(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
}

module.exports = { formatEastern };

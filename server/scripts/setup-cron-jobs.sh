#!/bin/bash
# Adds all recurring cron jobs to crontab.
# Safe to run multiple times — skips any entry already present.
# Re-running also migrates the Morning Boost entry to the correct schedule.

NODE=/home/fixernat/nodevenv/repositories/fixernation/server/24/bin/node
SCRIPTS=/home/fixernat/repositories/fixernation/server/scripts
LOGS=/home/fixernat/logs

mkdir -p "$LOGS"

ENTRIES=(
  "0 1 * * * $NODE $SCRIPTS/expire-school-licenses.js >> $LOGS/cron-expire-school.log 2>&1"
  "0 6 * * * $NODE $SCRIPTS/school-license-expiry-reminder.js >> $LOGS/cron-school-reminder.log 2>&1"
  "0 2 * * * $NODE $SCRIPTS/expire-trial-licenses.js >> $LOGS/cron-expire-trial.log 2>&1"
  "0 8 * * * $NODE $SCRIPTS/quote-expiring-reminder.js >> $LOGS/cron-quote-reminder.log 2>&1"
  "*/5 * * * * $NODE $SCRIPTS/send-scheduled-campaigns.js >> $LOGS/cron-scheduled-campaigns.log 2>&1"
  "*/15 * * * 1-5 $NODE $SCRIPTS/send-morning-boost-email.js >> $LOGS/cron-morning-boost.log 2>&1"
  "0 3 * * * $NODE $SCRIPTS/purge-learning-events.js >> $LOGS/cron-purge-learning-events.log 2>&1"
  "30 2 * * * $NODE $SCRIPTS/backup-nightly.js >> $LOGS/cron-backup-nightly.log 2>&1"
  "15 4 1 * * $NODE $SCRIPTS/snapshot-program-use.js --apply >> $LOGS/cron-snapshot-program-use.log 2>&1"
  "30 4 1 8 * $NODE $SCRIPTS/snapshot-pog-evidence.js --apply >> $LOGS/cron-snapshot-pog-evidence.log 2>&1"
  "*/10 * * * * $NODE $SCRIPTS/demo-invitations.js sweep >> $LOGS/cron-demo-invitations.log 2>&1"
)

CURRENT=$(crontab -l 2>/dev/null || true)

# Remove any existing morning boost entry so the correct schedule is always applied
CURRENT=$(echo "$CURRENT" | grep -v "send-morning-boost-email.js" || true)

# send-membership-reminders.js was deleted when the membership system was
# removed (see CHANGELOG Release 28) but this line was never cleaned up here —
# it would fail with "file not found" if this script were ever re-run.
CURRENT=$(echo "$CURRENT" | grep -v "send-membership-reminders.js" || true)

# The nightly reset of the original single shared demo was retired with that demo (phase 5 of the demo workspaces plan). The script is now a library, so
# a leftover line would fail every night.
CURRENT=$(echo "$CURRENT" | grep -v "reset-public-demo.js" || true)

for ENTRY in "${ENTRIES[@]}"; do
  if echo "$CURRENT" | grep -qF "$ENTRY"; then
    echo "Already exists: $ENTRY"
  else
    CURRENT="$CURRENT"$'\n'"$ENTRY"
    echo "Added: $ENTRY"
  fi
done

echo "$CURRENT" | crontab -
echo "Done. Current crontab:"
crontab -l

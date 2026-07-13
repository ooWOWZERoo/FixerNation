#!/bin/bash
# ============================================================
# push.sh  —  Run this on YOUR MAC after making changes
# Usage:  bash push.sh "describe what you changed"
# ============================================================
set -e

cd ~/Documents/Claude/Projects/FixerNation

# Stage every changed file
git add -A

# Use the message you typed, or a default if you didn't
MESSAGE="${1:-update}"
git commit -m "$MESSAGE"

git push

echo ""
echo "Pushed to GitHub."
echo "Now go to cPanel Terminal and run:  bash deploy.sh"

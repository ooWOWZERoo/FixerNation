#!/bin/bash
# ============================================================
# deploy.sh  —  Run this in cPanel Terminal
# Usage:  ./deploy.sh
# ============================================================
set -e

REPO=~/repositories/fixernation
SERVER_DIR="$REPO/server"
NODE_ACTIVATE="$HOME/nodevenv/repositories/fixernation/server/24/bin/activate"

cd "$REPO"

# ── STEP 1: Pull latest code from GitHub ─────────────────────
echo ""
echo "STEP 1: Pulling latest code..."
BEFORE=$(git rev-parse HEAD)
git pull
AFTER=$(git rev-parse HEAD)

# Detect whether any server/ files changed in this pull
SERVER_CHANGED=false
if [ "$BEFORE" != "$AFTER" ] && git diff --name-only "$BEFORE" "$AFTER" | grep -q '^server/'; then
  SERVER_CHANGED=true
fi

if [ "$BEFORE" = "$AFTER" ]; then
  echo "  Already up to date."
elif [ "$SERVER_CHANGED" = "true" ]; then
  echo "  Server files changed — full deploy."
else
  echo "  Frontend-only changes."
fi

# ── STEP 2: Sync static files to public_html ─────────────────
echo ""
echo "STEP 2: Syncing HTML/CSS/JS to public_html..."
rsync -a --delete \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='*.md' \
  --exclude='push.sh' \
  --exclude='deploy.sh' \
  --exclude='server' \
  --exclude='api' \
  --exclude='uploads' \
  "$REPO/" \
  ~/public_html/
echo "  Done."

# ── STEPS 3-5: Server-only (skip for frontend-only changes) ──
if [ "$SERVER_CHANGED" = "true" ]; then

  echo ""
  echo "STEP 3: Activating Node.js..."
  source "$NODE_ACTIVATE"

  echo ""
  echo "STEP 4: Running npm install..."
  cd "$SERVER_DIR"
  npm install
  echo "  Done."

  echo ""
  echo "STEP 5: Running database migrations..."
  node scripts/migrate.js
  echo "  Done."

  echo ""
  echo "STEP 6: Restarting the app..."
  mkdir -p "$SERVER_DIR/tmp"
  touch "$SERVER_DIR/tmp/restart.txt"
  echo "  Done."

else
  echo ""
  echo "STEPS 3-6: Skipped (no server/ changes)."
fi

# ── Finished ──────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Deploy complete. Site is live."
echo "============================================"
echo ""
echo "NOTE: If the app seems stuck after restart,"
echo "go to cPanel > Node.js Selector > Restart."

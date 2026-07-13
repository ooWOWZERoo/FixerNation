#!/bin/bash
# ============================================================
# deploy.sh  —  Run this in cPanel Terminal after pushing
# Usage:  bash deploy.sh
# ============================================================
set -e

REPO=~/repositories/fixernation
SERVER_DIR="$REPO/server"
NODE_ACTIVATE="$HOME/nodevenv/repositories/fixernation/server/24/bin/activate"

# ── STEP 1: Pull latest code from GitHub ─────────────────────
echo ""
echo "STEP 1: Pulling latest code..."
cd "$REPO"
git pull

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

# ── STEP 3: Activate the Node.js environment ─────────────────
echo ""
echo "STEP 3: Activating Node.js..."
source "$NODE_ACTIVATE"

# ── STEP 4: Install any new npm packages ─────────────────────
echo ""
echo "STEP 4: Running npm install..."
cd "$SERVER_DIR"
npm install
echo "  Done."

# ── STEP 5: Run database migrations ──────────────────────────
echo ""
echo "STEP 5: Running database migrations..."
node scripts/migrate.js
echo "  Done."

# ── STEP 6: Restart the Node.js app ──────────────────────────
echo ""
echo "STEP 6: Restarting the app..."
mkdir -p "$SERVER_DIR/tmp"
touch "$SERVER_DIR/tmp/restart.txt"
echo "  Done."

# ── Finished ──────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Deploy complete. Site is live."
echo "============================================"
echo ""
echo "NOTE: If the app seems stuck after restart,"
echo "go to cPanel > Node.js Selector > Restart."

#!/bin/bash
set -e

REPO=~/repositories/fixernation

cd "$REPO"

echo "--- git pull ---"
git pull

echo "--- rsync static files to public_html ---"
rsync -av --delete \
  --exclude='.git' \
  --exclude='.gitignore' \
  --exclude='*.md' \
  --exclude='server' \
  --exclude='api' \
  --exclude='uploads' \
  "$REPO/" \
  ~/public_html/

echo "--- done ---"
echo "Restart the Node app in cPanel: Node.js Selector > click Restart."

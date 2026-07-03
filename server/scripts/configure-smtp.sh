#!/bin/bash
# Interactively writes SMTP + SITE_URL settings into server/.env.
# Run from anywhere; it locates .env relative to this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "No .env file found at $ENV_FILE — create it first (copy from .env.example)."
  exit 1
fi

# Sets KEY=VALUE in .env, replacing an existing line for KEY if present,
# otherwise appending it.
set_env_var() {
  local key="$1" value="$2"
  local escaped_value
  escaped_value=$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s/^${key}=.*/${key}=${escaped_value}/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

echo "Configuring SMTP settings in $ENV_FILE"
echo "(Values are written directly to the file — nothing is displayed back or logged.)"
echo

read -rp "Site URL [https://fixernationeducation.com]: " SITE_URL
SITE_URL=${SITE_URL:-https://fixernationeducation.com}

read -rp "SMTP host (e.g. mail.fixernationeducation.com): " SMTP_HOST
read -rp "SMTP port [587]: " SMTP_PORT
SMTP_PORT=${SMTP_PORT:-587}

read -rp "Use implicit TLS/SSL (usually only for port 465)? [y/N]: " SMTP_SECURE_YN
if [[ "$SMTP_SECURE_YN" =~ ^[Yy]$ ]]; then SMTP_SECURE=true; else SMTP_SECURE=false; fi

read -rp "SMTP username (usually the full mailbox address): " SMTP_USER
read -rsp "SMTP password: " SMTP_PASSWORD
echo

set_env_var "SITE_URL" "$SITE_URL"
set_env_var "SMTP_HOST" "$SMTP_HOST"
set_env_var "SMTP_PORT" "$SMTP_PORT"
set_env_var "SMTP_SECURE" "$SMTP_SECURE"
set_env_var "SMTP_USER" "$SMTP_USER"
set_env_var "SMTP_PASSWORD" "$SMTP_PASSWORD"

echo
echo "Done. Restart the Node app (Setup Node.js App -> Restart) for the new settings to take effect."

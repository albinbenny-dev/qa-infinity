#!/usr/bin/env bash
# deploy.sh — sync source to remote and rebuild only changed services
#
# Usage:
#   ./deploy.sh                        # deploy qa-api + qa-ui (most common)
#   ./deploy.sh qa-api                 # api only
#   ./deploy.sh qa-ui                  # ui only
#   ./deploy.sh qa-api qa-ui qa-runner # all three app services
#
# Config via env vars (or edit the defaults below):
#   DEPLOY_HOST=user@10.0.6.3
#   DEPLOY_DIR=/opt/qa-infinity

set -euo pipefail

REMOTE_HOST="${DEPLOY_HOST:-user@10.0.6.3}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/qa-infinity}"

# Collect services from args; default to api + ui
if [ $# -gt 0 ]; then
  SERVICES=("$@")
else
  SERVICES=(qa-api qa-ui)
fi
SERVICES_STR="${SERVICES[*]}"

echo "▶ Deploying [$SERVICES_STR] → $REMOTE_HOST:$REMOTE_DIR"

# ── 1. Sync source (transfers KB of changed .ts files, not GB of images) ────
echo ""
echo "⟳ Syncing source files…"
rsync -az --progress \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'packages/*/node_modules/' \
  --exclude 'packages/frontend/dist/' \
  --exclude 'packages/api/dist/' \
  --exclude '.deploy-tmp/' \
  --exclude 'scripts/' \
  --exclude '*.log' \
  --exclude '.env' \
  ./ "$REMOTE_HOST:$REMOTE_DIR/"
echo "✔ Sync done"

# ── 2. Build + restart on remote (layer-cached — only src layer rebuilds) ───
echo ""
echo "⟳ Building on remote (layer-cached)…"
# shellcheck disable=SC2029  # intentional: SERVICES_STR expands locally
ssh "$REMOTE_HOST" \
  "cd '$REMOTE_DIR' && docker compose build --parallel $SERVICES_STR && docker compose up -d $SERVICES_STR && docker compose ps $SERVICES_STR"

echo ""
echo "✅ Deploy complete"

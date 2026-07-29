#!/usr/bin/env bash
# sync.sh — pull latest code and redeploy on the remote server
#
# Run this directly on the server:
#   ./sync.sh                        # redeploy qa-api + qa-ui (most common)
#   ./sync.sh qa-runner              # runner only (Dockerfile changed)
#   ./sync.sh qa-api qa-ui qa-runner # all three app services
#
# The script auto-detects Docker Compose V1 vs V2.

set -euo pipefail

PROJECT_NAME="qa-infinity"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Collect services from args; default to api + ui
if [ $# -gt 0 ]; then
  SERVICES="$*"
else
  SERVICES="qa-api qa-ui qa-runner"
fi

# Detect docker compose V1 vs V2
if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

# Use sudo only when it exists (Linux/Mac); skip on Git Bash / Windows
if command -v sudo &>/dev/null; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "▶ Sync & deploy [$SERVICES]  (compose: $DC)"
echo ""

cd "$DIR"

# ── 1. Pull latest code ──────────────────────────────────────────────────────
echo "⟳ Pulling latest code…"
git checkout -- .
git pull
echo "✔ Code up to date  ($(git log -1 --format='%h %s'))"
echo ""

# ── 2. Build updated images (layer-cached — only changed layers rebuild) ─────
echo "⟳ Building images…"
$SUDO $DC -p "$PROJECT_NAME" build --parallel $SERVICES
echo "✔ Build done"
echo ""

# ── 3. Restart containers ────────────────────────────────────────────────────
echo "⟳ Restarting containers…"
$SUDO $DC -p "$PROJECT_NAME" up -d --no-build $SERVICES
echo ""

# ── 4. Status ────────────────────────────────────────────────────────────────
$SUDO $DC -p "$PROJECT_NAME" ps $SERVICES
echo ""
echo "✅ Deploy complete"

#!/usr/bin/env bash
# sync-local.sh — build and redeploy from current working tree (no git reset/pull)
#
# Use this on your local machine to test uncommitted changes:
#   ./sync-local.sh                        # rebuild qa-api + qa-ui + qa-runner
#   ./sync-local.sh qa-ui                  # rebuild only the frontend
#   ./sync-local.sh qa-api qa-ui qa-runner # explicit list
#
# Unlike sync.sh this script does NOT run `git checkout -- .` or `git pull`,
# so local edits (theme changes, config tweaks, etc.) are preserved.

set -euo pipefail

PROJECT_NAME="qa-infinity"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# Never use sudo on Windows (MSYS/Git Bash); use it on Linux/Mac if available
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  SUDO=""
elif command -v sudo &>/dev/null; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "▶ Local build & deploy [$SERVICES]  (compose: $DC)"
echo "  Working tree: $(git log -1 --format='%h %s') + any local changes"
echo ""

cd "$DIR"

# ── 1. Build images from current working tree ────────────────────────────────
echo "⟳ Building images…"
$SUDO $DC -p "$PROJECT_NAME" build --parallel $SERVICES
echo "✔ Build done"
echo ""

# ── 2. Restart containers ────────────────────────────────────────────────────
echo "⟳ Restarting containers…"
$SUDO $DC -p "$PROJECT_NAME" up -d --no-build $SERVICES
echo ""

# ── 3. Status ────────────────────────────────────────────────────────────────
$SUDO $DC -p "$PROJECT_NAME" ps $SERVICES
echo ""
echo "✅ Local deploy complete"

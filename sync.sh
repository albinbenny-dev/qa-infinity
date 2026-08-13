#!/usr/bin/env bash
# sync.sh — pull latest code from 6D git and redeploy on the remote server
#
# Run this directly on the server:
#   ./sync.sh                        # redeploy qa-api + qa-ui (most common)
#   ./sync.sh qa-runner              # runner only (Dockerfile changed)
#   ./sync.sh qa-api qa-ui qa-runner # all three app services
#
# One-time setup — point the server's repo at 6D GitLab (token auth):
#   git remote set-url origin https://oauth2:<YOUR_TOKEN>@gitlab.sixdee/automation/ai-automation-testing/qa-infinity.git
#   git fetch origin       # confirm credentials work
#   chmod 600 .git/config  # protect the token in config
#   ./sync.sh
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

# Use sudo only on Linux/Mac; skip on Git Bash / Windows (MSYS/Cygwin).
# Windows 11 ships a sudo binary that command -v finds, but it's disabled by
# default and errors at runtime — so we check OSTYPE first.
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  SUDO=""
elif command -v sudo &>/dev/null; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "▶ Sync & deploy [$SERVICES]  (compose: $DC)"
echo ""

cd "$DIR"

# ── 0. Warn before discarding local edits to docker-compose.yml ─────────────
# docker-compose.yml is meant to be identical on every server — anything that
# varies per site (ports, target-app extra_hosts, CPU/memory limits) belongs
# in .env, which git never touches. If this still shows local edits, the next
# step is about to silently wipe them, same as it always has — this just
# makes that visible instead of letting it happen quietly.
if ! git diff --quiet -- docker-compose.yml; then
  echo "⚠  docker-compose.yml has local edits that are about to be discarded:"
  echo ""
  git --no-pager diff --stat -- docker-compose.yml
  echo ""
  echo "   Move whatever changed into .env instead (see .env.example) so it"
  echo "   survives every future sync. Continuing in 5s — Ctrl+C to stop."
  echo ""
  sleep 5
fi

# ── 1. Pull latest code ──────────────────────────────────────────────────────
echo "⟳ Pulling latest code…"
git fetch origin
git reset --hard origin/main
echo "✔ Code up to date  ($(git log -1 --format='%h %s'))"
echo ""

# git reset --hard rewrites this very file on disk when sync.sh itself has
# changed upstream. Bash buffers script reads, so the already-running
# process keeps executing bytes from the OLD, buffered copy for everything
# after this point — any new logic added below silently never runs on the
# sync that pulls it in, even though the file on disk is correct. Re-exec
# fresh from the (now up to date) file so every step below is guaranteed to
# be the version we just pulled. Guarded by an env var to prevent looping.
if [ -z "${SYNC_SH_REEXECED:-}" ]; then
  exec env SYNC_SH_REEXECED=1 bash "$DIR/sync.sh" "$@"
fi

# git checkout writes files using this process's umask, not the mode git has
# recorded (100644). On hosts with a restrictive umask this silently drops
# the world-read bit — harmless for most files, but nginx/nginx.conf is
# bind-mounted read-only straight into qa-ui's container (see
# docker-compose.yml), which runs nginx as non-root 'nobody'. A non-world-
# readable copy makes nginx fail at startup with "Permission denied" on
# every single sync, since the reset above re-lands it with the host's
# umask each time. Force it back to world-readable after every pull.
chmod 644 nginx/nginx.conf

# ── 2. Build updated images (layer-cached — only changed layers rebuild) ─────
echo "⟳ Building images…"
DOCKER_BUILDKIT=0 $SUDO $DC -p "$PROJECT_NAME" build --parallel $SERVICES
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

#!/bin/bash
# =============================================================================
# apply-hotfix.sh — QA Infinity hotfix applier
#
# Run this on the TARGET server (air-gapped / no source code).
# Place image tarballs in the same directory as this script, then run it.
#
# Usage:
#   chmod +x apply-hotfix.sh
#   ./apply-hotfix.sh                    # auto-detect tarballs in current dir
#   ./apply-hotfix.sh qa-api-hotfix-abc1234.tar.gz qa-ui-hotfix-abc1234.tar.gz
# =============================================================================

set -e

echo "========================================"
echo "  QA Infinity Hotfix Applier"
echo "========================================"

# ── Find tarballs ─────────────────────────────────────────────────────────────
if [ "$#" -gt 0 ]; then
  TARBALLS=("$@")
else
  TARBALLS=($(ls qa-api-hotfix-*.tar.gz qa-ui-hotfix-*.tar.gz 2>/dev/null || true))
  if [ ${#TARBALLS[@]} -eq 0 ]; then
    echo "ERROR: No hotfix tarballs found in current directory."
    echo "Usage: ./apply-hotfix.sh qa-api-hotfix-<commit>.tar.gz [qa-ui-hotfix-<commit>.tar.gz]"
    exit 1
  fi
fi

echo ""
echo "Tarballs to load:"
for f in "${TARBALLS[@]}"; do echo "  - $f"; done
echo ""

# ── Load images ───────────────────────────────────────────────────────────────
LOADED_API=""
LOADED_UI=""

for TARBALL in "${TARBALLS[@]}"; do
  echo "▶ Loading $TARBALL ..."
  LOADED=$(docker load < "$TARBALL" | grep "Loaded image:" | awk '{print $NF}')
  echo "  ✔ Loaded: $LOADED"
  if echo "$TARBALL" | grep -q "qa-api"; then
    LOADED_API="$LOADED"
  elif echo "$TARBALL" | grep -q "qa-ui"; then
    LOADED_UI="$LOADED"
  fi
done

# ── Update docker-compose.yml ─────────────────────────────────────────────────
echo ""
echo "▶ Updating docker-compose.yml image tags ..."

if [ -n "$LOADED_API" ]; then
  # Replace the build: block for qa-api with image: tag, or update existing image:
  if grep -q "image: qa-api:" docker-compose.yml; then
    sed -i "s|image: qa-api:.*|image: $LOADED_API|" docker-compose.yml
    echo "  ✔ qa-api image tag updated to $LOADED_API"
  else
    echo "  ⚠ Could not auto-update qa-api in docker-compose.yml."
    echo "    Manually set:  image: $LOADED_API  under the qa-api service."
  fi
fi

if [ -n "$LOADED_UI" ]; then
  if grep -q "image: qa-ui:" docker-compose.yml; then
    sed -i "s|image: qa-ui:.*|image: $LOADED_UI|" docker-compose.yml
    echo "  ✔ qa-ui image tag updated to $LOADED_UI"
  else
    echo "  ⚠ Could not auto-update qa-ui in docker-compose.yml."
    echo "    Manually set:  image: $LOADED_UI  under the qa-ui service."
  fi
fi

# ── DB migration ──────────────────────────────────────────────────────────────
echo ""
echo "▶ Running DB migration (safe to re-run) ..."
docker-compose exec qa-api sh -c "cd /app/packages/api && node_modules/.bin/prisma db push" || \
  echo "  ⚠ DB push failed or qa-api not yet running — will retry after restart."

# ── Restart ───────────────────────────────────────────────────────────────────
echo ""
echo "▶ Restarting containers ..."
SERVICES="qa-api"
[ -n "$LOADED_UI" ] && SERVICES="$SERVICES qa-ui"
docker-compose up -d --force-recreate $SERVICES

# ── DB migration retry (in case api wasn't running before) ────────────────────
echo ""
echo "▶ Ensuring DB migration ran ..."
sleep 5
docker-compose exec qa-api sh -c "cd /app/packages/api && node_modules/.bin/prisma db push" && \
  echo "  ✔ DB schema in sync" || \
  echo "  ⚠ DB push failed — check: docker-compose logs qa-api"

# ── Verify ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Verifying ..."
sleep 3
docker-compose logs --tail=10 qa-api | grep -E "llm-config|Server running|error|Error" || true

echo ""
echo "========================================"
echo "  Hotfix applied!"
echo "  Check logs: docker-compose logs -f qa-api"
echo "  Health:     curl http://localhost:4000/health"
echo "========================================"

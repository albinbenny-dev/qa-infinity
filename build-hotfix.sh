#!/bin/bash
# =============================================================================
# build-hotfix.sh — QA Infinity hotfix image builder
#
# Run this on the MAIN server (the one with source code and working internet).
# It builds fresh Docker images for qa-api and qa-ui, saves them as .tar.gz
# files, and generates a README with apply instructions.
#
# Usage:
#   chmod +x build-hotfix.sh
#   ./build-hotfix.sh              # build both qa-api and qa-ui
#   ./build-hotfix.sh --api-only   # skip qa-ui (faster if only API changed)
#   ./build-hotfix.sh --ui-only    # skip qa-api
#
# Output (in ./releases/<commit>/):
#   qa-api-hotfix-<commit>.tar.gz
#   qa-ui-hotfix-<commit>.tar.gz   (unless --api-only)
#   README-hotfix-<commit>.md
# =============================================================================

set -e

COMMIT=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)
OUT_DIR="./releases/$COMMIT"
BUILD_API=true
BUILD_UI=true

# ── Parse flags ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --api-only) BUILD_UI=false ;;
    --ui-only)  BUILD_API=false ;;
  esac
done

echo "========================================"
echo "  QA Infinity Hotfix Builder"
echo "  Commit : $COMMIT"
echo "  Date   : $DATE"
echo "  API    : $BUILD_API"
echo "  UI     : $BUILD_UI"
echo "========================================"

mkdir -p "$OUT_DIR"

# ── Build images ──────────────────────────────────────────────────────────────
if [ "$BUILD_API" = true ]; then
  echo ""
  echo "▶ Building qa-api:$COMMIT ..."
  docker build -f packages/api/Dockerfile -t "qa-api:$COMMIT" .
  echo "▶ Saving qa-api image ..."
  docker save "qa-api:$COMMIT" | gzip > "$OUT_DIR/qa-api-hotfix-$COMMIT.tar.gz"
  API_SIZE=$(du -sh "$OUT_DIR/qa-api-hotfix-$COMMIT.tar.gz" | cut -f1)
  echo "✔ qa-api-hotfix-$COMMIT.tar.gz ($API_SIZE)"
fi

if [ "$BUILD_UI" = true ]; then
  echo ""
  echo "▶ Building qa-ui:$COMMIT ..."
  docker build -f packages/frontend/Dockerfile -t "qa-ui:$COMMIT" .
  echo "▶ Saving qa-ui image ..."
  docker save "qa-ui:$COMMIT" | gzip > "$OUT_DIR/qa-ui-hotfix-$COMMIT.tar.gz"
  UI_SIZE=$(du -sh "$OUT_DIR/qa-ui-hotfix-$COMMIT.tar.gz" | cut -f1)
  echo "✔ qa-ui-hotfix-$COMMIT.tar.gz ($UI_SIZE)"
fi

# ── Get recent commits for changelog ─────────────────────────────────────────
CHANGELOG=$(git log --oneline -10 | sed 's/^/| /' | sed 's/ /  |  /' | awk '{print $0 " |"}')

# ── Generate README ───────────────────────────────────────────────────────────
cat > "$OUT_DIR/README-hotfix-$COMMIT.md" << README
# QA Infinity — Hotfix $COMMIT

**Date:** $DATE
**Commit:** $COMMIT
**Built images:**
$([ "$BUILD_API" = true ] && echo "- \`qa-api-hotfix-$COMMIT.tar.gz\` ($API_SIZE)")
$([ "$BUILD_UI" = true ] && echo "- \`qa-ui-hotfix-$COMMIT.tar.gz\` ($UI_SIZE)")

---

## Recent commits included

$(git log --oneline -10 | sed 's/^/- /')

---

## Step 1 — Transfer files to the target server

\`\`\`bash
scp $OUT_DIR/qa-api-hotfix-$COMMIT.tar.gz admin@<server-ip>:/data/
$([ "$BUILD_UI" = true ] && echo "scp $OUT_DIR/qa-ui-hotfix-$COMMIT.tar.gz admin@<server-ip>:/data/")
scp $OUT_DIR/README-hotfix-$COMMIT.md admin@<server-ip>:/data/
\`\`\`

---

## Step 2 — On the target server: load images

\`\`\`bash
docker load < /data/qa-api-hotfix-$COMMIT.tar.gz
$([ "$BUILD_UI" = true ] && echo "docker load < /data/qa-ui-hotfix-$COMMIT.tar.gz")
\`\`\`

---

## Step 3 — Update docker-compose.yml to use new image tags

In the target server's \`docker-compose.yml\`, update the image tags:

\`\`\`yaml
# qa-api service — change image: line to:
image: qa-api:$COMMIT

$([ "$BUILD_UI" = true ] && printf "# qa-ui service — change image: line to:\nimage: qa-ui:$COMMIT")
\`\`\`

Or if docker-compose.yml uses \`build:\` instead of \`image:\`, add/replace with:
\`\`\`yaml
services:
  qa-api:
    image: qa-api:$COMMIT
$([ "$BUILD_UI" = true ] && printf "  qa-ui:\n    image: qa-ui:$COMMIT")
\`\`\`

---

## Step 4 — Apply DB migrations (if schema changed)

\`\`\`bash
docker-compose exec qa-api sh -c "cd /app/packages/api && node_modules/.bin/prisma db push"
\`\`\`

---

## Step 5 — Restart containers

\`\`\`bash
docker-compose up -d --force-recreate qa-api$([ "$BUILD_UI" = true ] && echo " qa-ui")
\`\`\`

---

## Step 6 — Verify

\`\`\`bash
# Check API started cleanly
docker-compose logs --tail=30 qa-api

# Check LLM config loaded
docker-compose logs qa-api | grep llm-config

# Quick health check
curl -s http://localhost:4000/health | head -c 200
\`\`\`
README

echo ""
echo "========================================"
echo "  Done! Files in: $OUT_DIR/"
ls -lh "$OUT_DIR/"
echo ""
echo "  Next: scp the files to the target server"
echo "  Then follow README-hotfix-$COMMIT.md"
echo "========================================"

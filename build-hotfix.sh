#!/bin/bash
# =============================================================================
# build-hotfix.sh — QA Infinity hotfix image builder
#
# Run this on the MAIN server (the one with source code and working internet).
# It builds fresh Docker images, saves them as .tar.gz files, and generates
# a README with apply instructions.
#
# Usage:
#   chmod +x build-hotfix.sh
#   ./build-hotfix.sh                # build qa-api + qa-ui (default)
#   ./build-hotfix.sh --api-only     # skip qa-ui (faster if only API changed)
#   ./build-hotfix.sh --ui-only      # skip qa-api
#   ./build-hotfix.sh --runner       # build qa-api + qa-ui + qa-runner
#   ./build-hotfix.sh --runner-only  # build qa-runner only (large ~1.5 GB)
#
# Output (in ./releases/<commit>/):
#   qa-api-hotfix-<commit>.tar.gz     (unless --ui-only or --runner-only)
#   qa-ui-hotfix-<commit>.tar.gz      (unless --api-only or --runner-only)
#   qa-runner-hotfix-<commit>.tar.gz  (only with --runner or --runner-only)
#   README-hotfix-<commit>.md
# =============================================================================

set -e

COMMIT=$(git rev-parse --short HEAD)
DATE=$(date +%Y-%m-%d)
OUT_DIR="./releases/$COMMIT"
BUILD_API=true
BUILD_UI=true
BUILD_RUNNER=false

# ── Parse flags ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --api-only)    BUILD_UI=false; BUILD_RUNNER=false ;;
    --ui-only)     BUILD_API=false; BUILD_RUNNER=false ;;
    --runner)      BUILD_RUNNER=true ;;
    --runner-only) BUILD_API=false; BUILD_UI=false; BUILD_RUNNER=true ;;
  esac
done

echo "========================================"
echo "  QA Infinity Hotfix Builder"
echo "  Commit : $COMMIT"
echo "  Date   : $DATE"
echo "  API    : $BUILD_API"
echo "  UI     : $BUILD_UI"
echo "  Runner : $BUILD_RUNNER"
echo "========================================"

mkdir -p "$OUT_DIR"

# ── Build images ──────────────────────────────────────────────────────────────
if [ "$BUILD_API" = true ]; then
  echo ""
  echo "▶ Building qa-api:$COMMIT ..."
  docker build -f packages/api/Dockerfile -t "qa-api:$COMMIT" -t "qa-api:latest" .
  echo "▶ Saving qa-api image ..."
  docker save "qa-api:latest" | gzip > "$OUT_DIR/qa-api-hotfix-$COMMIT.tar.gz"
  API_SIZE=$(du -sh "$OUT_DIR/qa-api-hotfix-$COMMIT.tar.gz" | cut -f1)
  echo "✔ qa-api-hotfix-$COMMIT.tar.gz ($API_SIZE)"
fi

if [ "$BUILD_UI" = true ]; then
  echo ""
  echo "▶ Building qa-ui:$COMMIT ..."
  docker build -f packages/frontend/Dockerfile -t "qa-ui:$COMMIT" -t "qa-ui:latest" .
  echo "▶ Saving qa-ui image ..."
  docker save "qa-ui:latest" | gzip > "$OUT_DIR/qa-ui-hotfix-$COMMIT.tar.gz"
  UI_SIZE=$(du -sh "$OUT_DIR/qa-ui-hotfix-$COMMIT.tar.gz" | cut -f1)
  echo "✔ qa-ui-hotfix-$COMMIT.tar.gz ($UI_SIZE)"
fi

if [ "$BUILD_RUNNER" = true ]; then
  echo ""
  echo "▶ Building qa-runner:$COMMIT (large image — this may take several minutes) ..."
  docker build -f packages/runner/Dockerfile -t "qa-runner:$COMMIT" -t "qa-runner:latest" .
  echo "▶ Saving qa-runner image ..."
  docker save "qa-runner:latest" | gzip > "$OUT_DIR/qa-runner-hotfix-$COMMIT.tar.gz"
  RUNNER_SIZE=$(du -sh "$OUT_DIR/qa-runner-hotfix-$COMMIT.tar.gz" | cut -f1)
  echo "✔ qa-runner-hotfix-$COMMIT.tar.gz ($RUNNER_SIZE)"
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
$([ "$BUILD_RUNNER" = true ] && echo "- \`qa-runner-hotfix-$COMMIT.tar.gz\` ($RUNNER_SIZE)")

---

## Recent commits included

$(git log --oneline -10 | sed 's/^/- /')

---

## Step 1 — Transfer files to the target server

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "scp $OUT_DIR/qa-api-hotfix-$COMMIT.tar.gz admin@<server-ip>:/data/")
$([ "$BUILD_UI" = true ] && echo "scp $OUT_DIR/qa-ui-hotfix-$COMMIT.tar.gz admin@<server-ip>:/data/")
$([ "$BUILD_RUNNER" = true ] && echo "scp $OUT_DIR/qa-runner-hotfix-$COMMIT.tar.gz admin@<server-ip>:/data/")
scp $OUT_DIR/README-hotfix-$COMMIT.md admin@<server-ip>:/data/
\`\`\`

---

## Step 2 — On the target server: load images

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "docker load < /data/qa-api-hotfix-$COMMIT.tar.gz")
$([ "$BUILD_UI" = true ] && echo "docker load < /data/qa-ui-hotfix-$COMMIT.tar.gz")
$([ "$BUILD_RUNNER" = true ] && echo "docker load < /data/qa-runner-hotfix-$COMMIT.tar.gz")
\`\`\`

---

## Step 3 — Update docker-compose.yml to use new image tags

In the target server's \`docker-compose.yml\`, update the image tags:

\`\`\`yaml
$([ "$BUILD_API" = true ] && printf "# qa-api service — change image: line to:\nimage: qa-api:$COMMIT\n")
$([ "$BUILD_UI" = true ] && printf "# qa-ui service — change image: line to:\nimage: qa-ui:$COMMIT\n")
$([ "$BUILD_RUNNER" = true ] && printf "# qa-runner service — change image: line to:\nimage: qa-runner:$COMMIT")
\`\`\`

Or if docker-compose.yml uses \`build:\` instead of \`image:\`, add/replace with:
\`\`\`yaml
services:
$([ "$BUILD_API" = true ] && printf "  qa-api:\n    image: qa-api:$COMMIT\n")
$([ "$BUILD_UI" = true ] && printf "  qa-ui:\n    image: qa-ui:$COMMIT\n")
$([ "$BUILD_RUNNER" = true ] && printf "  qa-runner:\n    image: qa-runner:$COMMIT")
\`\`\`

---

## Step 4 — Apply DB migrations (if schema changed)

\`\`\`bash
docker-compose exec qa-api sh -c "cd /app/packages/api && node_modules/.bin/prisma db push"
\`\`\`

---

## Step 5 — Restart containers

\`\`\`bash
docker-compose up -d --force-recreate$([ "$BUILD_API" = true ] && echo " qa-api")$([ "$BUILD_UI" = true ] && echo " qa-ui")$([ "$BUILD_RUNNER" = true ] && echo " qa-runner")
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

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
# Output (all files land in ../releases/hotfix/, named with date+time+commit):
#   qa-api-hotfix-YYYY-MM-DD_HHMM-<commit>.tar.gz     (unless --ui-only or --runner-only)
#   qa-ui-hotfix-YYYY-MM-DD_HHMM-<commit>.tar.gz      (unless --api-only or --runner-only)
#   qa-runner-hotfix-YYYY-MM-DD_HHMM-<commit>.tar.gz  (only with --runner or --runner-only)
#   README-hotfix-YYYY-MM-DD_HHMM-<commit>.md
#
# Files sort chronologically by name — latest is always at the bottom of ls.
# Output folder is OUTSIDE the repo (../releases/hotfix) so tarballs are never
# committed to git and don't bloat the SharePoint-synced repo folder.
# =============================================================================

set -e

COMMIT=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
STAMP=$(date +%Y-%m-%d_%H%M)
OUT_DIR="../releases/hotfix"
PREFIX="${STAMP}-${COMMIT}"
BUILD_API=true
BUILD_UI=true
BUILD_RUNNER=false

# --- Parse flags ---
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
echo "  Stamp  : $STAMP"
echo "  Output : $OUT_DIR/"
echo "  API    : $BUILD_API"
echo "  UI     : $BUILD_UI"
echo "  Runner : $BUILD_RUNNER"
echo "========================================"

mkdir -p "$OUT_DIR"

# --- Build images ---
if [ "$BUILD_API" = true ]; then
  echo ""
  echo ">> Building qa-api:$COMMIT ..."
  docker build -f packages/api/Dockerfile --build-arg GIT_SHA="$COMMIT" --build-arg BUILD_DATE="$BUILD_DATE" -t "qa-api:$COMMIT" -t "qa-api:latest" .
  echo ">> Saving qa-api image ..."
  docker save "qa-api:latest" | gzip > "$OUT_DIR/qa-api-hotfix-${PREFIX}.tar.gz"
  API_SIZE=$(du -sh "$OUT_DIR/qa-api-hotfix-${PREFIX}.tar.gz" | cut -f1)
  echo "OK  qa-api-hotfix-${PREFIX}.tar.gz ($API_SIZE)"
fi

if [ "$BUILD_UI" = true ]; then
  echo ""
  echo ">> Building qa-ui:$COMMIT ..."
  docker build -f packages/frontend/Dockerfile --build-arg GIT_SHA="$COMMIT" --build-arg BUILD_DATE="$BUILD_DATE" -t "qa-ui:$COMMIT" -t "qa-ui:latest" .
  echo ">> Saving qa-ui image ..."
  docker save "qa-ui:latest" | gzip > "$OUT_DIR/qa-ui-hotfix-${PREFIX}.tar.gz"
  UI_SIZE=$(du -sh "$OUT_DIR/qa-ui-hotfix-${PREFIX}.tar.gz" | cut -f1)
  echo "OK  qa-ui-hotfix-${PREFIX}.tar.gz ($UI_SIZE)"
fi

if [ "$BUILD_RUNNER" = true ]; then
  echo ""
  echo ">> Building qa-runner:$COMMIT (large image -- this may take several minutes) ..."
  docker build -f packages/runner/Dockerfile --build-arg GIT_SHA="$COMMIT" --build-arg BUILD_DATE="$BUILD_DATE" -t "qa-runner:$COMMIT" -t "qa-runner:latest" .
  echo ">> Saving qa-runner image ..."
  docker save "qa-runner:latest" | gzip > "$OUT_DIR/qa-runner-hotfix-${PREFIX}.tar.gz"
  RUNNER_SIZE=$(du -sh "$OUT_DIR/qa-runner-hotfix-${PREFIX}.tar.gz" | cut -f1)
  echo "OK  qa-runner-hotfix-${PREFIX}.tar.gz ($RUNNER_SIZE)"
fi

# --- Generate README ---
cat > "$OUT_DIR/README-hotfix-${PREFIX}.md" << README
# QA Infinity -- Hotfix ${PREFIX}

**Stamp:**  ${STAMP}
**Commit:** ${COMMIT}
**Built images:**
$([ "$BUILD_API" = true ] && echo "- \`qa-api-hotfix-${PREFIX}.tar.gz\` ($API_SIZE)")
$([ "$BUILD_UI" = true ] && echo "- \`qa-ui-hotfix-${PREFIX}.tar.gz\` ($UI_SIZE)")
$([ "$BUILD_RUNNER" = true ] && echo "- \`qa-runner-hotfix-${PREFIX}.tar.gz\` ($RUNNER_SIZE)")

---

## Recent commits included

$(git log --oneline -10 | sed 's/^/- /')

---

## Step 1 -- Transfer files to the target server

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "scp releases/hotfix/qa-api-hotfix-${PREFIX}.tar.gz admin@<server-ip>:/data/")
$([ "$BUILD_UI" = true ] && echo "scp releases/hotfix/qa-ui-hotfix-${PREFIX}.tar.gz admin@<server-ip>:/data/")
$([ "$BUILD_RUNNER" = true ] && echo "scp releases/hotfix/qa-runner-hotfix-${PREFIX}.tar.gz admin@<server-ip>:/data/")
scp releases/hotfix/README-hotfix-${PREFIX}.md admin@<server-ip>:/data/
\`\`\`

---

## Step 2 -- On the target server: load images

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "docker load < /data/qa-api-hotfix-${PREFIX}.tar.gz")
$([ "$BUILD_UI" = true ] && echo "docker load < /data/qa-ui-hotfix-${PREFIX}.tar.gz")
$([ "$BUILD_RUNNER" = true ] && echo "docker load < /data/qa-runner-hotfix-${PREFIX}.tar.gz")
\`\`\`

---

## Step 3 -- Update docker-compose.yml image tags

\`\`\`yaml
$([ "$BUILD_API" = true ] && echo "# qa-api:")
$([ "$BUILD_API" = true ] && echo "image: qa-api:$COMMIT")
$([ "$BUILD_UI" = true ] && echo "# qa-ui:")
$([ "$BUILD_UI" = true ] && echo "image: qa-ui:$COMMIT")
$([ "$BUILD_RUNNER" = true ] && echo "# qa-runner:")
$([ "$BUILD_RUNNER" = true ] && echo "image: qa-runner:$COMMIT")
\`\`\`

---

## Step 4 -- Apply DB migrations (if schema changed)

\`\`\`bash
docker-compose exec qa-api sh -c "cd /app/packages/api && node_modules/.bin/prisma db push"
\`\`\`

---

## Step 5 -- Restart containers

\`\`\`bash
docker-compose up -d --force-recreate$([ "$BUILD_API" = true ] && echo " qa-api")$([ "$BUILD_UI" = true ] && echo " qa-ui")$([ "$BUILD_RUNNER" = true ] && echo " qa-runner")
\`\`\`

---

## Step 6 -- Verify

\`\`\`bash
docker-compose logs --tail=30 qa-api
docker-compose logs qa-api | grep llm-config
curl -s http://localhost:4000/health | head -c 200
\`\`\`
README

echo ""
echo "========================================"
echo "  Done!  Stamp: $STAMP  Commit: $COMMIT"
echo "  Folder: $OUT_DIR/"
echo ""
echo "  This build's files:"
ls -lh "$OUT_DIR/" | grep "$PREFIX"
echo ""
echo "  All hotfixes (latest last):"
ls -lt "$OUT_DIR/" | tail -n +2 | awk '{print "  " $NF}' | grep -v '^  $' | tail -20
echo ""
echo "  Next: scp the files above to the target server"
echo "  Then follow README-hotfix-${PREFIX}.md"
echo "========================================"

# --- Google Drive upload (auto, if rclone is configured) ---
#
# One-time setup on this machine:
#   1. Install rclone:  curl https://rclone.org/install.sh | sudo bash
#   2. Configure Drive: rclone config
#        -> New remote -> name it "gdrive" -> type "drive"
#        -> Follow the OAuth browser link, grant access
#        -> Leave all other options as default
#   3. Test:            rclone ls gdrive:
#
# After setup, every build automatically uploads to:
#   Google Drive -> QA-Infinity-Hotfixes/
#
GDRIVE_REMOTE="gdrive"
GDRIVE_FOLDER="QA-Infinity-Hotfixes"

if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q "^${GDRIVE_REMOTE}:"; then
  echo ""
  echo "--- Uploading to Google Drive (${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/) ---"
  rclone copy "$OUT_DIR/" "${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/" \
    --include "*${PREFIX}*" \
    --progress \
    --transfers 4
  echo ""
  echo "Drive upload complete. Files at:"
  rclone ls "${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/" --include "*${PREFIX}*" | \
    awk '{printf "  %-12s %s\n", $1, $2}'
  echo ""
  echo "Full folder on Drive:"
  rclone ls "${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/" | sort | tail -20 | \
    awk '{printf "  %-12s %s\n", $1, $2}'
else
  echo ""
  echo "  [Drive] rclone not configured -- skipping upload."
  echo "  To enable: install rclone and run 'rclone config' to add a remote"
  echo "  named '${GDRIVE_REMOTE}' pointing to your Google Drive."
fi

#!/bin/bash
# =============================================================================
# release-k8s.sh — QA Infinity Kubernetes hotfix builder
#
# Sibling to build-hotfix.sh, for K8s/OpenShift targets instead of
# docker-compose ones. Same physical-handover model (build here where you
# have internet, hand over a tarball, load+push happens on their side) —
# what's different is the tag scheme and the apply instructions:
#   - build-hotfix.sh tags :latest (correct for docker-compose, which always
#     force-recreates regardless of tag).
#   - This script tags with the commit SHA ONLY, against the target's own
#     registry path, because Kubernetes' imagePullPolicy: IfNotPresent skips
#     re-pulling a tag it already has cached — see helm/qa-infinity/README.md,
#     "Why the image tag can never be :latest here".
#
# Run this on the MAIN server (the one with source code and working internet).
#
# Usage:
#   chmod +x release-k8s.sh
#   ./release-k8s.sh --registry harbor.internal.example.com/qa-infinity
#   ./release-k8s.sh --registry <path> --api-only     # skip qa-ui
#   ./release-k8s.sh --registry <path> --ui-only      # skip qa-api
#   ./release-k8s.sh --registry <path> --runner       # also build qa-runner
#   ./release-k8s.sh --registry <path> --runner-only  # qa-runner only (~1.5 GB)
#
# Output (all files land in ../releases/k8s/, named with date+time+commit):
#   qa-api-k8s-YYYY-MM-DD_HHMM-<commit>.tar.gz     (unless --ui-only or --runner-only)
#   qa-ui-k8s-YYYY-MM-DD_HHMM-<commit>.tar.gz      (unless --api-only or --runner-only)
#   qa-runner-k8s-YYYY-MM-DD_HHMM-<commit>.tar.gz  (only with --runner or --runner-only)
#   README-k8s-YYYY-MM-DD_HHMM-<commit>.md
#
# Output folder is OUTSIDE the repo (../releases/k8s) — same convention as
# build-hotfix.sh's ../releases/hotfix — so tarballs are never committed to
# git and don't bloat the SharePoint-synced repo folder.
# =============================================================================

set -e

REGISTRY=""
COMMIT=$(git rev-parse --short HEAD)
STAMP=$(date +%Y-%m-%d_%H%M)
OUT_DIR="../releases/k8s"
PREFIX="${STAMP}-${COMMIT}"
BUILD_API=true
BUILD_UI=true
BUILD_RUNNER=false

# --- Parse flags ---
for arg in "$@"; do
  case $arg in
    --registry=*)  REGISTRY="${arg#*=}" ;;
    --api-only)    BUILD_UI=false; BUILD_RUNNER=false ;;
    --ui-only)     BUILD_API=false; BUILD_RUNNER=false ;;
    --runner)      BUILD_RUNNER=true ;;
    --runner-only) BUILD_API=false; BUILD_UI=false; BUILD_RUNNER=true ;;
  esac
done
# Also accept `--registry <path>` as two args (not just `--registry=<path>`).
if [ -z "$REGISTRY" ]; then
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--registry" ]; then REGISTRY="$arg"; fi
    prev="$arg"
  done
fi

if [ -z "$REGISTRY" ]; then
  echo "ERROR: --registry <path> is required, e.g.:" >&2
  echo "  ./release-k8s.sh --registry harbor.internal.example.com/qa-infinity" >&2
  echo "" >&2
  echo "This must match the image.registry value the target cluster's" >&2
  echo "helm/qa-infinity chart will be installed/upgraded with." >&2
  exit 1
fi

echo "========================================"
echo "  QA Infinity K8s Release Builder"
echo "  Registry : $REGISTRY"
echo "  Commit   : $COMMIT"
echo "  Stamp    : $STAMP"
echo "  Output   : $OUT_DIR/"
echo "  API      : $BUILD_API"
echo "  UI       : $BUILD_UI"
echo "  Runner   : $BUILD_RUNNER"
echo "========================================"

mkdir -p "$OUT_DIR"

# --- Build + tag + save images ---
# Tagged ONLY as "<registry>/<service>:<commit>" — no :latest, see header.
if [ "$BUILD_API" = true ]; then
  echo ""
  echo ">> Building qa-api:$COMMIT ..."
  docker build -f packages/api/Dockerfile -t "${REGISTRY}/qa-api:${COMMIT}" .
  echo ">> Saving qa-api image ..."
  docker save "${REGISTRY}/qa-api:${COMMIT}" | gzip > "$OUT_DIR/qa-api-k8s-${PREFIX}.tar.gz"
  API_SIZE=$(du -sh "$OUT_DIR/qa-api-k8s-${PREFIX}.tar.gz" | cut -f1)
  echo "OK  qa-api-k8s-${PREFIX}.tar.gz ($API_SIZE)"
fi

if [ "$BUILD_UI" = true ]; then
  echo ""
  echo ">> Building qa-ui:$COMMIT ..."
  docker build -f packages/frontend/Dockerfile -t "${REGISTRY}/qa-ui:${COMMIT}" .
  echo ">> Saving qa-ui image ..."
  docker save "${REGISTRY}/qa-ui:${COMMIT}" | gzip > "$OUT_DIR/qa-ui-k8s-${PREFIX}.tar.gz"
  UI_SIZE=$(du -sh "$OUT_DIR/qa-ui-k8s-${PREFIX}.tar.gz" | cut -f1)
  echo "OK  qa-ui-k8s-${PREFIX}.tar.gz ($UI_SIZE)"
fi

if [ "$BUILD_RUNNER" = true ]; then
  echo ""
  echo ">> Building qa-runner:$COMMIT (large image -- this may take several minutes) ..."
  docker build -f packages/runner/Dockerfile -t "${REGISTRY}/qa-runner:${COMMIT}" .
  echo ">> Saving qa-runner image ..."
  docker save "${REGISTRY}/qa-runner:${COMMIT}" | gzip > "$OUT_DIR/qa-runner-k8s-${PREFIX}.tar.gz"
  RUNNER_SIZE=$(du -sh "$OUT_DIR/qa-runner-k8s-${PREFIX}.tar.gz" | cut -f1)
  echo "OK  qa-runner-k8s-${PREFIX}.tar.gz ($RUNNER_SIZE)"
fi

# --- Generate README ---
cat > "$OUT_DIR/README-k8s-${PREFIX}.md" << README
# QA Infinity -- Kubernetes Release ${PREFIX}

**Registry:** ${REGISTRY}
**Stamp:**    ${STAMP}
**Commit:**   ${COMMIT}
**Built images:**
$([ "$BUILD_API" = true ] && echo "- \`qa-api-k8s-${PREFIX}.tar.gz\` ($API_SIZE) -> ${REGISTRY}/qa-api:${COMMIT}")
$([ "$BUILD_UI" = true ] && echo "- \`qa-ui-k8s-${PREFIX}.tar.gz\` ($UI_SIZE) -> ${REGISTRY}/qa-ui:${COMMIT}")
$([ "$BUILD_RUNNER" = true ] && echo "- \`qa-runner-k8s-${PREFIX}.tar.gz\` ($RUNNER_SIZE) -> ${REGISTRY}/qa-runner:${COMMIT}")

Every image above is tagged **only** with the commit SHA (\`${COMMIT}\`) --
never \`:latest\`. This is required for Kubernetes: \`imagePullPolicy:
IfNotPresent\` skips re-pulling a tag it already has cached, so a hotfix
needs a unique tag every time or the rollout silently keeps the old image.
See \`helm/qa-infinity/README.md\` for the full explanation.

---

## Recent commits included

$(git log --oneline -10 | sed 's/^/- /')

---

## Step 1 -- Transfer files to a machine with access to your internal registry

Physical handover -- USB, internal file share, secure email. This machine
does NOT need internet access, only a network path to \`${REGISTRY}\`:

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "scp releases/k8s/qa-api-k8s-${PREFIX}.tar.gz admin@<jump-host>:/data/")
$([ "$BUILD_UI" = true ] && echo "scp releases/k8s/qa-ui-k8s-${PREFIX}.tar.gz admin@<jump-host>:/data/")
$([ "$BUILD_RUNNER" = true ] && echo "scp releases/k8s/qa-runner-k8s-${PREFIX}.tar.gz admin@<jump-host>:/data/")
scp releases/k8s/README-k8s-${PREFIX}.md admin@<jump-host>:/data/
\`\`\`

---

## Step 2 -- On that machine: load and push to the internal registry

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "docker load -i /data/qa-api-k8s-${PREFIX}.tar.gz")
$([ "$BUILD_UI" = true ] && echo "docker load -i /data/qa-ui-k8s-${PREFIX}.tar.gz")
$([ "$BUILD_RUNNER" = true ] && echo "docker load -i /data/qa-runner-k8s-${PREFIX}.tar.gz")

$([ "$BUILD_API" = true ] && echo "docker push ${REGISTRY}/qa-api:${COMMIT}")
$([ "$BUILD_UI" = true ] && echo "docker push ${REGISTRY}/qa-ui:${COMMIT}")
$([ "$BUILD_RUNNER" = true ] && echo "docker push ${REGISTRY}/qa-runner:${COMMIT}")
\`\`\`

Images already carry the exact tag your registry expects -- no re-tagging
needed, since they were built against \`${REGISTRY}\` directly. If your
registry needs a login first: \`docker login ${REGISTRY}\` (or \`podman
login\`, and use \`podman push --tls-verify=false ...\` for an internal CA --
see the User Guide's "Harbor with an internal CA" note).

---

## Step 3 -- Roll out via Helm

\`\`\`bash
helm upgrade qa-infinity ./helm/qa-infinity \\
  -f ./helm/qa-infinity/values.yaml \\
  -f ./values-secrets.yaml \\
  --set image.registry=${REGISTRY} \\
  --set image.tag=${COMMIT} \\
  --namespace qa-infinity
\`\`\`

Rollback if needed: \`helm rollback qa-infinity\`.

---

## Step 4 -- Verify

\`\`\`bash
kubectl -n qa-infinity rollout status deployment/qa-api
kubectl -n qa-infinity exec deploy/qa-api -- curl -sf http://localhost:4000/health
\`\`\`
README

echo ""
echo "========================================"
echo "  Done!  Stamp: $STAMP  Commit: $COMMIT"
echo "  Folder: $OUT_DIR/"
echo ""
echo "  This release's files:"
ls -lh "$OUT_DIR/" | grep "$PREFIX"
echo ""
echo "  All k8s releases (latest last):"
ls -lt "$OUT_DIR/" | tail -n +2 | awk '{print "  " $NF}' | grep -v '^  $' | tail -20
echo ""
echo "  Next: transfer the files above, then follow README-k8s-${PREFIX}.md"
echo "========================================"

# --- Google Drive upload (auto, if rclone is configured) ---
# Same one-time setup as build-hotfix.sh (see that script's header) -- this
# reuses the same "gdrive" remote, just a separate folder.
GDRIVE_REMOTE="gdrive"
GDRIVE_FOLDER="QA-Infinity-K8s-Releases"

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
else
  echo ""
  echo "  [Drive] rclone not configured -- skipping upload."
  echo "  To enable: install rclone and run 'rclone config' to add a remote"
  echo "  named '${GDRIVE_REMOTE}' pointing to your Google Drive."
fi

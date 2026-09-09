#!/bin/bash
# =============================================================================
# release-k8s.sh — QA Infinity Kubernetes hotfix builder (multi-OpCo)
#
# Sibling to build-hotfix.sh, for K8s/OpenShift targets instead of
# docker-compose ones. Same physical-handover model (build here where you
# have internet, hand over a tarball, load+push happens on their side) —
# what's different is the tag scheme and the apply instructions:
#   - build-hotfix.sh tags :latest (correct for docker-compose, which always
#     force-recreates regardless of tag).
#   - This script tags with the commit SHA ONLY, against each target's own
#     registry path, because Kubernetes' imagePullPolicy: IfNotPresent skips
#     re-pulling a tag it already has cached — see helm/qa-infinity/README.md,
#     "Why the image tag can never be :latest here".
#
# Ships the SAME commit to MULTIPLE OpCos in one run. Each image is built
# exactly once (tagged locally, no registry prefix), then re-tagged and
# re-saved per --registry — no rebuilding per OpCo, since the underlying
# image is identical and only the destination registry path differs.
#
# Run this on the MAIN server (the one with source code and working internet).
#
# Usage:
#   chmod +x release-k8s.sh
#
#   # Single OpCo:
#   ./release-k8s.sh --registry harbor.opco1.local/qa-infinity
#
#   # Multiple OpCos in one run (repeat --registry) — built once, saved twice:
#   ./release-k8s.sh \
#     --registry opco1=harbor.opco1.local/qa-infinity \
#     --registry opco2=nexus.opco2.local:8082/qa-infinity
#
#   # `label=path` gives the output folder a friendly name (opco1/, opco2/).
#   # Omit the label and one is derived from the path instead.
#
#   ./release-k8s.sh --registry <path> --api-only     # skip qa-ui
#   ./release-k8s.sh --registry <path> --ui-only      # skip qa-api
#   ./release-k8s.sh --registry <path> --runner       # also build qa-runner
#   ./release-k8s.sh --registry <path> --runner-only  # qa-runner only (~1.5 GB)
#
# Output (all files land in ../releases/k8s-release/, one folder per release,
# one subfolder per OpCo inside it):
#   ../releases/k8s-release/<stamp>-<commit>/
#     RELEASE-SUMMARY.md          -- every OpCo in this run, at a glance
#     <opco-label>/
#       qa-api-k8s.tar.gz         (unless --ui-only or --runner-only)
#       qa-ui-k8s.tar.gz          (unless --api-only or --runner-only)
#       qa-runner-k8s.tar.gz      (only with --runner or --runner-only)
#       README.md                -- load/push/helm-upgrade steps for THIS OpCo
#
# Output folder is OUTSIDE the repo (../releases/k8s-release) — same
# convention as build-hotfix.sh's ../releases/hotfix — so tarballs are never
# committed to git and don't bloat the SharePoint-synced repo folder.
# =============================================================================

set -e

declare -a REGISTRIES=()   # each entry: "label|registry-path"
COMMIT=$(git rev-parse --short HEAD)
STAMP=$(date +%Y-%m-%d_%H%M)
OUT_DIR="../releases/k8s-release"
PREFIX="${STAMP}-${COMMIT}"
RELEASE_DIR="${OUT_DIR}/${PREFIX}"
BUILD_API=true
BUILD_UI=true
BUILD_RUNNER=false

# Turns "harbor.opco1.local/qa-infinity" into "harbor-opco1-local-qa-infinity"
# for use as a folder name when no explicit label=path is given.
sanitize_label() {
  echo "$1" | tr -c 'A-Za-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//'
}

# --- Parse flags ---
while [ $# -gt 0 ]; do
  case "$1" in
    --registry=*)
      val="${1#*=}"
      shift
      ;;
    --registry)
      val="$2"
      shift 2
      ;;
    --api-only)
      BUILD_UI=false; BUILD_RUNNER=false
      shift
      continue
      ;;
    --ui-only)
      BUILD_API=false; BUILD_RUNNER=false
      shift
      continue
      ;;
    --runner)
      BUILD_RUNNER=true
      shift
      continue
      ;;
    --runner-only)
      BUILD_API=false; BUILD_UI=false; BUILD_RUNNER=true
      shift
      continue
      ;;
    *)
      echo "WARNING: ignoring unrecognized argument: $1" >&2
      shift
      continue
      ;;
  esac
  # Only the --registry / --registry=* branches above fall through to here.
  if [ -z "$val" ]; then
    echo "ERROR: --registry requires a non-empty value" >&2
    exit 1
  fi
  case "$val" in
    *=*) label="$(sanitize_label "${val%%=*}")"; path="${val#*=}" ;;
    *)   label="$(sanitize_label "$val")";       path="$val" ;;
  esac
  REGISTRIES+=("${label}|${path}")
done

if [ ${#REGISTRIES[@]} -eq 0 ]; then
  echo "ERROR: at least one --registry <path> is required, e.g.:" >&2
  echo "  ./release-k8s.sh --registry harbor.internal.example.com/qa-infinity" >&2
  echo "" >&2
  echo "For multiple OpCos in one run, repeat the flag:" >&2
  echo "  ./release-k8s.sh --registry opco1=harbor.opco1.local/qa-infinity \\" >&2
  echo "                   --registry opco2=nexus.opco2.local:8082/qa-infinity" >&2
  echo "" >&2
  echo "Each path must match the image.registry value that OpCo's" >&2
  echo "helm/qa-infinity chart will be installed/upgraded with." >&2
  exit 1
fi

echo "========================================"
echo "  QA Infinity K8s Release Builder"
echo "  Commit   : $COMMIT"
echo "  Stamp    : $STAMP"
echo "  Output   : $RELEASE_DIR/"
echo "  API      : $BUILD_API"
echo "  UI       : $BUILD_UI"
echo "  Runner   : $BUILD_RUNNER"
echo "  OpCos    : ${#REGISTRIES[@]}"
for entry in "${REGISTRIES[@]}"; do
  echo "    - ${entry%%|*}  ->  ${entry#*|}"
done
echo "========================================"

mkdir -p "$RELEASE_DIR"

# --- Build each selected image ONCE, tagged locally (no registry prefix) ---
if [ "$BUILD_API" = true ]; then
  echo ""
  echo ">> Building qa-api:$COMMIT (once, reused for every OpCo below) ..."
  docker build -f packages/api/Dockerfile -t "qa-api:${COMMIT}" .
fi

if [ "$BUILD_UI" = true ]; then
  echo ""
  echo ">> Building qa-ui:$COMMIT (once, reused for every OpCo below) ..."
  docker build -f packages/frontend/Dockerfile -t "qa-ui:${COMMIT}" .
fi

if [ "$BUILD_RUNNER" = true ]; then
  echo ""
  echo ">> Building qa-runner:$COMMIT (large image -- this may take several minutes) ..."
  docker build -f packages/runner/Dockerfile -t "qa-runner:${COMMIT}" .
fi

# --- Re-tag + save once per OpCo (no rebuild — same image, different tag) ---
for entry in "${REGISTRIES[@]}"; do
  LABEL="${entry%%|*}"
  REGISTRY="${entry#*|}"
  OPCO_DIR="${RELEASE_DIR}/${LABEL}"
  mkdir -p "$OPCO_DIR"

  echo ""
  echo "---- OpCo: $LABEL  ($REGISTRY) ----"

  if [ "$BUILD_API" = true ]; then
    docker tag "qa-api:${COMMIT}" "${REGISTRY}/qa-api:${COMMIT}"
    docker save "${REGISTRY}/qa-api:${COMMIT}" | gzip > "${OPCO_DIR}/qa-api-k8s.tar.gz"
    API_SIZE=$(du -sh "${OPCO_DIR}/qa-api-k8s.tar.gz" | cut -f1)
    echo "OK  ${LABEL}/qa-api-k8s.tar.gz ($API_SIZE)"
  fi

  if [ "$BUILD_UI" = true ]; then
    docker tag "qa-ui:${COMMIT}" "${REGISTRY}/qa-ui:${COMMIT}"
    docker save "${REGISTRY}/qa-ui:${COMMIT}" | gzip > "${OPCO_DIR}/qa-ui-k8s.tar.gz"
    UI_SIZE=$(du -sh "${OPCO_DIR}/qa-ui-k8s.tar.gz" | cut -f1)
    echo "OK  ${LABEL}/qa-ui-k8s.tar.gz ($UI_SIZE)"
  fi

  if [ "$BUILD_RUNNER" = true ]; then
    docker tag "qa-runner:${COMMIT}" "${REGISTRY}/qa-runner:${COMMIT}"
    docker save "${REGISTRY}/qa-runner:${COMMIT}" | gzip > "${OPCO_DIR}/qa-runner-k8s.tar.gz"
    RUNNER_SIZE=$(du -sh "${OPCO_DIR}/qa-runner-k8s.tar.gz" | cut -f1)
    echo "OK  ${LABEL}/qa-runner-k8s.tar.gz ($RUNNER_SIZE)"
  fi

  # --- Per-OpCo README ---
  cat > "${OPCO_DIR}/README.md" << README
# QA Infinity -- Kubernetes Release for ${LABEL}

**Registry:** ${REGISTRY}
**Stamp:**    ${STAMP}
**Commit:**   ${COMMIT}
**Built images:**
$([ "$BUILD_API" = true ] && echo "- \`qa-api-k8s.tar.gz\` ($API_SIZE) -> ${REGISTRY}/qa-api:${COMMIT}")
$([ "$BUILD_UI" = true ] && echo "- \`qa-ui-k8s.tar.gz\` ($UI_SIZE) -> ${REGISTRY}/qa-ui:${COMMIT}")
$([ "$BUILD_RUNNER" = true ] && echo "- \`qa-runner-k8s.tar.gz\` ($RUNNER_SIZE) -> ${REGISTRY}/qa-runner:${COMMIT}")

Every image above is tagged **only** with the commit SHA (\`${COMMIT}\`) --
never \`:latest\`. This is required for Kubernetes: \`imagePullPolicy:
IfNotPresent\` skips re-pulling a tag it already has cached, so a hotfix
needs a unique tag every time or the rollout silently keeps the old image.
See \`helm/qa-infinity/README.md\` for the full explanation, including
registry-specific login examples (Harbor, Nexus, ECR, ACR, GitLab).

---

## Recent commits included

$(git log --oneline -10 | sed 's/^/- /')

---

## Step 1 -- Transfer this OpCo's files to a machine with access to its registry

Physical handover -- USB, internal file share, secure email. Only the
files in this \`${LABEL}/\` folder go to this OpCo -- other OpCos in the
same release have their own folder alongside this one, don't mix them up.
This machine does NOT need internet access, only a network path to
\`${REGISTRY}\`:

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "scp releases/k8s-release/${PREFIX}/${LABEL}/qa-api-k8s.tar.gz admin@<jump-host>:/data/")
$([ "$BUILD_UI" = true ] && echo "scp releases/k8s-release/${PREFIX}/${LABEL}/qa-ui-k8s.tar.gz admin@<jump-host>:/data/")
$([ "$BUILD_RUNNER" = true ] && echo "scp releases/k8s-release/${PREFIX}/${LABEL}/qa-runner-k8s.tar.gz admin@<jump-host>:/data/")
scp releases/k8s-release/${PREFIX}/${LABEL}/README.md admin@<jump-host>:/data/
\`\`\`

---

## Step 2 -- On that machine: load and push to ${LABEL}'s registry

\`\`\`bash
$([ "$BUILD_API" = true ] && echo "docker load -i /data/qa-api-k8s.tar.gz")
$([ "$BUILD_UI" = true ] && echo "docker load -i /data/qa-ui-k8s.tar.gz")
$([ "$BUILD_RUNNER" = true ] && echo "docker load -i /data/qa-runner-k8s.tar.gz")

$([ "$BUILD_API" = true ] && echo "docker push ${REGISTRY}/qa-api:${COMMIT}")
$([ "$BUILD_UI" = true ] && echo "docker push ${REGISTRY}/qa-ui:${COMMIT}")
$([ "$BUILD_RUNNER" = true ] && echo "docker push ${REGISTRY}/qa-runner:${COMMIT}")
\`\`\`

Images already carry the exact tag this registry expects -- no re-tagging
needed. If the registry needs a login first: \`docker login ${REGISTRY}\`
(see \`helm/qa-infinity/README.md\` for the exact command per registry
vendor -- Harbor, Nexus, ECR, ACR, GitLab all differ slightly).

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

done

# --- Top-level summary across all OpCos in this release ---
cat > "${RELEASE_DIR}/RELEASE-SUMMARY.md" << SUMMARY
# QA Infinity -- Kubernetes Release ${PREFIX}

**Stamp:**  ${STAMP}
**Commit:** ${COMMIT}
**OpCos in this release:** ${#REGISTRIES[@]}

| OpCo | Registry | Folder |
|---|---|---|
$(for entry in "${REGISTRIES[@]}"; do echo "| ${entry%%|*} | ${entry#*|} | \`${entry%%|*}/\` |"; done)

Each OpCo's folder is self-contained -- its own tarballs + its own
\`README.md\` with load/push/helm-upgrade steps for that specific registry.
Hand over only the relevant OpCo's subfolder to each team; don't ship the
whole release folder to a single OpCo.

## Recent commits included

$(git log --oneline -10 | sed 's/^/- /')
SUMMARY

echo ""
echo "========================================"
echo "  Done!  Stamp: $STAMP  Commit: $COMMIT"
echo "  Folder: $RELEASE_DIR/"
echo ""
echo "  OpCos in this release:"
for entry in "${REGISTRIES[@]}"; do
  echo "    - ${entry%%|*}/"
done
echo ""
echo "  Next: transfer each OpCo's subfolder to that OpCo, then follow its README.md"
echo "========================================"

# --- Google Drive upload (auto, if rclone is configured) ---
# Same one-time setup as build-hotfix.sh (see that script's header) -- this
# reuses the same "gdrive" remote, just a separate folder. Uploads the whole
# release (every OpCo subfolder) in one pass.
GDRIVE_REMOTE="gdrive"
GDRIVE_FOLDER="QA-Infinity-K8s-Releases"

if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q "^${GDRIVE_REMOTE}:"; then
  echo ""
  echo "--- Uploading to Google Drive (${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/${PREFIX}/) ---"
  rclone copy "$RELEASE_DIR/" "${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/${PREFIX}/" \
    --progress \
    --transfers 4
  echo ""
  echo "Drive upload complete. Files at:"
  rclone ls "${GDRIVE_REMOTE}:${GDRIVE_FOLDER}/${PREFIX}/" | \
    awk '{printf "  %-12s %s\n", $1, $2}'
else
  echo ""
  echo "  [Drive] rclone not configured -- skipping upload."
  echo "  To enable: install rclone and run 'rclone config' to add a remote"
  echo "  named '${GDRIVE_REMOTE}' pointing to your Google Drive."
fi

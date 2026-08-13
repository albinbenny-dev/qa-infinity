#!/usr/bin/env bash
# release.sh — Build a versioned release bundle for air-gapped server deployments.
#
# Run this on your dev machine (or CI) — it needs Docker + internet access to
# pull the postgres/redis base images.  The resulting .tar.gz is everything an
# air-gapped server needs.
#
# Usage:
#   ./release.sh v1.0.0                  # full build
#   ./release.sh v1.0.0 --skip-runner    # omit the heavy runner image
#   ./release.sh v1.0.0 --no-infra       # omit postgres + redis (already on server)
#   ./release.sh v1.0.0 --no-tag         # build without creating a git tag
#
# Output:  ./qa-infinity-v1.0.0.tar.gz   (copy this to each air-gapped server)
#
# On the server:
#   tar xzf qa-infinity-v1.0.0.tar.gz
#   cd qa-infinity-v1.0.0
#   cp .env.example .env && nano .env    # first time only
#   ./deploy-offline.sh

set -euo pipefail

# ── Parse arguments ──────────────────────────────────────────────────────────
VERSION="${1:?Usage: $0 <version> [--skip-runner] [--no-infra] [--no-tag]}"
shift || true

SKIP_RUNNER=false
INCLUDE_INFRA=true
CREATE_TAG=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-runner) SKIP_RUNNER=true ;;
    --no-infra)    INCLUDE_INFRA=false ;;
    --no-tag)      CREATE_TAG=false ;;
    *) echo "✗ Unknown option: $1"; exit 1 ;;
  esac
  shift
done

# ── Environment ──────────────────────────────────────────────────────────────
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_NAME="qa-infinity-${VERSION}"
TMP_DIR="$(mktemp -d)/release-$$"
OUT="${DIR}/${BUNDLE_NAME}.tar.gz"

if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  SUDO=""
elif command -v sudo &>/dev/null; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "▶ Building release bundle  ${BUNDLE_NAME}"
echo "  skip-runner : $SKIP_RUNNER"
echo "  include-infra: $INCLUDE_INFRA"
echo ""

cd "$DIR"

# ── 1. Git tag ───────────────────────────────────────────────────────────────
if [ "$CREATE_TAG" = true ]; then
  if git tag -l "${VERSION}" | grep -q "^${VERSION}$"; then
    echo "⚠  Git tag ${VERSION} already exists — skipping creation"
  else
    echo "⟳ Tagging git commit as ${VERSION}…"
    git tag -a "${VERSION}" -m "Release ${VERSION}"
    echo "✔ Tagged  $(git log -1 --format='%h %s')"
  fi
  echo ""
fi

# ── 2. Build app images ──────────────────────────────────────────────────────
echo "⟳ Building app images…"

echo "  » qa-api"
DOCKER_BUILDKIT=0 $SUDO $DC -p qa-infinity build qa-api
$SUDO docker tag qa-infinity-qa-api:latest "qa-infinity-qa-api:${VERSION}"

echo "  » qa-ui"
DOCKER_BUILDKIT=0 $SUDO $DC -p qa-infinity build qa-ui
$SUDO docker tag qa-infinity-qa-ui:latest "qa-infinity-qa-ui:${VERSION}"

if [ "$SKIP_RUNNER" = false ]; then
  echo "  » qa-runner  (this takes the longest — grab a coffee ☕)"
  DOCKER_BUILDKIT=0 $SUDO $DC -p qa-infinity build qa-runner
  $SUDO docker tag qa-infinity-qa-runner:latest "qa-infinity-qa-runner:${VERSION}"
fi

echo "✔ App images built"
echo ""

# ── 3. Pull infrastructure images ────────────────────────────────────────────
if [ "$INCLUDE_INFRA" = true ]; then
  echo "⟳ Pulling infrastructure images…"
  $SUDO docker pull postgres:16-alpine
  $SUDO docker pull redis:7-alpine
  echo "✔ Infrastructure images ready"
  echo ""
fi

# ── 4. Save images to compressed tar ─────────────────────────────────────────
echo "⟳ Saving images (this writes several GB — be patient)…"
mkdir -p "${TMP_DIR}/${BUNDLE_NAME}/images"

save() {
  local name="$1" tag="$2" file="$3"
  printf "  %-20s" "» ${name}"
  $SUDO docker save "${tag}" | gzip > "${TMP_DIR}/${BUNDLE_NAME}/images/${file}"
  echo "  $(du -sh "${TMP_DIR}/${BUNDLE_NAME}/images/${file}" | cut -f1)"
}

save "qa-api"              "qa-infinity-qa-api:${VERSION}"     "qa-api.tar.gz"
save "qa-ui"               "qa-infinity-qa-ui:${VERSION}"      "qa-ui.tar.gz"
if [ "$SKIP_RUNNER" = false ]; then
  save "qa-runner"         "qa-infinity-qa-runner:${VERSION}"  "qa-runner.tar.gz"
fi
if [ "$INCLUDE_INFRA" = true ]; then
  save "postgres:16-alpine" "postgres:16-alpine"               "postgres.tar.gz"
  save "redis:7-alpine"     "redis:7-alpine"                   "redis.tar.gz"
fi

echo "✔ Images saved"
echo ""

# ── 5. Bundle config & helper files ──────────────────────────────────────────
echo "⟳ Bundling config files…"
BDIR="${TMP_DIR}/${BUNDLE_NAME}"

cp "${DIR}/docker-compose.yml"   "${BDIR}/"
cp "${DIR}/.env.example"         "${BDIR}/"
cp "${DIR}/backup.sh"            "${BDIR}/"
chmod +x "${BDIR}/backup.sh"
mkdir -p "${BDIR}/nginx"
cp "${DIR}/nginx/nginx.conf"     "${BDIR}/nginx/"
cp "${DIR}/nginx/runner-lb.conf" "${BDIR}/nginx/" 2>/dev/null || true

# Write a VERSION manifest
{
  echo "${VERSION}"
  git log -1 --format='%H'
  date -u '+%Y-%m-%d %H:%M:%S UTC'
  echo "skip-runner=${SKIP_RUNNER}"
  echo "include-infra=${INCLUDE_INFRA}"
} > "${BDIR}/VERSION"

echo "✔ Config bundled"
echo ""

# ── 6. Write deploy-offline.sh into the bundle ───────────────────────────────
# NOTE: single-quoted HEREDOC — nothing is expanded at write time.
# All $ variables are resolved when deploy-offline.sh runs on the server.
cat > "${BDIR}/deploy-offline.sh" << 'EOF'
#!/usr/bin/env bash
# deploy-offline.sh — Load images and start qa-infinity on an air-gapped server.
#
# Usage:
#   cd qa-infinity-vX.Y.Z/
#   cp .env.example .env && nano .env    # first time only
#   ./deploy-offline.sh
#   ./deploy-offline.sh --skip-runner    # if runner was not included in the bundle

set -euo pipefail

SKIP_RUNNER=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-runner) SKIP_RUNNER=true ;;
    *) echo "✗ Unknown option: $1"; exit 1 ;;
  esac
  shift
done

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
  SUDO=""
elif command -v sudo &>/dev/null; then
  SUDO="sudo"
else
  SUDO=""
fi

VERSION="$(head -1 "${DIR}/VERSION" 2>/dev/null || echo 'unknown')"
echo "▶ Deploying qa-infinity ${VERSION} (offline)"
echo ""

# ── Preflight ─────────────────────────────────────────────────────────────────
if [ ! -f "${DIR}/.env" ]; then
  echo "✗ .env file not found."
  echo "  cp ${DIR}/.env.example ${DIR}/.env"
  echo "  nano ${DIR}/.env"
  echo "  (set POSTGRES_PASSWORD and any other site-specific values)"
  exit 1
fi

# ── Load images ───────────────────────────────────────────────────────────────
echo "⟳ Loading Docker images…"

load_image() {
  local label="$1" file="$2"
  if [ -f "$file" ]; then
    printf "  %-20s" "» ${label}"
    $SUDO docker load < "$file"
  else
    echo "  ⚠  ${label}: not found in bundle (skipping)"
  fi
}

load_image "postgres"    "${DIR}/images/postgres.tar.gz"
load_image "redis"       "${DIR}/images/redis.tar.gz"
load_image "qa-api"      "${DIR}/images/qa-api.tar.gz"
load_image "qa-ui"       "${DIR}/images/qa-ui.tar.gz"
if [ "$SKIP_RUNNER" = false ]; then
  load_image "qa-runner" "${DIR}/images/qa-runner.tar.gz"
fi

echo "✔ Images loaded"
echo ""

# Tag versioned images as :latest so docker-compose.yml finds them
echo "⟳ Tagging images as :latest…"
$SUDO docker tag "qa-infinity-qa-api:${VERSION}"    qa-infinity-qa-api:latest    2>/dev/null || true
$SUDO docker tag "qa-infinity-qa-ui:${VERSION}"     qa-infinity-qa-ui:latest     2>/dev/null || true
if [ "$SKIP_RUNNER" = false ]; then
  $SUDO docker tag "qa-infinity-qa-runner:${VERSION}" qa-infinity-qa-runner:latest 2>/dev/null || true
fi
echo "✔ Tagged"
echo ""

# ── Warn about local compose edits ────────────────────────────────────────────
if ! git -C "${DIR}" diff --quiet -- docker-compose.yml 2>/dev/null; then
  echo "⚠  docker-compose.yml has local edits — they will be kept (offline mode)."
  echo "   If something looks wrong, diff against the bundle's copy."
  echo ""
fi

# ── Start containers (no build — images are already loaded) ───────────────────
echo "⟳ Starting containers…"
cd "${DIR}"
$SUDO $DC -p qa-infinity up -d --no-build

echo ""
$SUDO $DC -p qa-infinity ps
echo ""
echo "✅ Deploy complete  (version ${VERSION})"
echo ""
echo "Tip: set up daily DB backups with:"
echo "  (crontab -l 2>/dev/null; echo \"0 2 * * * ${DIR}/backup.sh\") | crontab -"
EOF
chmod +x "${BDIR}/deploy-offline.sh"

# ── 7. Create the final archive ───────────────────────────────────────────────
echo "⟳ Creating archive…"
cd "${TMP_DIR}"
tar czf "${OUT}" "${BUNDLE_NAME}/"
rm -rf "${TMP_DIR}"

SIZE=$(du -sh "${OUT}" | cut -f1)

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ Release bundle ready                                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  File  : ${BUNDLE_NAME}.tar.gz  (${SIZE})"
echo "  Tag   : ${VERSION}  →  push with:  git push origin ${VERSION}"
echo ""
echo "  Scenario 1 — server has internet:"
echo "    (server already has the remote pointing to 6D git)"
echo "    ssh server  →  cd qa-infinity  →  ./sync.sh"
echo ""
echo "  Scenario 2 — air-gapped server:"
echo "    scp ${BUNDLE_NAME}.tar.gz  server:/opt/"
echo "    ssh server"
echo "      tar xzf /opt/${BUNDLE_NAME}.tar.gz -C /opt/"
echo "      cd /opt/${BUNDLE_NAME}"
echo "      cp .env.example .env && nano .env   # first-time only"
echo "      ./deploy-offline.sh"
echo ""

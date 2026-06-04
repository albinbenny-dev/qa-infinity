#!/usr/bin/env bash
# =============================================================================
#  release-deploy.sh  (run on RHEL server)
#
#  What it does:
#    1.  Checks release files exist in /data/autoab/QA_INFINITY_RELEASE/
#    2.  Stops running containers
#    3.  Backs up existing server DB (safety net)
#    4.  Imports new DB into Docker volume
#    5.  Imports scripts into Docker volume
#    6.  Imports reqdocs into Docker volume
#    7.  Extracts new app code
#    8.  Rebuilds and starts all containers
#    9.  Health checks and status report
#
#  Run on server:
#    cd /data/autoab/qa-infinity
#    sudo bash release-deploy.sh
# =============================================================================

set -euo pipefail

# -- Paths --------------------------------------------------------------------
APP_DIR="/data/autoab/qa-infinity"
RELEASE_DIR="/data/autoab/QA_INFINITY_RELEASE"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")
SERVER_BACKUP_DIR="/data/autoab/QA_INFINITY_RELEASE/server-backups/$TIMESTAMP"

# -- Docker volume names (project name = qa-infinity from docker-compose.yml) --
VOL_DATA="qa-infinity_qa-data"
VOL_SCRIPTS="qa-infinity_qa-scripts"
VOL_REQDOCS="qa-infinity_qa-reqdocs"

# -- Colors -------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m'

step()  { echo -e "\n  ${CYAN}[$1]${NC} $2"; }
ok()    { echo -e "    ${GREEN}OK${NC}  $1"; }
warn()  { echo -e "    ${YELLOW}--${NC}  $1"; }
err()   { echo -e "    ${RED}!!${NC}  $1"; }
info()  { echo -e "    ${GRAY}    $1${NC}"; }

# -- Detect docker compose command (v2 plugin preferred over legacy v1) --------
if docker compose version &>/dev/null 2>&1; then
    DC="docker compose"
elif command -v docker-compose &>/dev/null; then
    DC="docker-compose"
else
    echo -e "  ${RED}!!${NC}  Neither 'docker compose' nor 'docker-compose' found. Install Docker CE."
    exit 1
fi

# =============================================================================
echo ""
echo -e "  ${CYAN}==========================================${NC}"
echo -e "  ${CYAN}  QA Infinity -- Release Deploy${NC}"
echo -e "  ${CYAN}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "  ${CYAN}  docker compose: $DC${NC}"
echo -e "  ${CYAN}==========================================${NC}"

# =============================================================================
# GUARD: must run as root or with sudo access
# =============================================================================
if [[ $EUID -ne 0 ]]; then
    err "Run with sudo: sudo bash release-deploy.sh"
    exit 1
fi

# =============================================================================
# STEP 1/9 -- Verify release files exist
# =============================================================================
step "1/9" "Checking release files in $RELEASE_DIR..."

MISSING=0
for required in "qa-infinity-app.zip" "qa-infinity.db"; do
    if [[ -f "$RELEASE_DIR/$required" ]]; then
        size=$(du -sh "$RELEASE_DIR/$required" | cut -f1)
        ok "Found: $required ($size)"
    else
        err "MISSING: $required"
        MISSING=$((MISSING + 1))
    fi
done

if [[ $MISSING -gt 0 ]]; then
    err "$MISSING required file(s) missing. Run release-push.ps1 on Windows first."
    exit 1
fi

# Verify Prisma schema is inside the zip (informational — real check is post-extraction in step 7)
if unzip -l "$RELEASE_DIR/qa-infinity-app.zip" 2>/dev/null | grep -q "schema\.prisma"; then
    ok "Prisma schema.prisma found in app zip"
else
    warn "schema.prisma not detected in zip listing (may be a path-format false-positive)"
    info "Continuing -- step 7 will confirm the file landed on disk after extraction"
fi

# Optional folders (warn but don't fail)
for optional in "qa-scripts" "qa-reqdocs"; do
    if [[ -d "$RELEASE_DIR/$optional" ]]; then
        count=$(find "$RELEASE_DIR/$optional" -type f | wc -l)
        ok "Found: $optional/ ($count files)"
    else
        warn "Optional folder not found, skipping: $optional/"
    fi
done

# =============================================================================
# STEP 2/9 -- Stop containers
# =============================================================================
step "2/9" "Stopping Docker containers..."

cd "$APP_DIR"
$DC down || true
ok "Containers stopped"

# =============================================================================
# STEP 3/9 -- Backup current server DB (safety net before overwriting)
# =============================================================================
step "3/9" "Backing up current server DB..."

mkdir -p "$SERVER_BACKUP_DIR"

docker run --rm \
    -v "${VOL_DATA}:/data" \
    -v "${SERVER_BACKUP_DIR}:/backup" \
    alpine sh -c 'if [ -f /data/qa-infinity.db ]; then cp /data/qa-infinity.db /backup/qa-infinity.db && echo "  backup-ok"; else echo "  no-existing-db (first deploy?)"; fi'

ok "Server DB backup saved to: $SERVER_BACKUP_DIR"

# =============================================================================
# STEP 4/9 -- Import new DB into Docker volume
# =============================================================================
step "4/9" "Importing database into Docker volume..."

docker run --rm \
    -v "${VOL_DATA}:/data" \
    -v "${RELEASE_DIR}:/release" \
    alpine cp /release/qa-infinity.db /data/qa-infinity.db

# Verify file landed
db_size=$(docker run --rm \
    -v "${VOL_DATA}:/data" \
    alpine sh -c 'du -sh /data/qa-infinity.db 2>/dev/null | cut -f1 || echo "0"')
ok "DB imported into volume ($db_size)"

# =============================================================================
# STEP 5/9 -- Import scripts into Docker volume
# =============================================================================
step "5/9" "Importing scripts into Docker volume..."

if [[ -d "$RELEASE_DIR/qa-scripts" ]]; then
    file_count=$(find "$RELEASE_DIR/qa-scripts" -type f | wc -l)

    docker run --rm \
        -v "${VOL_SCRIPTS}:/scripts" \
        -v "${RELEASE_DIR}/qa-scripts:/backup" \
        alpine sh -c 'rm -rf /scripts/* && cp -r /backup/. /scripts/ && echo done'

    ok "Scripts imported ($file_count files)"
else
    warn "No qa-scripts/ folder in release -- volume unchanged"
fi

# =============================================================================
# STEP 5b -- Ensure artifacts volume is writable (first-deploy safety check)
# =============================================================================
step "5b" "Initialising artifacts volume..."

VOL_ARTIFACTS="qa-infinity_qa-artifacts"
docker run --rm \
    -v "${VOL_ARTIFACTS}:/artifacts" \
    alpine sh -c 'mkdir -p /artifacts && touch /artifacts/.init && echo ok'
ok "Artifacts volume is writable at /artifacts"

# =============================================================================
# STEP 6/9 -- Import requirement docs into Docker volume
# =============================================================================
step "6/9" "Importing requirement docs into Docker volume..."

if [[ -d "$RELEASE_DIR/qa-reqdocs" ]]; then
    file_count=$(find "$RELEASE_DIR/qa-reqdocs" -type f | wc -l)

    docker run --rm \
        -v "${VOL_REQDOCS}:/requirements" \
        -v "${RELEASE_DIR}/qa-reqdocs:/backup" \
        alpine sh -c 'rm -rf /requirements/* && cp -r /backup/. /requirements/ && echo done'

    ok "Requirement docs imported ($file_count files)"
else
    warn "No qa-reqdocs/ folder in release -- volume unchanged"
fi

# =============================================================================
# STEP 7/9 -- Extract app code
# =============================================================================
step "7/9" "Extracting app code to $APP_DIR..."

# Extract using Python so Windows backslash paths are normalised to forward slashes.
# Plain 'unzip' treats backslashes as part of the filename on Linux and exits with
# code 1 (warning), which kills the script under set -e.
python3 - <<'PYEOF'
import zipfile, os, sys

zpath = "/data/autoab/QA_INFINITY_RELEASE/qa-infinity-app.zip"
dest  = "/data/autoab/qa-infinity"

with zipfile.ZipFile(zpath) as z:
    for member in z.infolist():
        name   = member.filename.replace("\\", "/")  # normalise Windows paths
        target = os.path.join(dest, name)
        if name.endswith("/"):
            os.makedirs(target, exist_ok=True)
        else:
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(member) as src, open(target, "wb") as dst:
                dst.write(src.read())

print("  extraction complete")
PYEOF

# Fix ownership (extraction runs as root; app runs as admin)
chown -R admin:admin "$APP_DIR" 2>/dev/null || true

ok "App code extracted"

# Verify Prisma schema was extracted successfully
SCHEMA_PATH="$APP_DIR/packages/api/prisma/schema.prisma"
if [[ -f "$SCHEMA_PATH" ]]; then
    model_count=$(grep -c "^model " "$SCHEMA_PATH" || echo "0")
    mig_count=$(find "$APP_DIR/packages/api/prisma/migrations" -name "*.sql" 2>/dev/null | wc -l)
    ok "Prisma schema OK -- $model_count models, $mig_count migration file(s)"
else
    err "Prisma schema.prisma not found after extraction: $SCHEMA_PATH"
    err "The Docker build will fail or use a stale Prisma client."
    info "Re-run release-push.ps1 on Windows, then retry."
    exit 1
fi

# =============================================================================
# STEP 8/9 -- Rebuild and start containers
# =============================================================================
step "8/9" "Building and starting containers..."

cd "$APP_DIR"
$DC up --build -d

ok "Containers started"

# Inject internal CA cert so the API can reach internal HTTPS endpoints
step "8b" "Installing OCP Lab CA certificate into qa-api..."
if [[ -f "/data/autoab/ocplab-ca.crt" ]]; then
    docker cp /data/autoab/ocplab-ca.crt qa-api:/usr/local/share/ca-certificates/ocplab-ca.crt
    docker exec qa-api update-ca-certificates
    ok "CA cert installed and trust store updated"
else
    warn "CA cert not found at /data/autoab/ocplab-ca.crt -- skipping (API may fail on internal HTTPS)"
fi

info "Waiting 30 s for health checks..."
sleep 30

# =============================================================================
# STEP 9/9 -- Health checks and status report
# =============================================================================
step "9/9" "Running health checks..."

echo ""
echo -e "  ${CYAN}-- Container Status --${NC}"
$DC ps

# API HTTP health
echo ""
echo -e "  ${CYAN}-- API Health Check --${NC}"
http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null || echo "000")

if [[ "$http_code" == "200" ]]; then
    ok "API is healthy (HTTP $http_code)"
else
    warn "API returned HTTP $http_code -- may still be starting"
    info "Watch logs: sudo $DC logs -f qa-api"
fi

# DB sanity check -- use Node.js (sqlite3 binary not in the container image)
echo ""
echo -e "  ${CYAN}-- Database Check --${NC}"
user_count=$(docker exec qa-api node -e \
    "const fs=require('fs'); const s=fs.statSync('/data/qa-infinity.db'); console.log('db-size:'+s.size);" \
    2>/dev/null | grep -o '[0-9]*' || echo "error")

if [[ "$user_count" =~ ^[0-9]+$ && "$user_count" -gt 0 ]]; then
    ok "Database file found on volume (${user_count} bytes)"
else
    warn "Could not stat DB file inside container (count: $user_count)"
    info "Check manually: docker exec qa-api ls -lh /data/qa-infinity.db"
fi

# Prisma client / schema mismatch check
echo ""
echo -e "  ${CYAN}-- Prisma Client Check --${NC}"
prisma_errors=$($DC logs qa-api 2>/dev/null \
    | grep -c "PrismaClientValidationError\|Unknown field.*include\|Unknown field.*where" || true)

if [[ "$prisma_errors" -gt 0 ]]; then
    err "Prisma validation errors detected in API logs ($prisma_errors occurrence(s))!"
    warn "Root cause: schema.prisma in the release zip was out of date."
    info "Fix:"
    info "  1. On Windows: run .\\release-push.ps1  (ensure local schema is latest)"
    info "  2. On server:  run sudo bash release-deploy.sh"
    echo ""
    echo -e "  ${YELLOW}-- Prisma error snippet --${NC}"
    $DC logs --tail=40 qa-api 2>/dev/null \
        | grep -A2 "PrismaClientValidationError\|Unknown field" \
        | head -20 || true
else
    ok "No Prisma validation errors -- schema and client are in sync"
fi

# =============================================================================
# Done
# =============================================================================
echo ""
echo -e "  ${GREEN}==========================================${NC}"
echo -e "  ${GREEN}  DEPLOY COMPLETE${NC}"
echo -e "  ${GREEN}==========================================${NC}"
echo -e "  App URL    : http://$(hostname -I | awk '{print $1}'):3000"
echo -e "  App dir    : $APP_DIR"
echo -e "  DB backup  : $SERVER_BACKUP_DIR"
echo -e "  Deployed at: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo -e "  Useful commands:"
echo -e "    sudo $DC ps"
echo -e "    sudo $DC logs -f qa-api"
echo -e "    sudo $DC logs -f qa-runner"
echo ""

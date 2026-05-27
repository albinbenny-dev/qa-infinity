#!/usr/bin/env bash
# =============================================================================
#  release-deploy.sh  (run on RHEL server)
#
#  What it does:
#    1. Checks release files exist in /data/autoab/QA_INFINITY_RELEASE/
#    2. Stops running containers
#    3. Backs up existing server DB (safety net)
#    4. Imports new DB into Docker volume
#    5. Imports scripts into Docker volume
#    6. Imports reqdocs into Docker volume
#    7. Extracts new app code
#    8. Rebuilds and starts all containers
#    9. Health checks and status report
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

# =============================================================================
echo ""
echo -e "  ${CYAN}==========================================${NC}"
echo -e "  ${CYAN}  QA Infinity -- Release Deploy${NC}"
echo -e "  ${CYAN}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "  ${CYAN}==========================================${NC}"

# =============================================================================
# GUARD: must run as root or with sudo access
# =============================================================================
if [[ $EUID -ne 0 ]]; then
    err "Run with sudo: sudo bash release-deploy.sh"
    exit 1
fi

# =============================================================================
# STEP 1 -- Verify release files exist
# =============================================================================
step "1/8" "Checking release files in $RELEASE_DIR..."

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

# Verify Prisma schema is inside the zip (catches schema-not-pushed issues early)
# tr converts Windows backslashes (Compress-Archive) to forward slashes before grepping
if unzip -l "$RELEASE_DIR/qa-infinity-app.zip" 2>/dev/null | tr '\\' '/' | grep -q "packages/api/prisma/schema.prisma"; then
    ok "Prisma schema.prisma found in app zip"
else
    err "Prisma schema.prisma is MISSING from the app zip!"
    err "The server will build with a stale schema and Prisma queries will fail."
    info "Re-run release-push.ps1 on Windows to include the latest schema, then retry."
    exit 1
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
# STEP 2 -- Stop containers
# =============================================================================
step "2/8" "Stopping Docker containers..."

cd "$APP_DIR"
docker-compose down
ok "Containers stopped"

# =============================================================================
# STEP 3 -- Backup current server DB (safety net before overwriting)
# =============================================================================
step "3/8" "Backing up current server DB..."

mkdir -p "$SERVER_BACKUP_DIR"

# Extract existing DB from volume to backup folder
docker run --rm \
    -v "${VOL_DATA}:/data" \
    -v "${SERVER_BACKUP_DIR}:/backup" \
    alpine sh -c 'if [ -f /data/qa-infinity.db ]; then cp /data/qa-infinity.db /backup/qa-infinity.db && echo "backup-ok"; else echo "no-existing-db"; fi'

ok "Server DB backed up to: $SERVER_BACKUP_DIR"

# =============================================================================
# STEP 4 -- Import new DB into Docker volume
# =============================================================================
step "4/8" "Importing database into Docker volume..."

docker run --rm \
    -v "${VOL_DATA}:/data" \
    -v "${RELEASE_DIR}:/release" \
    alpine cp /release/qa-infinity.db /data/qa-infinity.db

# Verify
db_size=$(docker run --rm \
    -v "${VOL_DATA}:/data" \
    alpine sh -c 'du -sh /data/qa-infinity.db 2>/dev/null | cut -f1 || echo "0"')
ok "DB imported into volume ($db_size)"

# =============================================================================
# STEP 5 -- Import scripts into Docker volume
# =============================================================================
step "5/8" "Importing scripts into Docker volume..."

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
# STEP 6 -- Import requirement docs into Docker volume
# =============================================================================
step "6/8" "Importing requirement docs into Docker volume..."

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
# STEP 7 -- Extract app code
# =============================================================================
step "7/8" "Extracting app code to $APP_DIR..."

# Fix ownership before extracting
chown -R admin:admin "$APP_DIR" 2>/dev/null || true

# Unzip (overwrite existing files, skip prompt)
unzip -o "$RELEASE_DIR/qa-infinity-app.zip" -d "$APP_DIR" > /dev/null

# Fix ownership again (zip extraction runs as root)
chown -R admin:admin "$APP_DIR" 2>/dev/null || true

ok "App code extracted"

# Verify Prisma schema was extracted and is the current version
SCHEMA_PATH="$APP_DIR/packages/api/prisma/schema.prisma"
if [[ -f "$SCHEMA_PATH" ]]; then
    model_count=$(grep -c "^model " "$SCHEMA_PATH" || echo "0")
    mig_count=$(find "$APP_DIR/packages/api/prisma/migrations" -name "*.sql" 2>/dev/null | wc -l)
    ok "Prisma schema OK -- $model_count models, $mig_count migration file(s)"
else
    err "Prisma schema.prisma not found after extraction: $SCHEMA_PATH"
    err "The Docker build will fail or generate a stale Prisma client."
    info "Re-run release-push.ps1 on Windows, then retry."
    exit 1
fi

# =============================================================================
# STEP 8 -- Rebuild and start containers
# =============================================================================
step "8/8" "Building and starting containers..."

cd "$APP_DIR"
docker-compose up --build -d

ok "Containers started -- waiting for health checks..."
echo ""
info "Waiting 30 seconds for services to become healthy..."
sleep 30

# =============================================================================
# Health check
# =============================================================================
echo ""
echo -e "  ${CYAN}-- Container Status --${NC}"
docker-compose ps

echo ""
echo -e "  ${CYAN}-- API Health Check --${NC}"
http_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null || echo "000")

if [[ "$http_code" == "200" ]]; then
    ok "API is healthy (HTTP $http_code)"
else
    warn "API returned HTTP $http_code -- may still be starting up"
    info "Check logs: sudo docker-compose logs -f qa-api"
fi

# Quick DB sanity check -- count users
echo ""
echo -e "  ${CYAN}-- Database Check --${NC}"
user_count=$(docker exec qa-api sh -c \
    'sqlite3 /data/qa-infinity.db "SELECT COUNT(*) FROM User;" 2>/dev/null || echo "error"')

if [[ "$user_count" =~ ^[0-9]+$ && "$user_count" -gt 0 ]]; then
    ok "Database OK -- $user_count user(s) found"
else
    warn "Could not verify DB users (count: $user_count)"
    info "Try: docker exec qa-api sqlite3 /data/qa-infinity.db 'SELECT email FROM User;'"
fi

# =============================================================================
# Prisma client check -- catch schema/client mismatches before they hit users
# =============================================================================
echo ""
echo -e "  ${CYAN}-- Prisma Client Check --${NC}"
prisma_errors=$(docker-compose logs qa-api 2>/dev/null \
    | grep -c "PrismaClientValidationError\|Unknown field.*include\|Unknown field.*where" || true)

if [[ "$prisma_errors" -gt 0 ]]; then
    err "Prisma validation errors detected in API logs ($prisma_errors occurrence(s))!"
    warn "Root cause: schema.prisma in the release zip was out of date."
    info "Fix:"
    info "  1. On Windows: run .\\release-push.ps1 (ensure local schema is latest)"
    info "  2. On server:  run sudo bash release-deploy.sh"
    echo ""
    echo -e "  ${YELLOW}-- Prisma error snippet --${NC}"
    docker-compose logs --tail=40 qa-api 2>/dev/null \
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
echo -e "    sudo docker-compose ps"
echo -e "    sudo docker-compose logs -f qa-api"
echo -e "    sudo docker-compose logs -f qa-runner"
echo ""

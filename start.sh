#!/usr/bin/env bash
# ==============================================================================
# QA Infinity — Linux/Remote Server Startup Script
#
# First time:  ./start.sh         (sets up .env, builds images, starts stack)
# After that:  ./start.sh         (starts existing stack — fast)
#              ./start.sh --build  (force-rebuild images after code changes)
#              ./start.sh --stop   (stop all containers)
#              ./start.sh --logs   (tail live logs)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD=false
STOP=false
LOGS=false

for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    --stop)  STOP=true  ;;
    --logs)  LOGS=true  ;;
  esac
done

step()  { echo -e "\n==> $1"; }
ok()    { echo "    [OK] $1"; }
warn()  { echo "    [!!] $1"; }
err()   { echo "    [ERR] $1"; }

echo ""
echo "  QA Infinity"
echo "  ─────────────────────────────────────────────"
echo ""

cd "$SCRIPT_DIR"

# ==============================================================================
# Detect whether sudo is needed to reach the Docker socket
# ==============================================================================
DOCKER="docker"
if ! docker info > /dev/null 2>&1; then
  if sudo docker info > /dev/null 2>&1; then
    DOCKER="sudo docker"
  fi
fi

# -- Stop mode -----------------------------------------------------------------
if $STOP; then
  step "Stopping QA Infinity"
  $DOCKER compose stop
  ok "All containers stopped. Data is preserved."
  exit 0
fi

# -- Logs mode -----------------------------------------------------------------
if $LOGS; then
  $DOCKER compose logs -f --tail=50
  exit 0
fi

# ==============================================================================
# STEP 1 — Check Docker
# ==============================================================================
step "Checking Docker"
if ! $DOCKER info > /dev/null 2>&1; then
  err "Docker is not running or not accessible."
  echo "    Start Docker and try again (or run: sudo systemctl start docker)"
  exit 1
fi
if [ "$DOCKER" = "sudo docker" ]; then
  ok "Docker is running (using sudo — add user to 'docker' group to avoid this)"
else
  ok "Docker is running"
fi

# ==============================================================================
# STEP 2 — First-time .env setup
# ==============================================================================
step "Checking environment configuration"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  warn ".env not found — creating from .env.example"
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"

  echo ""
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  ACTION REQUIRED: fill in your .env file            │"
  echo "  │                                                       │"
  echo "  │  Required fields (marked ★ in the file):            │"
  echo "  │    POSTGRES_PASSWORD  — pick any strong password     │"
  echo "  │    JWT_SECRET         — paste 2-3 random UUIDs       │"
  echo "  │    ANTHROPIC_API_KEY  — or set LLM_PROVIDER and key  │"
  echo "  │                                                       │"
  echo "  │  Edit .env and re-run ./start.sh to continue.       │"
  echo "  └─────────────────────────────────────────────────────┘"
  echo ""
  exit 1
fi

# Validate required fields
read_env() {
  grep -E "^\s*$1\s*=" "$SCRIPT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs
}

missing=()
[ -z "$(read_env POSTGRES_PASSWORD)" ] && missing+=("POSTGRES_PASSWORD")
[ -z "$(read_env JWT_SECRET)" ]         && missing+=("JWT_SECRET")

provider="$(read_env LLM_PROVIDER)"
provider="${provider:-openrouter}"
case "$provider" in
  openrouter) [ -z "$(read_env OPENROUTER_API_KEY)" ] && missing+=("OPENROUTER_API_KEY") ;;
  anthropic)  [ -z "$(read_env ANTHROPIC_API_KEY)"  ] && missing+=("ANTHROPIC_API_KEY")  ;;
esac

if [ ${#missing[@]} -gt 0 ]; then
  err "The following required fields are empty in .env:"
  for f in "${missing[@]}"; do echo "    - $f"; done
  echo ""
  echo "    Edit .env and run ./start.sh again."
  exit 1
fi

ok ".env is configured (provider: $provider)"

# ==============================================================================
# STEP 3 — Build or pull images
# ==============================================================================
is_first_run=false
if ! $DOCKER images -q qa-infinity-qa-api:latest 2>/dev/null | grep -q .; then
  is_first_run=true
fi

if $BUILD || $is_first_run; then
  if $is_first_run; then
    step "First run — building Docker images (this takes ~3-5 minutes)"
    $DOCKER compose build qa-api qa-runner qa-ui
  else
    step "Building Docker images (--no-cache)"
    $DOCKER compose build --no-cache qa-api qa-runner qa-ui
  fi
  ok "Images built"
else
  step "Using existing images (run with --build to rebuild)"
  ok "Skipping build"
fi

# ==============================================================================
# STEP 4 — Start the stack
# ==============================================================================
step "Starting QA Infinity stack"
$DOCKER compose up -d

# ==============================================================================
# STEP 5 — Wait for API health
# ==============================================================================
step "Waiting for API to be ready"

healthy=false
for i in $(seq 1 24); do
  sleep 5
  if curl -sf http://localhost:4100/health > /dev/null 2>&1; then
    healthy=true
    break
  fi
  echo "    Waiting... ($((i * 5))s)"
done

# ==============================================================================
# STEP 6 — Summary
# ==============================================================================
echo ""
if $healthy; then
  echo "  ┌─────────────────────────────────────────────────────┐"
  echo "  │  QA Infinity is ready!                              │"
  echo "  │                                                       │"
  echo "  │  UI       →  http://localhost:3100                  │"
  echo "  │  API      →  http://localhost:4100                  │"
  echo "  │  noVNC    →  http://localhost:6180  (test runner)   │"
  echo "  │                                                       │"
  echo "  │  First time? Register at /register                  │"
  echo "  │  (first account auto-gets Super Admin role)         │"
  echo "  └─────────────────────────────────────────────────────┘"
else
  warn "API did not become healthy within 2 minutes."
  echo "    Check logs with:  ./start.sh --logs"
  echo "    Or directly:      $DOCKER logs qa-api --tail 50"
fi

echo ""

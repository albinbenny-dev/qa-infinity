# =============================================================================
#  fresh-install.ps1  -  QA Infinity Fresh Server Install
#
#  Run this after the server has been wiped clean.
#  Packs all source files, uploads them, and boots Docker from scratch.
#  Prisma migrations run automatically inside the api container on first start.
#
#  Usage (run from project root):
#    .\fresh-install.ps1                  # pack + push + build (standard fresh install)
#    .\fresh-install.ps1 -CleanVolumes    # also wipe Docker named volumes (full DB reset)
#    .\fresh-install.ps1 -PackOnly        # build the zip only, skip push
#
#  Prerequisites on the server:
#    - Docker + Docker Compose v2 installed
#    - SSH alias "qa-server" configured in ~/.ssh/config
#    - User has sudo rights (used to create /data/autoab/qa-infinity)
# =============================================================================

param(
    [switch]$PackOnly,     # Build zip only, do not push to server
    [switch]$CleanVolumes  # Remove Docker named volumes before rebuild (wipes the SQLite DB)
)

# -- Config -------------------------------------------------------------------
$ServerAlias = "qa-server"
$ServerPath  = "/data/autoab/qa-infinity"
$OutputZip   = Join-Path $PSScriptRoot "qa-infinity-deploy.zip"
$StagingDir  = Join-Path $env:TEMP "qa-infinity-staging-$(Get-Random)"

# -- Source directories (recursive copy) --------------------------------------
$SourceDirs = @(
    @{ From = "packages\api\src";      To = "packages\api\src"      },
    @{ From = "packages\api\prisma";   To = "packages\api\prisma"   },
    @{ From = "packages\frontend\src"; To = "packages\frontend\src" },
    @{ From = "packages\runner\src";   To = "packages\runner\src"   },
    @{ From = "nginx";                 To = "nginx"                 }
)

# -- Individual files ---------------------------------------------------------
$SourceFiles = @(
    "packages\api\package.json",
    "packages\api\tsconfig.json",
    "packages\api\Dockerfile",
    "packages\frontend\package.json",
    "packages\frontend\tsconfig.json",
    "packages\frontend\index.html",
    "packages\frontend\vite.config.ts",
    "packages\frontend\tailwind.config.ts",
    "packages\frontend\postcss.config.js",
    "packages\frontend\Dockerfile",
    "packages\runner\package.json",
    "packages\runner\Dockerfile",
    "docker-compose.yml",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml"
)

# -- Robocopy exclusions -------------------------------------------------------
$ExcludeDirs  = @("node_modules", "dist", ".git", "local_artifacts", ".claude", "__pycache__", ".next")
$ExcludeFiles = @("*.db", "*.db-journal", "*.db-wal", "*.db-shm", "*.log", "*.map")

# =============================================================================

function Print-Step { param($n, $msg) Write-Host "" ; Write-Host "  [$n] $msg" -ForegroundColor Cyan }
function Print-Ok   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Print-Warn { param($msg) Write-Host "    --  $msg" -ForegroundColor Yellow }
function Print-Err  { param($msg) Write-Host "    !!  $msg" -ForegroundColor Red }
function Print-Info { param($msg) Write-Host "        $msg" -ForegroundColor DarkGray }

# -- Header -------------------------------------------------------------------
Write-Host ""
Write-Host "  =============================================" -ForegroundColor Magenta
Write-Host "    QA Infinity - Fresh Server Install" -ForegroundColor Magenta
Write-Host "  =============================================" -ForegroundColor Magenta

if ($CleanVolumes) {
    Write-Host ""
    Write-Host "    WARNING: -CleanVolumes is set." -ForegroundColor Red
    Write-Host "    Docker named volumes (including the SQLite DB)" -ForegroundColor Red
    Write-Host "    will be permanently deleted on the server." -ForegroundColor Red
    Write-Host ""
    $confirm = Read-Host "    Type YES to confirm volume wipe"
    if ($confirm -ne "YES") {
        Write-Host "    Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# -- Guard: must be in project root -------------------------------------------
if (-not (Test-Path (Join-Path $PSScriptRoot "docker-compose.yml"))) {
    Print-Err "Run this script from the qa-infinity project root."
    exit 1
}
Set-Location $PSScriptRoot

# =============================================================================
# STEP 1 - Prepare staging directory
# =============================================================================
Print-Step "1/5" "Preparing staging directory..."

if (Test-Path $StagingDir) { Remove-Item $StagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
Print-Ok "Staging dir ready"

# =============================================================================
# STEP 2 - Copy source files
# =============================================================================
Print-Step "2/5" "Copying source files (node_modules / dist / .git excluded)..."

foreach ($entry in $SourceDirs) {
    $from = Join-Path $PSScriptRoot $entry.From
    $to   = Join-Path $StagingDir  $entry.To
    if (-not (Test-Path $from)) {
        Print-Warn "Not found, skipping: $($entry.From)"
        continue
    }
    robocopy $from $to /E /NFL /NDL /NJH /NJS /XD $ExcludeDirs /XF $ExcludeFiles | Out-Null
    if ($LASTEXITCODE -le 7) {
        Print-Ok "Copied dir: $($entry.From)"
    } else {
        Print-Err "Failed: $($entry.From) (exit $LASTEXITCODE)"
    }
}

foreach ($file in $SourceFiles) {
    $src = Join-Path $PSScriptRoot $file
    $dst = Join-Path $StagingDir  $file
    if (-not (Test-Path $src)) {
        Print-Warn "Not found, skipping: $file"
        continue
    }
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }
    Copy-Item $src $dst -Force
    Print-Ok "Copied: $file"
}

# .env - include with warning
$envSrc = Join-Path $PSScriptRoot ".env"
if (Test-Path $envSrc) {
    Copy-Item $envSrc (Join-Path $StagingDir ".env") -Force
    Print-Warn ".env included - contains API keys. Keep this zip private."
} else {
    Print-Warn ".env not found locally. Create it manually on the server before starting Docker."
    Print-Info "  $ServerPath/.env  (use .env.example as template)"
}

# =============================================================================
# STEP 3 - Create zip
# =============================================================================
Print-Step "3/5" "Creating zip archive..."

if (Test-Path $OutputZip) { Remove-Item $OutputZip -Force }
Compress-Archive -Path "$StagingDir\*" -DestinationPath $OutputZip -CompressionLevel Optimal
Remove-Item $StagingDir -Recurse -Force

$zipBytes = (Get-Item $OutputZip).Length
$zipMB    = [math]::Round($zipBytes / 1MB, 2)
Print-Ok "Created: qa-infinity-deploy.zip ($($zipMB) MB)"

# -- PackOnly exit ------------------------------------------------------------
if ($PackOnly) {
    Write-Host ""
    Write-Host "  Zip ready (PackOnly mode - skipping push)." -ForegroundColor DarkGray
    Print-Info "Manual push steps:"
    Print-Info "  scp qa-infinity-deploy.zip ${ServerAlias}:${ServerPath}/"
    Print-Info "  ssh $ServerAlias"
    Print-Info "  cd $ServerPath"
    Print-Info "  unzip -o qa-infinity-deploy.zip"
    Print-Info "  docker compose up --build -d"
    Write-Host ""
    Write-Host "  Done. $(Join-Path $PSScriptRoot 'qa-infinity-deploy.zip')" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# =============================================================================
# STEP 4 - Push to server and prepare directories
# =============================================================================
Print-Step "4/5" "Pushing to server ($ServerAlias)..."

# Create deployment directory (no sudo - relies on admin user having write access to /data/autoab)
Write-Host "    Creating server directory..." -ForegroundColor DarkGray
ssh $ServerAlias "mkdir -p $ServerPath && echo dir-ok"

# Upload zip
Write-Host "    Uploading zip ($($zipMB) MB)..." -ForegroundColor DarkGray
scp $OutputZip "${ServerAlias}:${ServerPath}/qa-infinity-deploy.zip"
if ($LASTEXITCODE -ne 0) {
    Print-Err "SCP failed. Check your ssh config and server path."
    exit 1
}
Print-Ok "Uploaded to server"

# Extract
# unzip exits with code 1 on warnings (e.g. backslash paths from Windows zips) - treat 0 and 1 as success
Write-Host "    Extracting on server..." -ForegroundColor DarkGray
$unzipCmd   = "cd $ServerPath && unzip -o qa-infinity-deploy.zip; EC=`$?; rm -f qa-infinity-deploy.zip; [ `$EC -le 1 ] && echo extract-ok || echo extract-failed"
$unzipOut   = ssh $ServerAlias $unzipCmd
Write-Host $unzipOut
if ($unzipOut -match "extract-failed") {
    Print-Err "Extraction failed on server."
    exit 1
}
Print-Ok "Extracted on server"

# Verify .env exists on server
Write-Host "    Checking .env on server..." -ForegroundColor DarkGray
$envCheck = ssh $ServerAlias "test -f $ServerPath/.env && echo env-ok || echo env-missing"
if ($envCheck -match "env-missing") {
    Write-Host ""
    Print-Warn ".env is MISSING on the server. Configure it before Docker starts:"
    Print-Info "  ssh $ServerAlias"
    Print-Info "  cd $ServerPath"
    Print-Info "  cp .env.example .env"
    Print-Info "  nano .env    # fill in JWT_SECRET, API keys, SMTP, etc."
    Write-Host ""
    $proceed = Read-Host "    Type YES when .env is ready on the server"
    if ($proceed -ne "YES") {
        Write-Host "    Aborted. Run the script again after configuring .env." -ForegroundColor Yellow
        exit 0
    }
} else {
    Print-Ok ".env found on server"
}

# =============================================================================
# STEP 5 - Docker build and start (Prisma migrations run automatically on boot)
# =============================================================================
Print-Step "5/5" "Building Docker images and starting containers..."
Print-Info "This typically takes 3-6 minutes on first build."
Write-Host ""

if ($CleanVolumes) {
    Write-Host "    Removing existing containers and named volumes..." -ForegroundColor DarkGray
    $downCmd = "cd $ServerPath && docker compose down -v --remove-orphans && echo down-ok"
    ssh $ServerAlias $downCmd
    Print-Ok "Containers and volumes removed"
} else {
    Write-Host "    Stopping any existing containers..." -ForegroundColor DarkGray
    $downCmd = "cd $ServerPath && docker compose down --remove-orphans && echo down-ok"
    ssh $ServerAlias $downCmd
    Print-Ok "Containers stopped"
}

# Build and start all services
$upCmd = "cd $ServerPath && docker compose up --build -d"
ssh $ServerAlias $upCmd
if ($LASTEXITCODE -ne 0) {
    Print-Err "docker compose up --build -d failed. Check logs above."
    exit 1
}
Print-Ok "docker compose up --build -d started"

# -- Wait for qa-api health ---------------------------------------------------
Write-Host ""
Write-Host "    Waiting for qa-api to become healthy..." -ForegroundColor DarkGray
Write-Host "    (Prisma migrations run automatically during this phase)" -ForegroundColor DarkGray

$maxWait  = 120
$interval = 5
$elapsed  = 0
$healthy  = $false

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval
    $status = ssh $ServerAlias "docker inspect --format='{{.State.Health.Status}}' qa-api 2>/dev/null || echo unknown"
    Write-Host "      [${elapsed}s] qa-api health: $status" -ForegroundColor DarkGray
    if ($status -match "healthy") {
        $healthy = $true
        break
    }
    if ($status -match "unhealthy") {
        Print-Err "qa-api is unhealthy. Fetching recent logs..."
        ssh $ServerAlias "cd $ServerPath && docker compose logs --tail=60 qa-api"
        exit 1
    }
}

if ($healthy) {
    Print-Ok "qa-api is healthy - migrations complete, API is running"
} else {
    Print-Warn "qa-api did not become healthy within ${maxWait}s. Check logs with:"
    Print-Info "  ssh $ServerAlias 'cd $ServerPath && docker compose logs --tail=80 qa-api'"
}

# -- Final container status ---------------------------------------------------
Write-Host ""
Write-Host "    Container status:" -ForegroundColor DarkGray
ssh $ServerAlias "cd $ServerPath && docker compose ps"

Write-Host ""
Write-Host "  =============================================" -ForegroundColor Green
Write-Host "    Fresh install complete!" -ForegroundColor Green
Write-Host "  =============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Access the app:" -ForegroundColor White
Write-Host "    UI  -> http://<server-ip>:3000" -ForegroundColor Cyan
Write-Host "    API -> http://<server-ip>:4000/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Useful server commands:" -ForegroundColor DarkGray
Write-Host "    ssh $ServerAlias 'cd $ServerPath && docker compose logs -f'" -ForegroundColor White
Write-Host "    ssh $ServerAlias 'cd $ServerPath && docker compose ps'" -ForegroundColor White
Write-Host ""

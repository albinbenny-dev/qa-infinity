# =============================================================================
#  release-push.ps1  (run on Windows)
#
#  What it does:
#    1. Exports DB + scripts + reqdocs from local Docker
#    2. Packs source code (no node_modules)
#    3. Saves timestamped backup locally
#    4. SCPs everything to server /data/autoab/QA_INFINITY_RELEASE/
#
#  Run from project root:
#    .\release-push.ps1
# =============================================================================

# -- Paths --------------------------------------------------------------------
$ProjectRoot  = $PSScriptRoot
$BackupRoot   = "C:\Users\albin\Sixdee telecom solutions pvt. ltd\AirtelAfrica-Ventas - Documents\Delivery\Automation\QA Infinity\Backup"
$ServerAlias  = "qa-server"
$ServerRelease = "/data/autoab/QA_INFINITY_RELEASE"

# -- Timestamped backup folder ------------------------------------------------
$Timestamp  = Get-Date -Format "yyyy-MM-dd_HH-mm"
$BackupDir  = Join-Path $BackupRoot $Timestamp
$StagingDir = Join-Path $env:TEMP "qa-infinity-staging-$(Get-Random)"

# -- Source dirs to pack (no node_modules) ------------------------------------
$SourceDirs = @(
    @{ From = "packages\api\src";      To = "packages\api\src"      },
    @{ From = "packages\api\prisma";   To = "packages\api\prisma"   },
    @{ From = "packages\frontend\src"; To = "packages\frontend\src" },
    @{ From = "packages\runner\src";   To = "packages\runner\src"   },
    @{ From = "nginx";                 To = "nginx"                 }
)
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
    "pnpm-workspace.yaml"
)
$ExcludeDirs  = @("node_modules", "dist", ".git", "local_artifacts", ".claude", "__pycache__")
$ExcludeFiles = @("*.db", "*.log", "*.map")

# =============================================================================

function Print-Step { param($n, $msg) Write-Host "" ; Write-Host "  [$n] $msg" -ForegroundColor Cyan }
function Print-Ok   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Print-Warn { param($msg) Write-Host "    --  $msg" -ForegroundColor Yellow }
function Print-Err  { param($msg) Write-Host "    !!  $msg" -ForegroundColor Red }
function Print-Info { param($msg) Write-Host "        $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host "    QA Infinity -- Release Push" -ForegroundColor Magenta
Write-Host "    Backup: $Timestamp" -ForegroundColor DarkGray
Write-Host "  ==========================================" -ForegroundColor Magenta

# =============================================================================
# GUARD: check local qa-api container is running
# =============================================================================
$containerStatus = docker inspect -f "{{.State.Running}}" qa-api 2>&1
if ($containerStatus -ne "true") {
    Print-Err "Local container 'qa-api' is not running."
    Print-Info "Start it with:  docker compose up -d"
    Print-Info "Then re-run this script."
    exit 1
}
Print-Ok "Local qa-api container is running"

# =============================================================================
# STEP 1 -- Create backup folder
# =============================================================================
Print-Step "1/5" "Creating backup folder..."

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
Print-Ok "Backup folder: $BackupDir"

# =============================================================================
# STEP 2 -- Export DB, scripts, reqdocs from local Docker
# =============================================================================
Print-Step "2/5" "Exporting data from local Docker..."

# DB
$dbDest = Join-Path $BackupDir "qa-infinity.db"
docker cp qa-api:/data/qa-infinity.db $dbDest
if ($LASTEXITCODE -eq 0) {
    $dbMB = [math]::Round((Get-Item $dbDest).Length / 1KB, 1)
    Print-Ok "Exported DB ($($dbMB) KB) -> qa-infinity.db"
} else {
    Print-Err "Failed to export DB"
    exit 1
}

# Scripts
$scriptsDest = Join-Path $BackupDir "qa-scripts"
if (Test-Path $scriptsDest) { Remove-Item $scriptsDest -Recurse -Force }
docker cp "qa-api:/scripts" $scriptsDest
if ($LASTEXITCODE -eq 0) {
    Print-Ok "Exported scripts -> qa-scripts/"
} else {
    Print-Warn "No scripts folder found in container (skipping)"
}

# Requirement docs
$reqdocsDest = Join-Path $BackupDir "qa-reqdocs"
if (Test-Path $reqdocsDest) { Remove-Item $reqdocsDest -Recurse -Force }
docker cp "qa-api:/requirements" $reqdocsDest
if ($LASTEXITCODE -eq 0) {
    Print-Ok "Exported reqdocs -> qa-reqdocs/"
} else {
    Print-Warn "No requirements folder found in container (skipping)"
}

# =============================================================================
# STEP 3 -- Pack source code (exclude node_modules, dist, .git)
# =============================================================================
Print-Step "3/5" "Packing source code (node_modules excluded)..."

if (Test-Path $StagingDir) { Remove-Item $StagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null

Set-Location $ProjectRoot

foreach ($entry in $SourceDirs) {
    $from = Join-Path $ProjectRoot $entry.From
    $to   = Join-Path $StagingDir  $entry.To
    if (-not (Test-Path $from)) { Print-Warn "Skipping (not found): $($entry.From)"; continue }
    robocopy $from $to /E /NFL /NDL /NJH /NJS /XD $ExcludeDirs /XF $ExcludeFiles | Out-Null
    if ($LASTEXITCODE -le 7) { Print-Ok "Packed: $($entry.From)" }
}

foreach ($file in $SourceFiles) {
    $src = Join-Path $ProjectRoot $file
    $dst = Join-Path $StagingDir  $file
    if (-not (Test-Path $src)) { Print-Warn "Skipping (not found): $file"; continue }
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
    Copy-Item $src $dst -Force
}

# Include .env
$envSrc = Join-Path $ProjectRoot ".env"
if (Test-Path $envSrc) {
    Copy-Item $envSrc (Join-Path $StagingDir ".env") -Force
    Print-Warn ".env included -- keep this release package private"
}

$appZip = Join-Path $BackupDir "qa-infinity-app.zip"
if (Test-Path $appZip) { Remove-Item $appZip -Force }
Compress-Archive -Path "$StagingDir\*" -DestinationPath $appZip -CompressionLevel Optimal
Remove-Item $StagingDir -Recurse -Force

$appMB = [math]::Round((Get-Item $appZip).Length / 1MB, 2)
Print-Ok "App zip: qa-infinity-app.zip ($($appMB) MB)"

# -- Prisma schema sanity check -----------------------------------------------
# Confirms the schema + migrations are current before pushing to the server.
# If schema.prisma was recently modified, the migration count should have increased too.
$schemaPath = Join-Path $ProjectRoot "packages\api\prisma\schema.prisma"
$migrDir    = Join-Path $ProjectRoot "packages\api\prisma\migrations"
if (Test-Path $schemaPath) {
    $schemaDate = (Get-Item $schemaPath).LastWriteTime.ToString("yyyy-MM-dd HH:mm")
    $migCount   = if (Test-Path $migrDir) { (Get-ChildItem $migrDir -Directory).Count } else { 0 }
    Print-Ok "Prisma: schema modified $schemaDate | $migCount migration(s) packed"
} else {
    Print-Warn "Prisma schema not found -- packages\api\prisma\schema.prisma is missing from zip!"
}

# =============================================================================
# STEP 4 -- Summary of what we have
# =============================================================================
Print-Step "4/5" "Backup contents:"
Get-ChildItem $BackupDir | ForEach-Object {
    $sizeMB = if ($_.PSIsContainer) {
        $kb = [math]::Round((Get-ChildItem $_.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1KB, 1)
        "$($kb) KB (folder)"
    } else {
        "$([math]::Round($_.Length / 1KB, 1)) KB"
    }
    Print-Info "$($_.Name)  [$($sizeMB)]"
}

# =============================================================================
# STEP 5 -- SCP to server
# =============================================================================
Print-Step "5/5" "Pushing to server ($ServerAlias : $ServerRelease)..."

# Create release folder on server
ssh $ServerAlias "mkdir -p $ServerRelease"

# Push app zip
Print-Info "Uploading qa-infinity-app.zip..."
scp $appZip "${ServerAlias}:${ServerRelease}/qa-infinity-app.zip"
if ($LASTEXITCODE -ne 0) { Print-Err "Failed to upload app zip"; exit 1 }
Print-Ok "Uploaded qa-infinity-app.zip"

# Push DB
Print-Info "Uploading qa-infinity.db..."
scp $dbDest "${ServerAlias}:${ServerRelease}/qa-infinity.db"
if ($LASTEXITCODE -ne 0) { Print-Err "Failed to upload DB"; exit 1 }
Print-Ok "Uploaded qa-infinity.db"

# Push scripts folder
if (Test-Path $scriptsDest) {
    Print-Info "Uploading qa-scripts/..."
    # Remove old scripts folder on server first to avoid stale files
    ssh $ServerAlias "rm -rf $ServerRelease/qa-scripts"
    scp -r $scriptsDest "${ServerAlias}:${ServerRelease}/"
    if ($LASTEXITCODE -eq 0) { Print-Ok "Uploaded qa-scripts/" } else { Print-Warn "Scripts upload failed (non-fatal)" }
}

# Push reqdocs folder
if (Test-Path $reqdocsDest) {
    Print-Info "Uploading qa-reqdocs/..."
    ssh $ServerAlias "rm -rf $ServerRelease/qa-reqdocs"
    scp -r $reqdocsDest "${ServerAlias}:${ServerRelease}/"
    if ($LASTEXITCODE -eq 0) { Print-Ok "Uploaded qa-reqdocs/" } else { Print-Warn "Reqdocs upload failed (non-fatal)" }
}

# =============================================================================
# Done
# =============================================================================
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "    PUSH COMPLETE" -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "  Local backup : $BackupDir" -ForegroundColor DarkGray
Write-Host "  Server       : $ServerAlias $ServerRelease" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Next step -- on the server run:" -ForegroundColor Yellow
Write-Host "    cd /data/autoab/qa-infinity" -ForegroundColor White
Write-Host "    sudo bash release-deploy.sh" -ForegroundColor White
Write-Host ""

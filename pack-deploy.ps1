# =============================================================================
#  pack-deploy.ps1  -  QA Infinity Deployment Packer
#
#  Usage (run from project root):
#    .\pack-deploy.ps1                  # create zip only
#    .\pack-deploy.ps1 -Push            # create zip + SCP to server
#    .\pack-deploy.ps1 -Push -Rebuild   # create zip + SCP + docker rebuild
#
#  Output: qa-infinity-deploy.zip in the project root
# =============================================================================

param(
    [switch]$Push,      # SCP the zip to the server after building
    [switch]$Rebuild    # SSH and run docker compose up --build -d after push
)

# -- Config -------------------------------------------------------------------
$ServerAlias = "qa-server"                    # Host alias from ~/.ssh/config
$ServerPath  = "/data/autoab/qa-infinity"     # Absolute path on RHEL server
$OutputZip   = Join-Path $PSScriptRoot "qa-infinity-deploy.zip"
$StagingDir  = Join-Path $env:TEMP "qa-infinity-staging-$(Get-Random)"

# -- Directories to copy (robocopy handles recursive + exclusions) -------------
$SourceDirs = @(
    @{ From = "packages\api\src";      To = "packages\api\src"      },
    @{ From = "packages\api\prisma";   To = "packages\api\prisma"   },
    @{ From = "packages\frontend\src"; To = "packages\frontend\src" },
    @{ From = "packages\runner\src";   To = "packages\runner\src"   },
    @{ From = "nginx";                 To = "nginx"                 }
)

# -- Individual files to copy -------------------------------------------------
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

# -- Exclusions (node_modules, build output, git, etc.) -----------------------
$ExcludeDirs  = @("node_modules", "dist", ".git", "local_artifacts", ".claude", "__pycache__", ".next")
$ExcludeFiles = @("*.db", "*.log", "*.map")

# =============================================================================

function Print-Step { param($n, $msg) Write-Host "" ; Write-Host "  [$n] $msg" -ForegroundColor Cyan }
function Print-Ok   { param($msg) Write-Host "    OK  $msg" -ForegroundColor Green }
function Print-Warn { param($msg) Write-Host "    --  $msg" -ForegroundColor Yellow }
function Print-Err  { param($msg) Write-Host "    !!  $msg" -ForegroundColor Red }

# -- Header -------------------------------------------------------------------
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host "    QA Infinity -- Deployment Packer" -ForegroundColor Magenta
Write-Host "  ==========================================" -ForegroundColor Magenta
Write-Host ""

# -- Guard: must be in project root -------------------------------------------
if (-not (Test-Path (Join-Path $PSScriptRoot "docker-compose.yml"))) {
    Print-Err "Run this script from the qa-infinity project root."
    exit 1
}
Set-Location $PSScriptRoot

# =============================================================================
# STEP 1 -- Prepare staging directory
# =============================================================================
Print-Step "1/4" "Preparing staging directory..."

if (Test-Path $StagingDir) { Remove-Item $StagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $StagingDir -Force | Out-Null
Print-Ok "Staging dir ready"

# =============================================================================
# STEP 2 -- Copy source files (skip node_modules, dist, .git)
# =============================================================================
Print-Step "2/4" "Copying source files (node_modules excluded)..."

foreach ($entry in $SourceDirs) {
    $from = Join-Path $PSScriptRoot $entry.From
    $to   = Join-Path $StagingDir  $entry.To

    if (-not (Test-Path $from)) {
        Print-Warn "Not found, skipping: $($entry.From)"
        continue
    }

    # robocopy exit codes 0-7 are all success (bit flags: 1=copied, 2=extra, 4=mismatch)
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

# -- .env -- copy with a warning about secrets --------------------------------
$envSrc = Join-Path $PSScriptRoot ".env"
if (Test-Path $envSrc) {
    Copy-Item $envSrc (Join-Path $StagingDir ".env") -Force
    Print-Warn ".env included -- contains API keys. Keep this zip private."
} else {
    Print-Warn ".env not found -- configure it manually on the server."
}

# =============================================================================
# STEP 3 -- Create zip
# =============================================================================
Print-Step "3/4" "Creating zip archive..."

if (Test-Path $OutputZip) { Remove-Item $OutputZip -Force }

Compress-Archive -Path "$StagingDir\*" -DestinationPath $OutputZip -CompressionLevel Optimal

Remove-Item $StagingDir -Recurse -Force

$zipBytes = (Get-Item $OutputZip).Length
$zipMB    = [math]::Round($zipBytes / 1MB, 2)
Print-Ok "Created: qa-infinity-deploy.zip ($($zipMB) MB)"

# =============================================================================
# STEP 4 -- Push to server (only when -Push flag is set)
# =============================================================================
if (-not $Push) {
    Write-Host ""
    Write-Host "  Zip ready. Next steps:" -ForegroundColor DarkGray
    Write-Host "    Manual SCP:  scp qa-infinity-deploy.zip ${ServerAlias}:${ServerPath}/" -ForegroundColor White
    Write-Host "    Auto push:   .\pack-deploy.ps1 -Push" -ForegroundColor White
    Write-Host "    Push+build:  .\pack-deploy.ps1 -Push -Rebuild" -ForegroundColor White
    Write-Host ""
    Write-Host "  Done. $($zipMB) MB -- $(Join-Path $PSScriptRoot 'qa-infinity-deploy.zip')" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Print-Step "4/4" "Pushing to server ($ServerAlias)..."

# Fix permissions on server so we can overwrite existing files
Write-Host "    Fixing server permissions..." -ForegroundColor DarkGray
ssh $ServerAlias "sudo chown -R admin:admin $ServerPath 2>/dev/null; echo permissions-ok"

# Upload the zip
Write-Host "    Uploading zip..." -ForegroundColor DarkGray
scp $OutputZip "${ServerAlias}:${ServerPath}/qa-infinity-deploy.zip"

if ($LASTEXITCODE -ne 0) {
    Print-Err "SCP failed. Check your ssh config and server path."
    exit 1
}
Print-Ok "Uploaded to server"

# Extract on server
Write-Host "    Extracting on server..." -ForegroundColor DarkGray
$extractCmd = "cd $ServerPath && unzip -o qa-infinity-deploy.zip && rm -f qa-infinity-deploy.zip && echo extract-ok"
ssh $ServerAlias $extractCmd

Print-Ok "Extracted on server"

# Optionally rebuild Docker
if ($Rebuild) {
    Write-Host ""
    Write-Host "    Rebuilding Docker containers (this takes 2-5 min)..." -ForegroundColor DarkGray
    ssh $ServerAlias "cd $ServerPath && docker compose up --build -d"
    Print-Ok "Docker rebuild started"
    Write-Host ""
    Write-Host "    Check status:" -ForegroundColor DarkGray
    Write-Host "      ssh $ServerAlias 'docker compose ps'" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "  Files deployed. Now rebuild on the server:" -ForegroundColor DarkGray
    Write-Host "    ssh $ServerAlias" -ForegroundColor White
    Write-Host "    cd $ServerPath" -ForegroundColor White
    Write-Host "    docker compose up --build -d" -ForegroundColor White
}

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "    Done. Package: $($zipMB) MB" -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host ""

# ==============================================================================
# QA Infinity - Local Development Startup Script
#
# First time:  .\start.ps1          (sets up .env, builds images, starts stack)
# After that:  .\start.ps1          (starts existing stack - fast)
#              .\start.ps1 -Build   (force-rebuild images after code changes)
#              .\start.ps1 -Stop    (stop all containers)
#              .\start.ps1 -Logs    (tail live logs)
# ==============================================================================

param(
    [switch]$Build,
    [switch]$Stop,
    [switch]$Logs
)

$ErrorActionPreference = 'Stop'

function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  QA Infinity" -ForegroundColor DarkCyan
Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

Push-Location $PSScriptRoot

# -- Stop mode -----------------------------------------------------------------
if ($Stop) {
    Write-Step "Stopping QA Infinity"
    docker compose stop
    Write-Ok "All containers stopped. Data is preserved."
    Pop-Location; exit 0
}

# -- Logs mode -----------------------------------------------------------------
if ($Logs) {
    docker compose logs -f --tail=50
    Pop-Location; exit 0
}

# ==============================================================================
# STEP 1 - Check Docker
# ==============================================================================
Write-Step "Checking Docker"
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Ok "Docker is running"
} catch {
    Write-Err "Docker is not running. Please start Docker Desktop and try again."
    Pop-Location; exit 1
}

# ==============================================================================
# STEP 2 - First-time .env setup
# ==============================================================================
Write-Step "Checking environment configuration"

if (-not (Test-Path "$PSScriptRoot\.env")) {
    Write-Warn ".env not found - creating from .env.example"
    Copy-Item "$PSScriptRoot\.env.example" "$PSScriptRoot\.env"

    Write-Host ""
    Write-Host "  +-----------------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |  ACTION REQUIRED: fill in your .env file            |" -ForegroundColor Yellow
    Write-Host "  |                                                     |" -ForegroundColor Yellow
    Write-Host "  |  Required fields (marked * in the file):           |" -ForegroundColor Yellow
    Write-Host "  |    POSTGRES_PASSWORD  - pick any strong password    |" -ForegroundColor Yellow
    Write-Host "  |    JWT_SECRET         - paste 2-3 random UUIDs      |" -ForegroundColor Yellow
    Write-Host "  |    ANTHROPIC_API_KEY  - or set LLM_PROVIDER and key |" -ForegroundColor Yellow
    Write-Host "  |                                                     |" -ForegroundColor Yellow
    Write-Host "  |  Opening .env in Notepad - save and close to cont.  |" -ForegroundColor Yellow
    Write-Host "  +-----------------------------------------------------+" -ForegroundColor Yellow
    Write-Host ""

    Start-Process notepad "$PSScriptRoot\.env" -Wait
}

# Validate required fields
function Read-EnvVar {
    param([string]$key)
    $line = Get-Content "$PSScriptRoot\.env" -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -Last 1
    if (-not $line) { return '' }
    return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

$missing = @()
if (-not (Read-EnvVar 'POSTGRES_PASSWORD')) { $missing += 'POSTGRES_PASSWORD' }
if (-not (Read-EnvVar 'JWT_SECRET'))         { $missing += 'JWT_SECRET' }

$provider = Read-EnvVar 'LLM_PROVIDER'
if (-not $provider) { $provider = 'openrouter' }
switch ($provider) {
    'openrouter' { if (-not (Read-EnvVar 'OPENROUTER_API_KEY')) { $missing += 'OPENROUTER_API_KEY' } }
    'anthropic'  { if (-not (Read-EnvVar 'ANTHROPIC_API_KEY'))  { $missing += 'ANTHROPIC_API_KEY'  } }
}

if ($missing.Count -gt 0) {
    Write-Err "The following required fields are empty in .env:"
    foreach ($f in $missing) { Write-Host "    - $f" -ForegroundColor Red }
    Write-Host ""
    Write-Host "    Edit .env and run .\start.ps1 again." -ForegroundColor Yellow
    Pop-Location; exit 1
}

Write-Ok ".env is configured (provider: $provider)"

# ==============================================================================
# STEP 3 - Build or pull images
# ==============================================================================
$isFirstRun = -not (docker images -q qa-infinity-qa-api:latest 2>$null)

if ($Build -or $isFirstRun) {
    if ($isFirstRun) {
        Write-Step "First run - building Docker images (this takes ~3 minutes)"
    } else {
        Write-Step "Building Docker images (--no-cache)"
    }
    $buildArgs = if ($Build) { '--no-cache' } else { '' }
    Invoke-Expression "docker compose build $buildArgs qa-api qa-runner qa-ui"
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Docker build failed. Check the output above."
        Pop-Location; exit 1
    }
    Write-Ok "Images built"
} else {
    Write-Step "Using existing images (run with -Build to rebuild)"
    Write-Ok "Skipping build"
}

# ==============================================================================
# STEP 4 - Start the stack
# ==============================================================================
Write-Step "Starting QA Infinity stack"
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker compose up failed."
    Pop-Location; exit 1
}

# ==============================================================================
# STEP 5 - Wait for API health
# ==============================================================================
Write-Step "Waiting for API to be ready"

$healthy = $false
for ($i = 1; $i -le 24; $i++) {
    Start-Sleep -Seconds 5
    try {
        $res = Invoke-WebRequest -Uri 'http://localhost:4100/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($res.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Write-Host "    Waiting... ($($i * 5)s)" -ForegroundColor Gray
}

# ==============================================================================
# STEP 6 - Summary
# ==============================================================================
Write-Host ""
if ($healthy) {
    Write-Host "  +-----------------------------------------------------+" -ForegroundColor Green
    Write-Host "  |  QA Infinity is ready!                              |" -ForegroundColor Green
    Write-Host "  |                                                     |" -ForegroundColor Green
    Write-Host "  |  UI       ->  http://localhost:3100                 |" -ForegroundColor Green
    Write-Host "  |  API      ->  http://localhost:4100                 |" -ForegroundColor Green
    Write-Host "  |  noVNC    ->  http://localhost:6180  (test runner)  |" -ForegroundColor Green
    Write-Host "  |                                                     |" -ForegroundColor Green
    Write-Host "  |  First time? Register at /register                 |" -ForegroundColor Green
    Write-Host "  |  (first account auto-gets Super Admin role)        |" -ForegroundColor Green
    Write-Host "  +-----------------------------------------------------+" -ForegroundColor Green
} else {
    Write-Warn "API did not become healthy within 2 minutes."
    Write-Host "    Check logs with:  .\start.ps1 -Logs" -ForegroundColor Yellow
    Write-Host "    Or directly:      docker logs qa-api --tail 50" -ForegroundColor Yellow
}

Write-Host ""
Pop-Location

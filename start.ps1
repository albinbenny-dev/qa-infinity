# ==============================================================================
# QA Infinity — Windows PowerShell Startup Script
#
# First time:  .\start.ps1          (sets up .env, builds images, starts stack)
# After that:  .\start.ps1          (starts existing stack — fast)
#              .\start.ps1 -Build   (force-rebuild images after code changes)
#              .\start.ps1 -Reset   (cancel all active/stuck runs, then start)
#              .\start.ps1 -Stop    (stop all containers)
#              .\start.ps1 -Logs    (tail live logs)
#
# Note: if blocked on first run, allow scripts in the current user scope:
#   Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
# ==============================================================================

param(
    [switch]$Build,
    [switch]$Stop,
    [switch]$Logs,
    [switch]$Reset
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

# ==============================================================================
# Detect Docker Compose (V2 plugin: `docker compose`  vs  V1: `docker-compose`)
# ==============================================================================
$script:ComposeV2 = $false
& docker compose version 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    $script:ComposeV2 = $true
} elseif (-not (Get-Command docker-compose -ErrorAction SilentlyContinue)) {
    Write-Err "Neither 'docker compose' (V2) nor 'docker-compose' (V1) found."
    Write-Host "    Install Docker Desktop and try again." -ForegroundColor Red
    Pop-Location; exit 1
}

# Wrapper with NO param() block so -d / -f / --flags pass through via $args unchanged
function Compose {
    if ($script:ComposeV2) {
        & docker compose @args
    } else {
        & docker-compose @args
    }
}

# -- Stop mode -----------------------------------------------------------------
if ($Stop) {
    Write-Step "Stopping QA Infinity"
    Compose stop
    Write-Ok "All containers stopped. Data is preserved."
    Pop-Location; exit 0
}

# -- Logs mode -----------------------------------------------------------------
if ($Logs) {
    Compose logs '-f' '--tail=50'
    Pop-Location; exit 0
}

# ==============================================================================
# STEP 1 — Check Docker
# ==============================================================================
Write-Step "Checking Docker"
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
    Write-Ok "Docker is running"
} catch {
    Write-Err "Docker is not running. Start Docker Desktop and try again."
    Pop-Location; exit 1
}

# ==============================================================================
# STEP 2 — First-time .env setup
# ==============================================================================
Write-Step "Checking environment configuration"

if (-not (Test-Path "$PSScriptRoot\.env")) {
    Write-Warn ".env not found — creating from .env.example"
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
    Write-Host "  |  Opening .env in Notepad - save and close to cont. |" -ForegroundColor Yellow
    Write-Host "  +-----------------------------------------------------+" -ForegroundColor Yellow
    Write-Host ""

    Start-Process notepad "$PSScriptRoot\.env" -Wait
}

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
# STEP 3 — Build or pull images
# ==============================================================================
$imageId    = & docker images -q qa-infinity-qa-api:latest 2>$null
$isFirstRun = [string]::IsNullOrWhiteSpace($imageId)

if ($Build -or $isFirstRun) {
    if ($isFirstRun) {
        Write-Step "First run — building Docker images (this takes ~3-5 minutes)"
    } else {
        Write-Step "Rebuilding Docker images (layer cache preserved)"
    }
    Compose build qa-api qa-runner qa-ui
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
# STEP 3.5 — Inject FORCE_CANCEL_RUNS for -Reset mode
# ==============================================================================
if ($Reset) {
    Write-Step "Reset mode — cancelling all active runs on startup"
    # Remove any existing FORCE_CANCEL_RUNS line, then append the one-shot flag.
    # qa-api picks it up via env_file: .env in docker-compose.yml.
    $envLines = Get-Content "$PSScriptRoot\.env" | Where-Object { $_ -notmatch '^FORCE_CANCEL_RUNS=' }
    Set-Content "$PSScriptRoot\.env" -Value $envLines -Encoding utf8
    Add-Content "$PSScriptRoot\.env" "FORCE_CANCEL_RUNS=true" -Encoding utf8
    Write-Warn "FORCE_CANCEL_RUNS=true added to .env — will be removed after startup"
}

# ==============================================================================
# STEP 4 — Start the stack
# ==============================================================================
Write-Step "Starting QA Infinity stack"
Compose up '-d'
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker compose up failed."
    Pop-Location; exit 1
}
if ($Reset) {
    # Force-recreate the API container so it picks up the updated .env
    Compose up '-d' '--force-recreate' qa-api
}

# ==============================================================================
# STEP 5 — Wait for API health
# ==============================================================================
Write-Step "Waiting for API to be ready"

$healthy = $false
for ($i = 1; $i -le 24; $i++) {
    Start-Sleep -Seconds 5
    try {
        $res = Invoke-WebRequest -Uri 'http://localhost:4100/health' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($res.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Write-Host "    Waiting... ($($i * 5)s)" -ForegroundColor Gray
}

# ==============================================================================
# STEP 5.5 — Remove one-shot reset flag
# ==============================================================================
if ($Reset) {
    $envLines = Get-Content "$PSScriptRoot\.env" | Where-Object { $_ -notmatch '^FORCE_CANCEL_RUNS=' }
    Set-Content "$PSScriptRoot\.env" -Value $envLines -Encoding utf8
    if ($healthy) {
        Write-Ok "FORCE_CANCEL_RUNS removed from .env — reset complete"
    } else {
        Write-Warn "API did not start cleanly; FORCE_CANCEL_RUNS removed anyway (check logs)"
    }
}

# ==============================================================================
# STEP 6 — Summary
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

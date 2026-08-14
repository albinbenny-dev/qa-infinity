# sync.ps1 — pull latest code and redeploy in a local Windows dev environment
#
# Run this from the repo root in PowerShell:
#   .\sync.ps1                        # redeploy qa-api + qa-ui (most common)
#   .\sync.ps1 qa-runner               # runner only (Dockerfile changed)
#   .\sync.ps1 qa-api qa-ui qa-runner  # all three app services
#
# Unlike sync.sh (which runs on the remote deploy-only server and force-resets
# the working tree before pulling), this script assumes you have local edits
# and will NOT discard anything — it aborts if the working tree is dirty.

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Services
)

$ErrorActionPreference = "Stop"

$ProjectName = "qa-infinity"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Services -or $Services.Count -eq 0) {
    $Services = @("qa-api", "qa-ui", "qa-runner")
}

Push-Location $Dir
try {
    Write-Host "▶ Sync & deploy [$($Services -join ' ')]" -ForegroundColor Cyan
    Write-Host ""

    # ── 1. Refuse to pull over local changes ──────────────────────────────
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "✖ You have uncommitted changes — aborting so nothing gets lost:" -ForegroundColor Red
        git status --short
        Write-Host ""
        Write-Host "Commit, stash ('git stash -u'), or discard them yourself, then re-run .\sync.ps1" -ForegroundColor Yellow
        exit 1
    }

    # ── 2. Pull latest code ────────────────────────────────────────────────
    Write-Host "⟳ Pulling latest code…"
    git pull
    $lastCommit = git log -1 --format='%h %s'
    Write-Host "✔ Code up to date  ($lastCommit)" -ForegroundColor Green
    Write-Host ""

    # ── 3. Detect Docker Compose V1 vs V2 ──────────────────────────────────
    $useV2 = $true
    try {
        docker compose version *> $null
    } catch {
        $useV2 = $false
    }
    $dc = if ($useV2) { @("docker", "compose") } else { @("docker-compose") }

    # ── 4. Build updated images (layer-cached — only changed layers rebuild) ─
    Write-Host "⟳ Building images…"
    & $dc[0] $dc[1..($dc.Length - 1)] -p $ProjectName build --parallel @Services
    Write-Host "✔ Build done" -ForegroundColor Green
    Write-Host ""

    # ── 5. Restart containers ──────────────────────────────────────────────
    Write-Host "⟳ Restarting containers…"
    & $dc[0] $dc[1..($dc.Length - 1)] -p $ProjectName up -d --no-build @Services
    Write-Host ""

    # ── 6. Status ───────────────────────────────────────────────────────────
    & $dc[0] $dc[1..($dc.Length - 1)] -p $ProjectName ps @Services
    Write-Host ""
    Write-Host "✅ Deploy complete" -ForegroundColor Green
}
finally {
    Pop-Location
}

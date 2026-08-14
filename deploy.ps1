# ==============================================================================
# QA Infinity - Deploy Script
#
# Ships qa-infinity-qa-api + qa-infinity-qa-runner + qa-infinity-qa-ui, plus
# the postgres:16-alpine and redis:7-alpine base images in release/full mode
# (bundled via docker save/load like everything else) so a genuinely
# air-gapped remote never needs to reach Docker Hub for anything.
#
# Runs alongside other stacks on the same host - different project name,
# different containers/networks/volumes (all "qa-*"), different ports
# (3100/4100/5655/6180) and different remote directory. No overlap.
#
# Usage:
#   .\deploy.ps1                                  # SYNC mode by default - fast code deploy (~3-5 min)
#   .\deploy.ps1 -Mode release                    # full image build+transfer (first run, or runner changed)
#   .\deploy.ps1 -Mode full                       # release + DB dump/restore
#   .\deploy.ps1 -Mode package                    # build+save -> single zip, no SSH/SCP needed (~2.5 GB)
#   .\deploy.ps1 -Mode package -AppOnly           # api+runner+ui zip, no postgres/redis (~600-800 MB) — routine releases
#   .\deploy.ps1 -Services qa-api                 # sync api only (~90s)
#   .\deploy.ps1 -SSH my-alias                    # override SSH alias/host
#   .\deploy.ps1 -CorsOrigin http://10.0.0.5:3100 # set CORS origin for remote server (see below)
#   .\deploy.ps1 -RemoteComposeCmd 'docker-compose'   # force a specific compose invocation
#   .\deploy.ps1 -Mode release -StripExtraHosts   # drop this deployment's hardcoded extra_hosts
#                                                  # entries before shipping - use when handing a
#                                                  # release to a different team/target environment
#   .\deploy.ps1 -Mode package -CorsOrigin http://10.0.0.5:3100 -StripExtraHosts -OutZip C:\handoff\qa-infinity.zip
#
# Modes:
#   sync (DEFAULT) - Fastest for routine code changes.
#     Pushes local commits to 6D git, then pulls on the remote and rebuilds
#     with Docker layer cache. .env and scripts/ are gitignored - untouched.
#     Docker volumes (DB data, artifacts) are completely unaffected.
#     Transfer: seconds. Build: ~2-3 min (only src layer rebuilds).
#     Use for: any code change to api or ui.
#     Requires the remote to reach 6D git + npm/apt registries - NOT for air-gapped targets.
#
#   release - Full image build+save+transfer+load, including postgres/redis. Use for:
#     - First-time setup on a new remote (before git is initialised there)
#     - Any remote with no internet access (air-gapped / client server)
#     - Runner Dockerfile changes (qa-runner image)
#     - Dependency (pnpm-lock.yaml) changes
#     - When sync mode hits an unexpected issue
#     Requires SSH/SCP access to the target.
#
#   full - release + DB dump/restore from local to remote.
#     Only needed when you have local data to push to an existing remote instance.
#     Requires SSH/SCP access to the target.
#
#   package - Same build+save as release, but NO SSH/SCP at all. Everything
#     (image tarballs, docker-compose.yml, .env, nginx.conf, backup-db.sh, and
#     a generated INSTALL.md guide) is zipped into one file you hand to a
#     team you have no network path to - email, USB, file share, whatever.
#     Use for: a new team/client with no SSH access from this machine at all.
#
#   package + AppOnly - Builds and saves qa-api, qa-runner, and qa-ui.
#     postgres and redis are already on the server from a prior full package
#     deploy - no need to ship them again. Use for routine code releases
#     to air-gapped servers. Reduces zip size from ~2.5 GB to ~600-800 MB.
#     The server-side steps restart api + runner + ui; the DB is untouched.
#
# AppOnly flag:
#   Use -AppOnly with -Mode package (or release) to skip postgres and redis.
#   Only valid when those are already present on the target server from a prior
#   full deploy. api + runner + ui are always included. The generated zip and
#   INSTALL.md reflect this.
#
# CorsOrigin:
#   docker-compose.yml reads CORS_ORIGIN from .env (env_file + a localhost
#   fallback) - it has no hardcoded value of its own. In sync mode, just set
#   CORS_ORIGIN=http://<server-ip>:3100 in the remote .env once and it survives
#   every git pull. In release/full/package modes, -CorsOrigin patches
#   CORS_ORIGIN and APP_URL directly into the .env being shipped, so you don't
#   have to edit it by hand afterwards. If you don't know the target's address
#   yet (e.g. packaging for a team you haven't handed off to), leave it unset -
#   the receiving team sets it in their own .env once they know their server's
#   IP/hostname (the generated INSTALL.md walks them through it).
#
# StripExtraHosts:
#   docker-compose.yml hardcodes extra_hosts entries for reaching this
#   deployment's specific target application over an internal network. Pass
#   this switch when releasing to a different team/environment so their
#   compose file doesn't carry an internal hostname/IP that's meaningless
#   (and mildly leaky) on their network. Default deploys (this team's own
#   remote) leave it off and behave exactly as before.
# ==============================================================================

param(
    [ValidateSet('sync', 'release', 'full', 'package')]
    [string]$Mode = 'sync',
    [string]$SSH  = 'qa-server',
    [string]$RemoteDir = '/data/autoab/qa-infinity',
    # Services to deploy in sync mode (default: api + ui; runner rarely changes)
    [string]$Services = 'qa-api qa-ui',
    # Pass http://<server-ip>:3100 to patch CORS_ORIGIN for the remote server.
    # Leave blank to keep the compose default (http://localhost:3100).
    [string]$CorsOrigin,
    # Left unset by default -> auto-detected against the remote (see PHASE 0).
    # Pass this explicitly only to force a specific one and skip detection.
    [string]$RemoteComposeCmd,
    # Strip the extra_hosts entries from the packaged docker-compose.yml (release/full only).
    [switch]$StripExtraHosts,
    # Only skip postgres + redis. Builds and includes qa-api, qa-runner, qa-ui.
    # Use for routine code releases to air-gapped servers where those images are
    # already present from a prior full deploy. Cuts zip size from ~2.5 GB to ~300-500 MB.
    [switch]$AppOnly,
    # -Mode package only: output zip path. Defaults to
    # .\qa-infinity-offline-<timestamp>.zip in the repo root.
    [string]$OutZip
)
$RemoteComposeCmdExplicit = $PSBoundParameters.ContainsKey('RemoteComposeCmd')

$ErrorActionPreference = 'Stop'
$ProjectName    = 'qa-infinity'
$AllServices    = 'qa-postgres qa-redis qa-api qa-runner qa-ui'   # used by release/full modes
$TmpDir         = "$PSScriptRoot\.deploy-tmp"

# -- Helpers -------------------------------------------------------------------
function Log-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Log-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Log-Warn  { param($msg) Write-Host "    [!!] $msg" -ForegroundColor Yellow }
function Log-Error { param($msg) Write-Host "    [ERR] $msg" -ForegroundColor Red; exit 1 }

function Run-SSH {
    param([string]$cmd)
    ssh $SSH $cmd
    if ($LASTEXITCODE -ne 0) { Log-Error "Remote command failed: $cmd" }
}

# Same as Run-SSH but tolerates non-zero exit - used for best-effort/idempotent
# steps (seed, cron) where failure shouldn't abort the deploy.
function Run-SSH-Soft {
    param([string]$cmd)
    ssh $SSH $cmd
    if ($LASTEXITCODE -ne 0) { Log-Warn "Remote command reported a non-zero exit (continuing): $cmd" }
}

function Run-SCP {
    param([string]$local, [string]$remote)
    scp $local "${SSH}:${remote}"
    if ($LASTEXITCODE -ne 0) { Log-Error "SCP failed: $local -> $remote" }
}

# Reads a single KEY=value out of the local .env (last match wins, matching
# how shells/dotenv-style loaders treat repeated keys). Returns '' if unset.
function Read-EnvVar {
    param([string]$key)
    $line = Get-Content "$PSScriptRoot\.env" -ErrorAction SilentlyContinue |
        Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -Last 1
    if (-not $line) { return '' }
    return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

# -- Banner --------------------------------------------------------------------
Write-Host ""
Write-Host "  QA Infinity - Deploy" -ForegroundColor DarkCyan
Write-Host "  Mode   : $Mode$(if ($AppOnly) { ' (app-only: api + runner + ui)' })" -ForegroundColor White
if ($Mode -eq 'package') {
    Write-Host "  Output : local zip package (no SSH/SCP)" -ForegroundColor White
} else {
    Write-Host "  Target : $SSH  ->  $RemoteDir" -ForegroundColor White
}
if ($CorsOrigin) {
    Write-Host "  CORS   : $CorsOrigin" -ForegroundColor White
}
if ($AppOnly) {
    Write-Host "  AppOnly: skipping postgres, redis (must already be on server)" -ForegroundColor Yellow
}
Write-Host ""

if (-not (Test-Path "$PSScriptRoot\.env")) {
    Log-Error ".env not found at $PSScriptRoot\.env - copy .env.example to .env and fill it in first."
}

# ==============================================================================
# SYNC MODE - fast path: git push locally, git pull + layer-cached build on remote
# Typical time: ~2-4 min total.
# .env and scripts/ are gitignored - untouched by pull.
# Docker named volumes (qa-pgdata, qa-data, etc.) are completely unaffected.
# Exit early once done; the release/full phases below are skipped.
# ==============================================================================
if ($Mode -eq 'sync') {
    Log-Step "SYNC mode: git pull on remote + layer-cached build"

    # Detect remote compose command
    if (-not $RemoteComposeCmdExplicit) {
        $probe = ssh $SSH "sudo docker compose version >/dev/null 2>&1 && echo V2 || (sudo docker-compose version >/dev/null 2>&1 && echo V1 || echo NONE)"
        switch ($probe.Trim()) {
            'V2' { $RemoteComposeCmd = 'docker compose' }
            'V1' { $RemoteComposeCmd = 'docker-compose' }
            default { Log-Error "Neither 'sudo docker compose' nor 'sudo docker-compose' works on $SSH." }
        }
        Log-Ok "Remote compose: '$RemoteComposeCmd'"
    }

    # Guard: warn if Dockerfiles or pnpm-lock.yaml changed vs what is on remote.
    $remoteSha = (ssh $SSH "cd $RemoteDir && git rev-parse HEAD 2>/dev/null || echo ''").Trim()
    $localSha  = (git -C $PSScriptRoot rev-parse HEAD 2>$null).Trim()
    if ($remoteSha -and $localSha -and ($remoteSha -ne $localSha)) {
        $releaseFiles = @('pnpm-lock.yaml','packages/api/Dockerfile','packages/frontend/Dockerfile','packages/runner/Dockerfile')
        $changedCritical = git -C $PSScriptRoot diff --name-only $remoteSha $localSha -- $releaseFiles 2>$null
        if ($changedCritical) {
            Write-Host ""
            Write-Host "  [!!] Critical files changed since remote HEAD ($remoteSha):" -ForegroundColor Yellow
            $changedCritical | ForEach-Object { Write-Host "       $_" -ForegroundColor Yellow }
            Write-Host "  [!!] Use -Mode release to rebuild images with new deps/Dockerfile." -ForegroundColor Yellow
            Write-Host ""
            $cont = Read-Host "  Continue with sync anyway? (y/N)"
            if ($cont -ne 'y' -and $cont -ne 'Y') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
        }
    }

    # Step 1: push local commits to 6D GitLab so the remote can pull them
    Log-Step "Pushing local commits to 6D GitLab"
    git -C $PSScriptRoot push
    if ($LASTEXITCODE -ne 0) { Log-Error "git push failed" }
    Log-Ok "Pushed"

    # Step 2: pull on remote + layer-cached build + restart
    # .env and scripts/ are gitignored - untouched by pull.
    # Docker named volumes (qa-pgdata etc.) are completely unaffected.
    Log-Step "Pulling + building on remote for: $Services"
    ssh $SSH "cd $RemoteDir && git checkout -- . && git pull && sudo $RemoteComposeCmd -p $ProjectName build --parallel $Services && sudo $RemoteComposeCmd -p $ProjectName up -d --no-build $Services"
    if ($LASTEXITCODE -ne 0) { Log-Error "Remote pull/build/restart failed" }
    Log-Ok "Build and restart complete"

    # Health check
    Log-Step "Waiting for API health check (port 4100)"
    $healthy = $false
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 5
        $result = ssh $SSH "curl -sf http://localhost:4100/health 2>/dev/null && echo OK || echo FAIL"
        if ($result -match 'OK') { $healthy = $true; break }
        Write-Host "    Waiting... ($($i * 5)s)" -ForegroundColor Gray
    }
    if ($healthy) { Log-Ok "API is healthy" }
    else { Log-Warn "API health check timed out. Check: ssh $SSH 'sudo docker logs qa-api --tail 50'" }

    Write-Host ""
    Write-Host "  Sync deploy complete!" -ForegroundColor Green
    Write-Host "  Services : $Services" -ForegroundColor White
    Write-Host "  Target   : $SSH -> $RemoteDir" -ForegroundColor White
    Write-Host "  UI       : http://<server>:3100" -ForegroundColor White
    Write-Host "  API      : http://<server>:4100" -ForegroundColor White
    Write-Host ""
    exit 0
}

if ($Mode -eq 'full') {
    Log-Warn "FULL MIGRATION mode - this will stop remote services and overwrite the remote database with your local one."
    $confirm = Read-Host "  Type YES to continue"
    if ($confirm -ne 'YES') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
}

# ==============================================================================
# PHASE 0 - Detect remote docker compose invocation (fail fast, before
# spending time building/transferring images, if neither is usable)
# Skipped entirely in package mode - there is no remote to detect anything on.
# ==============================================================================
if ($Mode -eq 'package') {
    Log-Step "Package mode: no remote involved, skipping compose detection"
} elseif ($RemoteComposeCmdExplicit) {
    Log-Step "Using explicit -RemoteComposeCmd '$RemoteComposeCmd'"
} else {
    Log-Step "Detecting docker compose on $SSH (checked as root, since every later call runs under sudo)"
    # Root's plugin availability can differ from your login user's - the v2
    # `docker compose` plugin is commonly installed per-user under
    # ~/.docker/cli-plugins, which `sudo` (running as root, different $HOME)
    # won't see even if it works without sudo. Probing under sudo here is what
    # actually predicts whether PHASE 6+ will work.
    $probe = ssh $SSH "sudo docker compose version >/dev/null 2>&1 && echo V2 || (sudo docker-compose version >/dev/null 2>&1 && echo V1 || echo NONE)"
    switch ($probe.Trim()) {
        'V2' { $RemoteComposeCmd = 'docker compose' }
        'V1' { $RemoteComposeCmd = 'docker-compose' }
        default {
            Log-Error "Neither 'sudo docker compose' nor 'sudo docker-compose' works on $SSH. Install Docker Compose there (or grant root access to the existing per-user plugin), or pass -RemoteComposeCmd explicitly once you know which to use."
        }
    }
    Log-Ok "Using '$RemoteComposeCmd' on remote (auto-detected)"
}

# -- Temp dir ------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

# ==============================================================================
# PHASE 1 - Build images
# ==============================================================================
if ($AppOnly) {
    Log-Step "Building Docker images (api + runner + ui — AppOnly mode)"
    Push-Location $PSScriptRoot
    docker compose build qa-api qa-runner qa-ui
    if ($LASTEXITCODE -ne 0) { Log-Error "Docker build failed" }
    Log-Ok "Images built (postgres/redis skipped)"
} else {
    Log-Step "Building Docker images (api, runner, ui)"
    Push-Location $PSScriptRoot
    docker compose build qa-api qa-runner qa-ui
    if ($LASTEXITCODE -ne 0) { Log-Error "Docker build failed" }
    Log-Ok "Images built"
}

# ==============================================================================
# PHASE 2 - Save images to tar files
# postgres/redis are pulled here (requires internet on THIS machine, not the
# remote) and bundled the same way as the custom images, so the remote never
# needs to reach Docker Hub for anything - safe for a fully air-gapped target.
# ==============================================================================
Log-Step "Saving images to tar files$(if ($AppOnly) { ' (api + runner + ui — no postgres/redis)' })"

if ($AppOnly) {
    # App-only release — includes runner so script execution changes are also shipped.
    # postgres and redis are already on the server from a prior full deploy.
    $images = @(
        @{ name = 'qa-infinity-qa-api:latest';    tar = "$TmpDir\qa-api.tar"    },
        @{ name = 'qa-infinity-qa-runner:latest'; tar = "$TmpDir\qa-runner.tar" },
        @{ name = 'qa-infinity-qa-ui:latest';     tar = "$TmpDir\qa-ui.tar"     }
    )
} else {
    $images = @(
        @{ name = 'qa-infinity-qa-api:latest';    tar = "$TmpDir\qa-api.tar"    },
        @{ name = 'qa-infinity-qa-runner:latest'; tar = "$TmpDir\qa-runner.tar" },
        @{ name = 'qa-infinity-qa-ui:latest';     tar = "$TmpDir\qa-ui.tar"     },
        @{ name = 'postgres:16-alpine';           tar = "$TmpDir\postgres.tar"; pull = $true },
        @{ name = 'redis:7-alpine';               tar = "$TmpDir\redis.tar";    pull = $true }
    )
}

foreach ($img in $images) {
    if ($img.pull) {
        Write-Host "    Pulling $($img.name)..." -NoNewline
        docker pull $img.name | Out-Null
        if ($LASTEXITCODE -ne 0) { Log-Error "docker pull failed for $($img.name)" }
        Write-Host " done" -ForegroundColor Gray
    }
    Write-Host "    Saving $($img.name)..." -NoNewline
    docker save "$($img.name)" -o $img.tar
    if ($LASTEXITCODE -ne 0) { Log-Error "docker save failed for $($img.name)" }
    $sizeMB = [math]::Round((Get-Item $img.tar).Length / 1MB, 1)
    Write-Host " $sizeMB MB" -ForegroundColor Gray
}
Log-Ok "All images saved (including postgres/redis)"

# ==============================================================================
# PHASE 3 - Full migration: dump DB (full mode only)
# ==============================================================================
if ($Mode -eq 'full') {
    $pgUser = Read-EnvVar 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'qauser' }
    $pgDb   = Read-EnvVar 'POSTGRES_DB';   if (-not $pgDb)   { $pgDb   = 'qa_infinity' }

    Log-Step "Dumping PostgreSQL database from local container"
    docker exec qa-postgres pg_dump -U $pgUser $pgDb -f /tmp/qa-dump.sql
    if ($LASTEXITCODE -ne 0) { Log-Error "pg_dump failed" }
    docker cp qa-postgres:/tmp/qa-dump.sql "$TmpDir\qa-dump.sql"
    if ($LASTEXITCODE -ne 0) { Log-Error "docker cp dump failed" }
    Log-Ok "DB dump saved"
}

# ==============================================================================
# PHASE 4 - Prepare config files in tmp
# ==============================================================================
Log-Step "Preparing config files"

$composeContent = Get-Content "$PSScriptRoot\docker-compose.yml" -Raw

# docker-compose.yml also hardcodes extra_hosts entries pointing at this
# deployment's specific target application over an internal network -
# meaningless (and mildly leaky) on a different team's network. Strip them
# when packaging a release for somewhere else.
if ($StripExtraHosts) {
    $beforeLines = ($composeContent -split "`n").Count
    $composeContent = $composeContent -replace '(?m)^[ \t]*extra_hosts:\r?\n(?:[ \t]*-[ \t]*".*"\r?\n)+', ''
    $afterLines = ($composeContent -split "`n").Count
    Log-Ok "Stripped extra_hosts entries from compose file ($($beforeLines - $afterLines) line(s) removed)"
} else {
    Log-Warn "extra_hosts entries kept as-is (pass -StripExtraHosts when releasing to a different team/environment)"
}

Set-Content "$TmpDir\docker-compose.yml" $composeContent

# CORS_ORIGIN/APP_URL live in .env - docker-compose.yml only forwards them
# (env_file: .env, plus ${CORS_ORIGIN:-http://localhost:3100} interpolation),
# it doesn't hardcode a value itself. So -CorsOrigin patches .env, not the
# compose file.
$envContent = Get-Content "$PSScriptRoot\.env" -Raw
if ($CorsOrigin) {
    foreach ($key in @('CORS_ORIGIN', 'APP_URL')) {
        if ($envContent -match "(?m)^$key=.*$") {
            $envContent = $envContent -replace "(?m)^$key=.*$", "$key=$CorsOrigin"
        } else {
            $envContent = $envContent.TrimEnd("`r", "`n") + "`r`n$key=$CorsOrigin`r`n"
        }
    }
    Log-Ok "CORS_ORIGIN and APP_URL patched to $CorsOrigin in .env"
} else {
    Log-Warn "No -CorsOrigin specified - CORS_ORIGIN/APP_URL are whatever this local .env already has (likely http://localhost:3100)."
    Log-Warn "If the API and browser will be served from a different host, pass -CorsOrigin http://<server-ip>:3100, or have the receiving team set it in .env themselves once they know their server's address."
}
Set-Content "$TmpDir\.env" $envContent -NoNewline

# docker-compose.override.yml is local-dev only (hot-reload bind mounts etc.)
# and must NEVER be transferred to the remote server.

if (Test-Path "$PSScriptRoot\nginx\nginx.conf") {
    New-Item -ItemType Directory -Force -Path "$TmpDir\nginx" | Out-Null
    Copy-Item "$PSScriptRoot\nginx\nginx.conf" "$TmpDir\nginx\nginx.conf" -Force
}

if (Test-Path "$PSScriptRoot\scripts\backup-db.sh") {
    New-Item -ItemType Directory -Force -Path "$TmpDir\scripts" | Out-Null
    Copy-Item "$PSScriptRoot\scripts\backup-db.sh" "$TmpDir\scripts\backup-db.sh" -Force
}

Log-Ok "Config files ready"

# ==============================================================================
# PACKAGE MODE - zip everything up and stop. No SSH/SCP, no remote at all.
# Everything past this point (phases 5-10) is remote-only, so package mode
# ends here.
# ==============================================================================
if ($Mode -eq 'package') {
    Log-Step "Writing INSTALL.md guide"

    $currentSha = (git -C $PSScriptRoot rev-parse --short HEAD 2>$null)
    if (-not $currentSha) { $currentSha = '(unknown - not built from a git checkout)' }
    $buildDate = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $corsNote = if ($CorsOrigin) { "$CorsOrigin (already patched into .env)" } else { 'NOT set - edit CORS_ORIGIN/APP_URL in .env before starting (see Step 3)' }
    $extraHostsNote = if ($StripExtraHosts) { 'Stripped - none of this deployment''s internal extra_hosts entries are included.' } else { 'Kept as-is - check docker-compose.yml for extra_hosts entries specific to the original deployment and remove/edit any that don''t apply to your network.' }
    $releaseType = if ($AppOnly) { 'APP UPDATE (api + runner + ui)' } else { 'FULL' }

    if ($AppOnly) {
        $installGuide = @"
# QA Infinity - App Update Package

Built: $buildDate (git $currentSha)
Release type: APP UPDATE — api + runner + ui images

This is a routine code update. It assumes the server already has a working
qa-infinity stack from a prior FULL package deploy.

postgres and redis are NOT in this zip — they are already on the server
and do not need to be touched.

## What's in this zip

| File | Purpose |
|---|---|
| ``qa-api.tar`` | Updated API image |
| ``qa-runner.tar`` | Updated runner image (Playwright + Robot Framework) |
| ``qa-ui.tar`` | Updated UI (frontend) image |
| ``docker-compose.yml`` | Stack definition (keep in sync with server) |

## Step 1 - Copy and unzip on the server

``````bash
unzip -o qa-infinity-offline-*.zip -d /opt/qa-infinity-update
cd /opt/qa-infinity-update
``````

## Step 2 - Load the new images

``````bash
docker load -i qa-api.tar
docker load -i qa-runner.tar
docker load -i qa-ui.tar
``````

## Step 3 - Restart api + runner + ui (db stays running)

``````bash
cd /opt/qa-infinity          # your existing install directory
docker compose -p qa-infinity up -d --no-build qa-api qa-runner qa-ui
``````

## Step 3b - Fix volume ownership (only if this server predates non-root images)

qa-api and qa-runner run as non-root (uid 1000) inside their containers. Skip
this step if the server was already running non-root images before this update.
If it wasn't, volumes owned by root from the old containers will cause startup
errors like ``EACCES: permission denied``.
Fix once (safe to re-run - a no-op once ownership is already correct):

``````bash
cd /opt/qa-infinity
[ -d scripts ] && sudo find scripts -not -uid 1000 -exec chown 1000:1000 {} +
for vol in qa-artifacts qa-data qa-reqdocs; do
  docker run --rm -v qa-infinity_${vol}:/vol alpine sh -c "find /vol -not -uid 1000 -exec chown 1000:1000 {} +"
done
docker compose -p qa-infinity restart qa-api qa-runner qa-ui
``````

## Step 4 - Verify

``````bash
curl -sf http://localhost:4100/health && echo OK
``````

Done. The database and all test scripts are untouched.
"@
    } else {
        $installGuide = @"
# QA Infinity - Offline Installation Guide

Built: $buildDate (git $currentSha)
Release type: FULL (all images included)

This package is fully self-contained. The target server needs **no internet
access** - Docker Hub, npm, apt, PyPI etc. are never contacted. It only needs
Docker Engine + Docker Compose v2 already installed.

## What's in this zip

| File | Purpose |
|---|---|
| ``qa-api.tar``, ``qa-runner.tar``, ``qa-ui.tar`` | The three app images, pre-built |
| ``postgres.tar``, ``redis.tar`` | Base images, pre-pulled |
| ``docker-compose.yml`` | Stack definition |
| ``.env`` | Filled-in config - **contains real credentials/secrets, handle like a password file** |
| ``nginx/nginx.conf`` | Frontend proxy config (if present) |
| ``scripts/backup-db.sh`` | Nightly DB backup script (if present) |

## Prerequisites on the target server

- Docker Engine + Docker Compose v2 installed. Confirm with:
  ``docker compose version``
  (This is the one thing this package doesn't provide - if the server has
  zero internet, get Docker itself from an offline installer or your IT/imaging
  process first.)
- 20 GB free disk (images + Postgres data + artifacts), 8 GB RAM minimum.

## Step 1 - Unpack

Copy this zip to the target server (USB, file share, email - whatever path
you have) and extract it to its own directory, e.g.:

``````bash
mkdir -p /opt/qa-infinity && cd /opt/qa-infinity
unzip qa-infinity-offline-*.zip
``````

## Step 2 - Load the images

``````bash
docker load -i qa-api.tar
docker load -i qa-runner.tar
docker load -i qa-ui.tar
docker load -i postgres.tar
docker load -i redis.tar
``````

## Step 3 - Review .env and docker-compose.yml

CORS_ORIGIN baked in at build time: $corsNote

extra_hosts entries: $extraHostsNote

Open ``.env`` and check/adjust for this target, at minimum:

- ``POSTGRES_PASSWORD`` / ``JWT_SECRET`` - already filled in; rotate them for
  a new team/client rather than reusing the source deployment's values.
- ``ALLOWED_DOMAINS`` - the new team's email domain (or blank to allow any).
- ``CORS_ORIGIN`` / ``APP_URL`` - ``http://<this-server-ip>:3100``.
- ``APP_MODE``:
  - ``runner`` - recommended if this server has no reachable LLM endpoint.
    Disables AI-dependent routes (Test Writer, Chat Agent, Healing Agent, UI
    Scanner). Test Case Library, script execution, Scheduler, and Reports all
    work fully offline regardless of this setting.
  - ``full`` - only if the server has some reachable LLM endpoint (internal
    LLM proxy, or genuine internet access to OpenRouter/Anthropic).
- Leave ``JIRA_*`` / ``SMTP_*`` blank unless those services are reachable
  from this server.

## Step 4 - Start the stack

``````bash
cd /opt/qa-infinity
docker compose up -d
docker compose ps          # all 5 containers should be healthy
``````

## Step 4b - Fix volume ownership (only if reusing an existing install's volumes)

qa-runner and qa-api run as non-root (uid 1000) inside their containers. On a
genuinely brand-new install this is already correct - skip this step. If
you pointed this package at an EXISTING install's volumes (reusing them from
an older package built before this hardening), qa-runner will crash-loop
with errors like ``EACCES: permission denied, mkdir '/artifacts/...'``
because those volumes are still owned by root from the old containers.
Fix once (safe to re-run - a no-op once ownership is already correct):

``````bash
cd /opt/qa-infinity
[ -d scripts ] && sudo find scripts -not -uid 1000 -exec chown 1000:1000 {} +
for vol in qa-artifacts qa-data qa-reqdocs; do
  docker run --rm -v qa-infinity_${vol}:/vol alpine sh -c "find /vol -not -uid 1000 -exec chown 1000:1000 {} +"
done
docker compose restart qa-runner qa-api
``````

## Step 5 - Verify

``````bash
curl -sf http://localhost:4100/health && echo OK
``````

Then open ``http://<this-server-ip>:3100`` in a browser, register the first
account (it automatically becomes Super Admin), create a project, and confirm
a test run executes end-to-end.

## Optional - bootstrap admin account via seed

If ``SEED_ADMIN_EMAIL`` / ``SEED_ADMIN_PASSWORD`` are set in ``.env``:

``````bash
docker compose exec -T qa-api sh -c 'cd packages/api && pnpm db:seed'
``````

## Optional - nightly DB backup cron

If ``scripts/backup-db.sh`` is included in this package:

``````bash
chmod +x scripts/backup-db.sh
( crontab -l 2>/dev/null | grep -v backup-db.sh
  echo "0 3 * * * /opt/qa-infinity/scripts/backup-db.sh >>/opt/qa-infinity/backups/cron.log 2>&1" ) | crontab -
``````

(Adjust the ``/opt/qa-infinity`` path above if you extracted somewhere else.)
"@
    }
    Set-Content -Path "$TmpDir\INSTALL.md" -Value $installGuide
    Log-Ok "INSTALL.md written ($releaseType)"

    Log-Step "Building zip package"
    if (-not $OutZip) {
        $OutZip = "$PSScriptRoot\qa-infinity-offline-$(Get-Date -Format 'yyyyMMdd-HHmmss').zip"
    }
    if (Test-Path $OutZip) { Remove-Item -Force $OutZip }

    # Compress-Archive uses a ZipArchive stream internally and silently fails
    # on archives > 2 GB. Use System.IO.Compression.ZipFile directly — it
    # writes entries one-by-one and has no 2 GB ceiling.
    Add-Type -Assembly 'System.IO.Compression'
    Add-Type -Assembly 'System.IO.Compression.FileSystem'

    $zipStream   = [System.IO.File]::Open($OutZip, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    $zipArchive  = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

    try {
        Get-ChildItem -Path $TmpDir -File | ForEach-Object {
            $entryName = $_.Name
            Write-Host "    Adding $entryName ($([math]::Round($_.Length / 1MB, 1)) MB)..." -ForegroundColor DarkGray
            $entry     = $zipArchive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Fastest)
            $entryStream = $entry.Open()
            $fileStream  = [System.IO.File]::OpenRead($_.FullName)
            try   { $fileStream.CopyTo($entryStream) }
            finally { $fileStream.Dispose(); $entryStream.Dispose() }
        }
    } finally {
        $zipArchive.Dispose()
        $zipStream.Dispose()
    }

    $zipSizeMB = [math]::Round((Get-Item $OutZip).Length / 1MB, 1)
    Log-Ok "Package written: $OutZip ($zipSizeMB MB)"

    Log-Step "Cleaning up local temp files"
    Remove-Item -Recurse -Force $TmpDir
    Log-Ok "Done"

    Pop-Location

    Write-Host ""
    Write-Host "  Package complete!" -ForegroundColor Green
    Write-Host "  Zip    : $OutZip ($zipSizeMB MB)" -ForegroundColor White
    Write-Host "  Type   : $releaseType" -ForegroundColor White
    Write-Host "  Guide  : INSTALL.md (inside the zip)" -ForegroundColor White
    Write-Host ""
    if ($AppOnly) {
        Write-Host "  On the server:" -ForegroundColor Cyan
        Write-Host "    docker load -i qa-api.tar" -ForegroundColor White
        Write-Host "    docker load -i qa-runner.tar" -ForegroundColor White
        Write-Host "    docker load -i qa-ui.tar" -ForegroundColor White
        Write-Host "    docker compose -p qa-infinity up -d --no-build qa-api qa-runner qa-ui" -ForegroundColor White
    } else {
        Write-Host "  [!!] This zip contains .env with real secrets (DB password, JWT" -ForegroundColor Yellow
        Write-Host "       secret, etc.) - share it over a secure channel, not open chat/email." -ForegroundColor Yellow
    }
    Write-Host ""
    exit 0
}

# ==============================================================================
# PHASE 5 - Transfer to remote server
# ==============================================================================
Log-Step "Transferring files to $SSH"

# Detect first-time vs. rolling deploy - informational only.
$remoteExists = ssh $SSH "test -f $RemoteDir/docker-compose.yml && echo EXISTS || echo NEW"
$isFirstDeploy = $remoteExists -notmatch 'EXISTS'
if ($isFirstDeploy) {
    Log-Warn "No existing deployment found at $RemoteDir - first-time setup. Postgres/Redis will be pulled and initialized fresh on this run."
} else {
    Log-Ok "Existing deployment found at $RemoteDir - rolling update (Postgres/Redis keep their existing data untouched)."
}

# Guard against POSTGRES_PASSWORD drift on rolling deploys.
# Changing the password in .env after Postgres has already initialized its data
# directory will NOT change the real DB password - it only breaks the connection.
if (-not $isFirstDeploy) {
    $remotePgPassLine  = ssh $SSH "grep -E '^POSTGRES_PASSWORD=' $RemoteDir/.env 2>/dev/null | tail -1"
    $remotePgPassValue = if ($remotePgPassLine) { ($remotePgPassLine -split '=', 2)[1].Trim().Trim('"').Trim("'") } else { $null }
    $localPgPassValue  = Read-EnvVar 'POSTGRES_PASSWORD'
    if ($remotePgPassValue -and ($remotePgPassValue -ne $localPgPassValue)) {
        Log-Warn "POSTGRES_PASSWORD in your local .env differs from what is already deployed at $RemoteDir/.env."
        Log-Warn "Changing it now will NOT change the running database's real password - qa-api will fail to connect after this deploy."
        Log-Warn "If you need to rotate it, change the password inside Postgres first (ALTER ROLE), then update .env to match."
        $confirmPg = Read-Host "  Type YES to deploy anyway with the new .env"
        if ($confirmPg -ne 'YES') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
    }
}

# Ensure remote directory tree exists
Run-SSH "mkdir -p $RemoteDir"

# Transfer images
foreach ($img in $images) {
    $tarName = Split-Path $img.tar -Leaf
    Write-Host "    Uploading $tarName..." -NoNewline
    Run-SCP $img.tar "$RemoteDir/$tarName"
    Write-Host " done" -ForegroundColor Gray
}

# Transfer compose + env
Run-SCP "$TmpDir\docker-compose.yml" "$RemoteDir/docker-compose.yml"
Run-SCP "$TmpDir\.env"               "$RemoteDir/.env"


# nginx config (bind-mounted by qa-ui)
if (Test-Path "$TmpDir\nginx\nginx.conf") {
    Run-SSH "mkdir -p $RemoteDir/nginx"
    Run-SCP "$TmpDir\nginx\nginx.conf" "$RemoteDir/nginx/nginx.conf"
}

# Backup script + cron log dir
if (Test-Path "$TmpDir\scripts\backup-db.sh") {
    Run-SSH "mkdir -p $RemoteDir/scripts $RemoteDir/backups"
    Run-SCP "$TmpDir\scripts\backup-db.sh" "$RemoteDir/scripts/backup-db.sh"
    Run-SSH "chmod +x $RemoteDir/scripts/backup-db.sh"
}

# scripts/ is a bind mount (./scripts:/scripts) - Docker auto-creates the host
# directory on first container start. Generated .robot files accumulate there
# between deploys with no action needed from this script.

if ($Mode -eq 'full') {
    Run-SCP "$TmpDir\qa-dump.sql" "$RemoteDir/qa-dump.sql"
}

Log-Ok "All files transferred"

# ==============================================================================
# PHASE 6 - Load images and (re)start on remote
# ==============================================================================
Log-Step "Loading images on remote server"

foreach ($img in $images) {
    $tarName = Split-Path $img.tar -Leaf
    Write-Host "    Loading $tarName..." -NoNewline
    Run-SSH "sudo docker load -i $RemoteDir/$tarName"
    Write-Host " done" -ForegroundColor Gray
}
Log-Ok "Images loaded"

if ($Mode -eq 'full') {
    $pgUser = Read-EnvVar 'POSTGRES_USER'; if (-not $pgUser) { $pgUser = 'qauser' }
    $pgDb   = Read-EnvVar 'POSTGRES_DB';   if (-not $pgDb)   { $pgDb   = 'qa_infinity' }

    Log-Step "Stopping API for full migration (Postgres/Redis stay up so we can restore into them)"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName up -d qa-postgres qa-redis"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName stop qa-api qa-runner qa-ui"

    Log-Step "Restoring database"
    Run-SSH "sudo docker exec qa-postgres psql -U $pgUser -c `"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$pgDb' AND pid <> pg_backend_pid();`""
    Run-SSH "sudo docker exec qa-postgres psql -U $pgUser -c 'DROP DATABASE IF EXISTS $pgDb;'"
    Run-SSH "sudo docker exec qa-postgres psql -U $pgUser -c 'CREATE DATABASE $pgDb;'"
    Run-SSH "sudo docker cp $RemoteDir/qa-dump.sql qa-postgres:/tmp/qa-dump.sql"
    Run-SSH "sudo docker exec qa-postgres psql -U $pgUser -d $pgDb -f /tmp/qa-dump.sql"
    Log-Ok "Database restored"

    Log-Step "Starting all services"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName up -d --no-build $AllServices"
} else {
    Log-Step "Rolling (re)start on remote"
    Run-SSH "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName up -d --no-build $AllServices"
}

Log-Ok "Services (re)started"

# ==============================================================================
# PHASE 7 - Health check
# ==============================================================================
Log-Step "Waiting for API health check (port 4100)"

$healthy = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 5
    $result = ssh $SSH "curl -sf http://localhost:4100/health 2>/dev/null && echo OK || echo FAIL"
    if ($result -match 'OK') { $healthy = $true; break }
    Write-Host "    Waiting... ($($i * 5)s)" -ForegroundColor Gray
}

if ($healthy) {
    Log-Ok "API is healthy"
} else {
    Log-Warn "API health check timed out - check logs with:"
    Write-Host "    ssh $SSH 'sudo docker logs qa-api --tail 50'" -ForegroundColor Yellow
}

# ==============================================================================
# PHASE 8 - Bootstrap admin account
# (idempotent - skips if SEED_ADMIN_EMAIL is unset or the user already exists)
# ==============================================================================
if ($healthy) {
    $seedEmail = Read-EnvVar 'SEED_ADMIN_EMAIL'
    if ($seedEmail) {
        Log-Step "Seeding bootstrap admin account ($seedEmail)"
        Run-SSH-Soft "cd $RemoteDir && sudo $RemoteComposeCmd -p $ProjectName exec -T qa-api sh -c 'cd packages/api && pnpm db:seed 2>&1 || true'"
    } else {
        Log-Step "SEED_ADMIN_EMAIL not set in .env - skipping admin seed"
        Log-Warn "No bootstrap admin will be created. Set SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD in .env and redeploy, or create a user manually."
    }
}

# ==============================================================================
# PHASE 9 - Install/refresh the nightly DB backup cron job
# (idempotent - re-running always ends with exactly one correct entry)
# ==============================================================================
if (Test-Path "$PSScriptRoot\scripts\backup-db.sh") {
    Log-Step "Installing nightly backup cron job (03:00 daily, on-host only)"
    $cronLine = "0 3 * * * $RemoteDir/scripts/backup-db.sh >>$RemoteDir/backups/cron.log 2>&1"
    $cronCmd  = "(crontab -l 2>/dev/null | grep -v backup-db.sh; echo '$cronLine') | crontab -"
    Run-SSH-Soft $cronCmd
    Log-Ok "Backup cron installed - dumps land in $RemoteDir/backups"
}

# ==============================================================================
# PHASE 10 - Disk usage
# ==============================================================================
Log-Step "Remote disk usage"
Run-SSH "df -h /data"

# Record current SHA - future sync deploys will diff against this
$currentSha = (git -C $PSScriptRoot rev-parse HEAD 2>$null).Trim()
if ($currentSha) {
    Run-SSH "echo '$currentSha' > $RemoteDir/.last-deploy-sha"
    Log-Ok "Recorded deploy SHA: $currentSha"
}

# -- Cleanup -------------------------------------------------------------------
Log-Step "Cleaning up local temp files"
Remove-Item -Recurse -Force $TmpDir
Log-Ok "Done"

Pop-Location

Write-Host ""
Write-Host "  Deployment complete!" -ForegroundColor Green
Write-Host "  Mode   : $Mode" -ForegroundColor White
Write-Host "  Target : $SSH -> $RemoteDir" -ForegroundColor White
Write-Host "  UI     : http://<server>:3100" -ForegroundColor White
Write-Host "  API    : http://<server>:4100" -ForegroundColor White
Write-Host "  noVNC  : http://<server>:6180  (live runner view)" -ForegroundColor White
Write-Host ""

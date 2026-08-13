# QA Infinity — Deployment Guide

This guide covers everything needed to deploy QA Infinity in restricted, air-gapped, or
on-premises Kubernetes / OpenShift environments. It is written from lessons learned during
the VIL dev-environment bring-up.

---

## Table of Contents

1. [Minimum Resource Requirements](#1-minimum-resource-requirements)
2. [Pod Security Context](#2-pod-security-context)
3. [Postgres on NFS / Restricted Volumes](#3-postgres-on-nfs--restricted-volumes)
4. [Redis — Non-Root Configuration](#4-redis--non-root-configuration)
5. [WebSocket Proxying (Contour / Envoy)](#5-websocket-proxying-contour--envoy)
6. [TLS / Ingress Configuration](#6-tls--ingress-configuration)
7. [CORS Configuration](#7-cors-configuration)
8. [Air-Gapped Docker Build](#8-air-gapped-docker-build)
9. [APP_MODE=runner for Air-Gapped Sites](#9-app_moderunner-for-air-gapped-sites)
10. [Fresh Linux Server Setup](#10-fresh-linux-server-setup)
11. [Day-to-Day Git Workflow](#11-day-to-day-git-workflow)
12. [When to Rebuild vs Restart](#12-when-to-rebuild-vs-restart)
13. [Database Migrations](#13-database-migrations)
14. [Sync Script (DB & Volumes)](#14-sync-script-db--volumes)
15. [GitHub Personal Access Token](#15-github-personal-access-token)

---

## 1. Minimum Resource Requirements

### Runner (`qa-runner`)

The runner container has significant always-on overhead before any test runs:

| Always-on component | Memory |
|---|---|
| 6 × Xvfb displays + x11vnc | ~360 MB |
| 3 × warm rfbrowser-node gRPC servers | ~300 MB |
| Node.js runner server | ~80 MB |
| **Idle total** | **~740 MB** |

Each concurrent browser lane adds:

| Per-lane component | Memory |
|---|---|
| Headed Chromium (`--disable-dev-shm-usage`) | ~400–500 MB |
| Robot Framework process + Python venv imports | ~120–150 MB |
| Video recording buffers (unbounded until flush) | ~100–150 MB |
| **Per-lane total** | **~620–800 MB** |

**Recommended settings by deployment type:**

| Deployment | Memory limit | Workers | `/dev/shm` |
|---|---|---|---|
| Single-node (constrained cluster) | **6 Gi** | 1 | disk-backed (omit `shm_size`) |
| Multi-node (one runner per node) | **6 Gi per replica** | 1–2 | 1 Gi memory-backed |
| High-throughput (dedicated runner nodes) | **8–12 Gi** | 2–3 | 2 Gi memory-backed |

> **Why 6 Gi?** The default `docker-compose.yml` sizes the runner for up to 6 concurrent
> runs (matching BullMQ `concurrency: 6`). At 3 parallel workers peak usage is ~3 GB;
> 6 Gi provides headroom for video recording spikes, RF XML output, and `/tmp` run dirs.

> **Note on `/dev/shm`:** Both the Playwright config and the Chrome wrapper already pass
> `--disable-dev-shm-usage`, routing Chrome's shared memory to `/tmp`. The `shm_size`
> value in docker-compose is only needed for Selenium-based scripts. Using a disk-backed
> (host-path or emptyDir) mount for `/tmp` removes it from the container memory limit.

### API (`qa-api`)

| Setting | Value |
|---|---|
| Memory limit | 1 Gi (default) |
| CPU limit | 0.75 (default) |

### Other services

Redis: 256 Mi · Postgres: 512 Mi · UI (nginx): 64 Mi

---

## 2. Pod Security Context

QA Infinity images are built to run as non-root. Apply the following security context
to every workload in your Helm chart or Kubernetes manifests:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000          # 'node' user (api), 'runner' user (runner)
  fsGroup: 1000
  supplementalGroups: [0]
  seccompProfile:
    type: RuntimeDefault
  capabilities:
    drop: [ALL]
```

For the UI (`qa-ui` / nginx), use `runAsUser: 65534` (nobody).

> **Image user summary:**
> - `qa-api` → `node` (uid 1000, built into `node:alpine`)
> - `qa-runner` → `runner` (uid 1000, created in Dockerfile)
> - `qa-ui` → `nobody` (uid 65534, built into `nginx:alpine`)
> - `qa-redis` → redis official image runs as `redis` (uid 999) by default
> - `qa-postgres` → postgres official image runs as `postgres` (uid 999) by default

---

## 3. Postgres on NFS / Restricted Volumes

The stock `postgres:16-alpine` image runs `initdb` as the `postgres` user (uid 999).
On NFS-backed PVCs the volume root is usually owned by root, so `initdb` fails with
permission errors unless the runtime UID owns the data directory.

**Fix:** Set `PGDATA` to a subdirectory of the mount point. Postgres will `mkdir` and
`chown` the subdirectory at init time, and because the runtime UID owns the subdirectory
(not the volume root) the permission check passes.

```yaml
# In your docker-compose.yml or Kubernetes deployment:
environment:
  - PGDATA=/var/lib/postgresql/data/pgdata   # ← subdirectory, not the volume root
volumes:
  - qa-pgdata:/var/lib/postgresql/data       # ← PVC mounted at parent dir
```

> ⚠️ **Existing deployments:** Changing `PGDATA` on a deployment that already has data
> in `/var/lib/postgresql/data` will cause Postgres to reinitialise from scratch (the
> subdirectory doesn't exist yet, so it looks like a fresh install). Take a `pg_dump`
> backup before applying this change to an existing cluster, then restore after.

---

## 4. Redis — Non-Root Configuration

The default Redis config writes its RDB snapshot to `/data` (the volume mount root),
which is root-owned on most restricted PVCs. With `stop-writes-on-bgsave-error yes`
(the Redis default), a failed background save **blocks all writes** while Redis
continues to respond to `PING` — the pod looks healthy but all operations return errors.

The `docker-compose.yml` already passes the correct flags:

```
redis-server --dir /tmp --stop-writes-on-bgsave-error no
```

For Helm / Kubernetes deployments, set these in your Redis config map or command args:

```yaml
command: ["redis-server"]
args:
  - "--dir"
  - "/tmp"
  - "--stop-writes-on-bgsave-error"
  - "no"
  - "--requirepass"
  - "$(REDIS_PASSWORD)"
```

---

## 5. WebSocket Proxying (Contour / Envoy)

The live execution log streams over Socket.io (WebSocket upgrade). OpenShift's HAProxy
router proxies WebSocket upgrades automatically; **Contour/Envoy does not** — you must
opt in per-route.

Add this annotation to the `qa-ui` Ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: qa-infinity
  annotations:
    projectcontour.io/websocket-routes: "/"   # ← enables WS upgrade on all paths
spec:
  rules:
    - host: qa-infinity.apps.your-cluster.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: qa-ui
                port:
                  number: 8080
```

Without this annotation the Socket.io handshake falls back to HTTP long-polling,
which causes the live log panel to appear blank even though tests are running.

---

## 6. TLS / Ingress Configuration

QA Infinity must be served over HTTPS in production — the CORS and cookie configuration
assumes a single canonical `https://` origin.

**Requirements:**
- Ingress host must be under a DNS name reachable from the users' workstations
- TLS certificate must match the ingress host (wildcard certs work)
- Port 443 must be reachable from workstations (not just port 80)

**Example (using an existing wildcard cert secret):**

```yaml
spec:
  tls:
    - hosts:
        - qa-infinity.apps.your-cluster.example.com
      secretName: wildcard-tls-secret   # existing cert secret in the namespace
  rules:
    - host: qa-infinity.apps.your-cluster.example.com
      ...
```

---

## 7. CORS Configuration

The API rejects requests from origins not listed in `CORS_ORIGIN` with **403 Forbidden**
(not 500). A mismatch causes all browser requests to fail with a CORS error.

Set both variables to the exact `https://` URL your users access QA Infinity on:

```env
APP_URL=https://qa-infinity.apps.your-cluster.example.com
CORS_ORIGIN=https://qa-infinity.apps.your-cluster.example.com
```

> The API logs a startup warning if `CORS_ORIGIN` is unset or does not include `APP_URL`:
> ```
> [qa-api] WARNING: CORS_ORIGIN ("http://localhost:3100") does not include APP_URL ("https://...")
> ```
> Check `docker logs qa-api` or your pod logs immediately after startup if browser requests fail.

**Multiple origins** (e.g. staging + production on the same API):
```env
CORS_ORIGIN=https://qa-infinity-staging.example.com,https://qa-infinity.example.com
```

---

## 8. Air-Gapped Docker Build

The runner Dockerfile fetches Chrome for Testing and Playwright browsers **at build time**
(not runtime). An air-gapped build environment needs these pre-staged.

### Chrome for Testing (Dockerfile lines 18–21)

The two ZIPs are fetched from `storage.googleapis.com`. Mirror them to an internal
object store and override the download URLs with build args:

```dockerfile
# Add to runner/Dockerfile (replace the curl lines):
ARG CHROME_BASE_URL=https://storage.googleapis.com/chrome-for-testing-public
ARG CHROME_VERSION=131.0.6778.85
RUN curl -fsSL "${CHROME_BASE_URL}/${CHROME_VERSION}/linux64/chrome-linux64.zip" ...
```

Then build with:
```bash
docker build \
  --build-arg CHROME_BASE_URL=https://internal-mirror.example.com/cft \
  --build-arg CHROME_VERSION=131.0.6778.85 \
  -f packages/runner/Dockerfile .
```

Alternatively, pre-copy the ZIPs into the build context and use `COPY` + `unzip`:
```dockerfile
COPY chrome-linux64.zip /tmp/chrome.zip
COPY chromedriver-linux64.zip /tmp/chromedriver.zip
RUN unzip -q /tmp/chrome.zip -d /opt/ && ...
```

### Playwright / RF Browser browsers (Dockerfile lines 51, 60)

`python -m Browser.entry init` and `@playwright/test install chromium` both contact
`playwright.azureedge.net` to download browser binaries. Since the base image
(`mcr.microsoft.com/playwright:v1.60.0-jammy`) already ships the correct Chromium,
set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to reuse it:

```dockerfile
# Add before the Browser.entry init line:
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 /opt/rfbrowser/bin/python -m Browser.entry init || true
```

For the `@playwright/test install chromium` line, ensure `@playwright/test` is pinned
to the same major version as the base image (`v1.60.0`) so it resolves against the
already-downloaded revision:

```dockerfile
# Already set — confirm it matches the base image version:
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
```

### Podman rootless storage on a jump server

If building with rootless Podman on a jump server with a small `/home` partition,
relocate the storage root before building:

```bash
# ~/.config/containers/storage.conf
[storage]
  driver = "overlay"
  graphRoot = "/data/podman-storage"   # point to a larger partition
```

### Harbor with an internal CA

```bash
# Push with --tls-verify=false when using a self-signed or internal CA:
podman push --tls-verify=false harbor.internal.example.com/qa-infinity/qa-api:latest

# Or add the CA to the system trust store on the jump server:
cp internal-ca.crt /etc/pki/ca-trust/source/anchors/
update-ca-trust
```

---

## 9. APP_MODE=runner for Air-Gapped Sites

Sites without internet access (no Anthropic API key, no JIRA, no SMTP) should set:

```env
APP_MODE=runner
```

In `runner` mode the API starts only the `runWorker` and `runWatchdog` BullMQ workers.
All AI features (script generation, self-healing, agent scan) are disabled. Test execution,
reporting, and scheduling continue to work normally.

Strip these keys from the `.env` before deployment to avoid confusing error logs:
- `ANTHROPIC_API_KEY`
- `JIRA_HOST` / `JIRA_EMAIL` / `JIRA_API_TOKEN`
- `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`

---

## 10. Fresh Linux Server Setup

Use this section when deploying QA Infinity onto a brand-new RHEL / CentOS server.

### Prerequisites

```bash
# Install Docker
sudo yum install -y docker
sudo systemctl enable docker --now
sudo usermod -aG docker $USER
# Log out and back in so group membership takes effect, then verify:
docker info

# Install git
sudo yum install -y git
```

> **Log out after `usermod`:** The group change only applies after you log out and back in. Without this, all `docker` commands need `sudo`.

### Clone the repository

```bash
sudo mkdir -p /data/autoab
cd /data/autoab
git clone https://github.com/albinbenny-dev/qa-infinity.git
cd qa-infinity
```

If the repo is private, git prompts for your GitHub username and a Personal Access Token as the password (see [§13 — GitHub Personal Access Token](#13-github-personal-access-token)).

### Configure `.env`

The `.env` file is not tracked in git. Create it manually on every new server.

**Option A — Copy from an existing server:**
```bash
scp existing-server:/data/autoab/qa-infinity/.env \
    /data/autoab/qa-infinity/.env
```

**Option B — Create from template:**
```bash
cp .env.example .env
nano .env    # fill in all required values
```

> **Never commit `.env` to git.** It is in `.gitignore` and must never be pushed.

### Build and start

```bash
cd /data/autoab/qa-infinity
docker compose up -d --build
```

What happens automatically on first boot:

1. **Redis** starts and becomes healthy
2. **qa-api** runs `prisma migrate deploy` (applies all migrations), then starts on port 4000
3. **qa-runner** starts once api is healthy
4. **qa-ui** (nginx) serves the frontend on port 3100

> **First build takes 3–5 minutes.** Docker pulls base images and compiles TypeScript. Subsequent restarts are much faster.

### Verify

```bash
docker compose ps                    # all containers should be "running"
docker compose logs -f qa-api        # watch for errors
curl http://localhost:4000/health    # should return {"status":"ok"}
```

| Service | URL | Notes |
|---|---|---|
| Frontend | `http://<server-ip>:3100` | Main app |
| API | `http://<server-ip>:4100` | REST + WebSocket |
| Prisma Studio | `http://<server-ip>:5655` | DB browser (dev only — do not expose) |
| noVNC | `http://<server-ip>:6180` | Live browser viewer during test runs |

---

## 11. Day-to-Day Git Workflow

### Changes made on the server → pull locally

```bash
# On the server
cd /data/autoab/qa-infinity
git add .
git commit -m "feat: describe what changed"
git push
```

```powershell
# On your local Windows machine
git pull
```

### Changes made locally → deploy to server

```bash
# Local machine
git add .
git commit -m "feat: describe what changed"
git push

# On the server — pull and apply
./sync.sh          # pulls latest and restarts affected services
```

---

## 12. When to Rebuild vs Restart

| What changed | Command on server |
|---|---|
| TypeScript / JS source files only (`src/`) | `docker compose restart` |
| `package.json`, `pnpm-lock.yaml` | `docker compose up -d --build` |
| Any `Dockerfile` | `docker compose up -d --build` |
| New Prisma migration | `docker compose exec qa-api npx prisma migrate deploy` |
| `nginx/nginx.conf` | `docker compose restart qa-ui` |
| `.env` values changed | `docker compose up -d` (re-reads env) |

---

## 13. Database Migrations

All schema changes must go through Prisma migrations — **never alter the database directly**.

### Workflow (from local)

1. Edit `packages/api/prisma/schema.prisma`
2. Generate migration:
   ```bash
   docker compose exec qa-api npx prisma migrate dev --name add_your_column
   ```
   This creates a new timestamped file under `packages/api/prisma/migrations/`.
3. Commit and push:
   ```bash
   git add packages/api/prisma/
   git commit -m "feat: add column xyz to table abc"
   git push
   ```
4. Apply on the server:
   ```bash
   git pull
   docker compose exec qa-api npx prisma migrate deploy
   ```

### Making a change directly on the server

```bash
nano packages/api/prisma/schema.prisma
docker compose exec qa-api npx prisma migrate dev --name add_column
git add packages/api/prisma/
git commit -m "feat: add column xyz"
git push
```

Local machines pull the migration and it auto-applies on next container start.

> **Never edit the database file directly.** Direct edits cause schema drift and are lost on the next deploy.

---

## 14. Sync Script (DB & Volumes)

`git pull` syncs code only. The PostgreSQL data and uploaded files (scripts, artifacts) live in Docker named volumes and need the `sync.sh` script.

```bash
# Pull latest code + restart affected services (standard update)
./sync.sh

# On Windows (PowerShell)
.\sync.sh
```

`sync.sh` does: `git pull → docker compose up -d --build` for services whose images changed, or `docker compose restart` for source-only changes.

---

## 15. GitHub Personal Access Token

GitHub requires a token (not your account password) for git operations from the server.

1. GitHub → avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**
2. Check the **`repo`** scope. Set an expiry date.
3. Copy the token immediately — GitHub only shows it once.
4. Use it as the **Password** when `git push` prompts for credentials.

To avoid re-entering credentials on every push:

```bash
git config --global credential.helper store
```

After the first authenticated push, git caches the token permanently on disk.

# QA Infinity — Offline / Air-Gapped Deployment

For a new team whose Linux server has **no internet access**. All images are
built and saved on a machine that *does* have internet, then transferred and
loaded on the target server — the target never needs to reach Docker Hub,
npm, apt, PyPI, or any other registry.

## What ships to the new team

| File | Purpose |
|---|---|
| `qa-api.tar`, `qa-runner.tar`, `qa-ui.tar` | The three app images, pre-built |
| `postgres.tar`, `redis.tar` | Base images, pre-pulled — the target never calls Docker Hub |
| `docker-compose.yml` | Stack definition (`extra_hosts` stripped if built with `-StripExtraHosts`) |
| `.env` | Filled-in config, incl. `CORS_ORIGIN`/`APP_URL` patched for their server if built with `-CorsOrigin` (see below) |
| `nginx/nginx.conf` | Frontend proxy config |
| `scripts/backup-db.sh` (optional) | Nightly DB backup cron, if used |

Do **not** carry over this environment's `scripts/` folder — it holds
generated `.robot` files for *this* team's test cases. The new team starts
with an empty one; Docker creates it automatically on first container start.

## Prerequisites on the target server (before you start)

- **Docker Engine + Docker Compose v2** already installed. This is the one
  piece these scripts don't handle — if the server has zero internet, Docker
  itself has to come from an offline installer (`.rpm`/`.deb` bundle) or be
  provisioned by their own IT/imaging process. Confirm with `docker compose
  version` before proceeding.
- 20 GB free disk (images + Postgres data + artifacts), 8 GB RAM minimum.
- A way to get files onto the box: SCP over a reachable network path (VPN,
  jump box, same LAN), or physically via USB/removable media if there's
  truly no network path at all. Either way, the files are the same five
  tarballs + config — only the transfer mechanism changes.

## Step 1 — Build and package (on a machine with internet)

If you have **SSH/SCP access** to their server, use **release mode** — it
builds, transfers, and starts everything in one shot:

```powershell
.\deploy.ps1 -Mode release -SSH <new-team-ssh-alias> -RemoteDir /opt/qa-infinity `
             -CorsOrigin http://<their-server-ip>:3100 `
             -StripExtraHosts
```

If there's **no SSH/network path** to their server at all — a new client,
different network, no VPN — use **package mode** instead. It does the exact
same build+save, but skips SSH entirely and produces a single zip file (image
tarballs + config + a generated `INSTALL.md` guide) that you hand over
however you can — email, USB, file share:

```powershell
.\deploy.ps1 -Mode package -CorsOrigin http://<their-server-ip>:3100 `
             -StripExtraHosts -OutZip C:\handoff\qa-infinity.zip
```

- `-StripExtraHosts` removes this deployment's internal-network `extra_hosts`
  entries — they're specific to the current target application and would be
  meaningless (and unnecessarily revealing) on the new team's network.
- `-OutZip` is optional; defaults to `.\qa-infinity-offline-<timestamp>.zip`
  in the repo root.
- The zip's `.env` carries real secrets from this deployment (DB password,
  JWT secret) — share it over a secure channel, and tell the receiving team
  to rotate those values for their own instance rather than reuse them.

This step requires internet **on your machine**, not theirs. Release mode:
1. `docker compose build qa-api qa-runner qa-ui`
2. `docker pull postgres:16-alpine redis:7-alpine`
3. `docker save` all five images to `.tar` files
4. Patches `CORS_ORIGIN`/`APP_URL` into a copy of `.env` (and strips `extra_hosts` from `docker-compose.yml` if requested)
5. Transfers everything via SCP
6. `docker load`s all five images on the remote
7. `docker compose up -d` (no build — everything's already loaded)

Package mode does steps 1–4 the same way, then zips the result with an
`INSTALL.md` walking the receiving team through steps 5–7 by hand (no SSH
involved on either end).

## Step 2 — Fill in `.env` for the new team

Copy `.env.example` to `.env` and set, at minimum:

- `POSTGRES_PASSWORD` — any strong password
- `JWT_SECRET` — 2–3 concatenated random UUIDs
- `APP_MODE` — see below
- `ALLOWED_DOMAINS` — the new team's email domain (or blank to allow any)
- `CORS_ORIGIN` / `APP_URL` — `http://<their-server-ip>:3100`

### `APP_MODE`: full vs. runner

- **`APP_MODE=runner`** — recommended if the server truly has no reachable
  LLM endpoint. Disables the AI-dependent routes (Test Writer, Chat Agent,
  Healing Agent, UI Scanner) so nothing ever tries to phone out. Test Case
  Library, Script execution, Scheduler, and Reports all work fully offline
  regardless of this setting — nothing in the execution path calls out to
  the internet at runtime (Chromium, Playwright browsers, and Robot
  Framework are all baked into the image at build time).
- **`APP_MODE=full`** — only if the new team has *some* reachable LLM
  endpoint from their network: OpenRouter/Anthropic (needs outbound internet
  after all, defeating the point), or an internally-hosted LLM proxy on
  their own network (`LLM_PROVIDER=local` + `LOCAL_LLM_BASE_URL=...`).

Leave `JIRA_*` and `SMTP_*` blank unless the new team actually has those
services reachable — both are optional and only used by specific features
(Jira import, emailed reports).

## Step 3 — Verify

```bash
cd /opt/qa-infinity
docker compose ps                                   # all 5 containers healthy
curl -sf http://localhost:4100/health && echo OK     # API health check
```

Then open `http://<their-server-ip>:3100` — register the first account (it
auto-gets Super Admin), create a project, and confirm a test run executes
end-to-end.

## Manual fallback (only if you can't run deploy.ps1 at all)

Prefer `.\deploy.ps1 -Mode package` (see Step 1 above) — it does all of this
for you and adds the INSTALL.md guide. Fall back to doing it by hand only if
PowerShell/deploy.ps1 itself isn't usable on your machine:

```powershell
docker compose build qa-api qa-runner qa-ui
docker pull postgres:16-alpine
docker pull redis:7-alpine

docker save qa-infinity-qa-api:latest    -o qa-api.tar
docker save qa-infinity-qa-runner:latest -o qa-runner.tar
docker save qa-infinity-qa-ui:latest     -o qa-ui.tar
docker save postgres:16-alpine           -o postgres.tar
docker save redis:7-alpine               -o redis.tar
```

Copy those five `.tar` files, `docker-compose.yml` (`extra_hosts` edited by
hand the same way `-StripExtraHosts` would), `.env` (with `CORS_ORIGIN`/
`APP_URL` edited by hand the same way `-CorsOrigin` would), and
`nginx/nginx.conf` onto the media. On the target server:

```bash
mkdir -p /opt/qa-infinity && cd /opt/qa-infinity
# copy all the files above into this directory, then:
docker load -i qa-api.tar
docker load -i qa-runner.tar
docker load -i qa-ui.tar
docker load -i postgres.tar
docker load -i redis.tar

docker compose up -d
docker compose ps
```

## Do NOT use `release-deploy.sh` for this

That script (and the `release-push.ps1` it references) is **stale** — it
operates on a `qa-infinity.db` SQLite file from before this app migrated to
Postgres. The current schema is Postgres-only (`schema.prisma` →
`provider = "postgresql"`), and `release-push.ps1` no longer exists in this
repo. Use `deploy.ps1 -Mode release` as described above instead.

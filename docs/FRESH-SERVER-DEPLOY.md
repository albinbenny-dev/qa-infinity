# QA Infinity — Fresh Server Deployment Guide

For standing up QA Infinity on a brand-new server that **has internet access**
(if it doesn't, use [OFFLINE-DEPLOYMENT.md](OFFLINE-DEPLOYMENT.md) instead —
that path builds images elsewhere and ships tarballs over).

This walks through everything hit while deploying to a fresh
CentOS Stream 9 / RHEL-family box, including the gotchas that aren't obvious
until you hit them.

## 0. Figure out what you're actually working with

Don't trust the hostname or what you were told the OS is — check directly:

```bash
cat /etc/os-release          # e.g. showed "CentOS Stream 9" on a box named like a RHEL prod server
whoami
sudo firewall-cmd --state    # running / not running
getenforce                   # Enforcing / Permissive / Disabled
df -h                        # partition layout — see step 2, this matters a lot
```

If `firewalld` isn't running and SELinux is `Disabled`, that's two whole
categories of setup work (port rules, SELinux relabeling of bind mounts) you
get to skip. Don't add them speculatively — verify first.

## 1. Install Docker Engine + Compose v2

```bash
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

If this fails with conflicts against `podman`/`runc`/`containerd` (RHEL/CentOS
ship Podman by default, and `podman-docker` collides with `docker-ce`), rerun
with `--allowerasing`. On CentOS Stream 9 this installed clean with no
conflict.

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker <your-user>
newgrp docker            # or log out/in
docker compose version   # confirm v2
```

`sudo dnf install` will print `Unable to read consumer identity` / "not
registered with an entitlement server" — that's just RHEL's subscription-manager
nagging because the box isn't registered with Red Hat. Harmless on CentOS
Stream, ignore it.

## 2. Check disk layout BEFORE building anything

**This is the step that will bite you if skipped.** Servers are often
provisioned with a small OS disk (`/`, `/var`, etc. a few GB each) and a large
separate data volume (`/data`, `/opt`, whatever). Docker and containerd both
default to storing everything under `/var/lib/...`, which on a server like
that fills up mid-build with a cryptic error, not an obvious "disk full"
message:

```
failed to compute cache key: symlink ... /var/lib/containerd/...: no space left on device
```

Check first:

```bash
df -h
```

If `/var` is small (e.g. 5 GB) and something else (e.g. `/data`) has real
space, redirect **both** Docker's data-root and containerd's root/state
*before* running any build — not after it fails once, because both daemons
need a full stop/reconfigure/restart cycle, which is disruptive once
containers are running.

### 2a. Redirect Docker's data-root

```bash
sudo systemctl stop docker

sudo mkdir -p /data/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "data-root": "/data/docker"
}
EOF

sudo rm -rf /var/lib/docker/*   # safe pre-first-build; it's only cache at this point
sudo systemctl start docker
docker info | grep "Docker Root Dir"   # should show /data/docker
```

### 2b. Redirect containerd's root/state — separately, it's a different daemon

`docker-ce` on RHEL/CentOS installs `containerd.io` as its **own systemd
service** with its **own** config, independent of Docker's `daemon.json`.
Fixing Docker's data-root alone is not enough — the build will still fail on
`/var/lib/containerd` because containerd doesn't read Docker's config:

```bash
sudo systemctl stop docker containerd

sudo mkdir -p /data/containerd /data/containerd-state
sudo containerd config default | sudo tee /etc/containerd/config.toml > /dev/null
sudo sed -i 's|^root = .*|root = "/data/containerd"|' /etc/containerd/config.toml
sudo sed -i 's|^state = .*|state = "/data/containerd-state"|' /etc/containerd/config.toml

sudo rm -rf /var/lib/containerd/*
sudo systemctl start containerd docker

grep -E '^root|^state' /etc/containerd/config.toml   # confirm the paths took
df -h /var /data                                       # confirm /var is no longer filling up
```

Do steps 2a and 2b together, in that order, before the first build attempt.

## 3. SELinux / firewalld — only if step 0 showed them active

Skip this whole section if `getenforce` said `Disabled` and `firewall-cmd
--state` said `not running`.

**If SELinux is `Enforcing`:** [docker-compose.yml](docker-compose.yml)
bind-mounts host paths (`./scripts:/scripts`, `./nginx/nginx.conf:...`)
that need container-accessible labels or the containers get silent
permission-denied errors:

```bash
sudo dnf install -y policycoreutils-python-utils   # provides semanage, if missing
sudo semanage fcontext -a -t container_file_t "/data/qa-infinity/scripts(/.*)?"
sudo semanage fcontext -a -t container_file_t "/data/qa-infinity/nginx(/.*)?"
sudo restorecon -Rv /data/qa-infinity/scripts /data/qa-infinity/nginx
```

**If `firewalld` is running:** open the app ports —

```bash
sudo firewall-cmd --permanent --add-port=3100/tcp   # UI
sudo firewall-cmd --permanent --add-port=4100/tcp   # API
sudo firewall-cmd --permanent --add-port=6180/tcp   # noVNC live runner view
sudo firewall-cmd --reload
```

Skip `5655` (Prisma Studio) — dev-only, don't expose it.

Even with the local firewall off/disabled, there may still be a
network-level firewall or security group in front of the box that needs
these same three ports opened separately — that's outside anything you can
check from the server itself.

## 4. Get the code onto the server

```bash
sudo dnf install -y git   # not installed by default on a minimal image
```

Check target directory ownership before cloning into it — a data volume is
often root-owned even when your user has sudo:

```bash
ls -ld /data
```

If it's `root:root` with no group/other write bit, `git clone` into it fails
with `Permission denied` creating the work tree. Fix by owning the specific
subdirectory (don't chown the whole `/data` mount — other things may live
there):

```bash
sudo mkdir -p /data/qa-infinity
sudo chown -R <your-user>:<your-user> /data/qa-infinity
git clone https://github.com/albinbenny-dev/qa-infinity.git /data/qa-infinity
cd /data/qa-infinity
```

## 5. Configure `.env`

Two options:

**A. Fresh values** — copy the template and fill in the ★ required fields
(`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANTHROPIC_API_KEY` or another
`LLM_PROVIDER`, `CORS_ORIGIN`/`APP_URL`, `ALLOWED_DOMAINS`). See
`.env.example` for the full list and inline comments.

**B. Reuse an existing prod `.env`** — valid since this is a fresh empty
database; DB password, JWT secret, LLM/JIRA/SMTP config all carry over fine.
Transfer it directly server-to-server (it holds live secrets — don't paste
it through chat/tickets):

```bash
scp <old-server-user>@<old-server-host>:/path/to/.env /data/qa-infinity/.env
```

Either way, **two fields must be updated to match the new server**, or
you'll get CORS errors and broken report/email links pointing at the old box:

```bash
ip -4 addr show scope global | grep inet   # get this server's IP
vi /data/qa-infinity/.env
```
```
CORS_ORIGIN=http://<new-server-ip>:3100
APP_URL=http://<new-server-ip>:3100
```

Also check [docker-compose.yml](docker-compose.yml) — `qa-api`/`qa-runner`
have an `extra_hosts` entry hardcoding an internal hostname to an IP. Only
matters if this server needs to reach that host for test execution against
an internal target app; harmless otherwise, no need to touch it unless you
see DNS/connection errors to that specific hostname.

## 6. Build and start

```bash
chmod +x start.sh
./start.sh --build
```

First build takes ~3-5 minutes (Node, Python, pnpm deps, Chromium/Playwright
browsers for the runner, x11vnc/novnc for live viewing). If this fails with
`no space left on device`, you skipped step 2 — go back and do it before
retrying; a partial build's cache doesn't carry over cleanly between data
roots.

## 7. Verify

```bash
docker compose ps                                   # all 5 containers healthy
curl -sf http://localhost:4100/health && echo OK
```

Then open `http://<server-ip>:3100`, register the first account (auto-gets
Super Admin), create a project, and confirm a test run executes end-to-end
(watch it live via noVNC at `http://<server-ip>:6180`).

## Quick reference — the two things that actually went wrong here

1. **`/var` was a small partition; Docker and containerd both default there.**
   Fix both `daemon.json` (`data-root`) *and* `/etc/containerd/config.toml`
   (`root`/`state`) — they're separate daemons with separate config, fixing
   one is not enough.
2. **`/data` was root-owned; `git clone` into it failed silently-ish with
   `Permission denied`.** `chown` the specific subdirectory, not the whole
   mount.

##############################################################################
# Stage 1 — base
#
# Heavy runtime environment: OS packages, Chrome for Testing, RF + Playwright
# venv, and the runner user. This stage changes only when you upgrade browser
# versions, RF libraries, or the OS base. Build and tag it separately:
#
#   docker build --target base \
#     -t qa-runner-base:1.0.0 \
#     -f packages/runner/Dockerfile .
#
# Then save it once for the air-gapped team:
#   docker save qa-runner-base:1.0.0 | gzip > qa-runner-base-1.0.0.tar.gz
#
##############################################################################
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS base

# Install all system packages in one apt step so we only run apt-get update
# once and can purge the lists at the end. The playwright base already ships
# Node.js 24, so no nodesource re-install — saves ~574 MB vs the old approach.
# Chrome for Testing v131 is pinned to avoid CDP breakage from Chrome 147+
# (Runtime.evaluate removed). Chrome + ChromeDriver come from the same CfT
# build so version compatibility is guaranteed.
ARG CHROME_VERSION=131.0.6778.85
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y \
       tzdata python3 python3-pip python3-venv \
       x11vnc novnc python3-websockify \
       openbox x11-apps unzip \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@9.15.9 --activate \
  && curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
       -o /tmp/chrome.zip \
  && curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chromedriver-linux64.zip" \
       -o /tmp/chromedriver.zip \
  && unzip -q /tmp/chrome.zip -d /opt/ \
  && unzip -q /tmp/chromedriver.zip -d /opt/ \
  && rm -f /tmp/chrome.zip /tmp/chromedriver.zip \
  && ln -sf /opt/chrome-linux64/chrome /usr/bin/google-chrome \
  && ln -sf /opt/chrome-linux64/chrome /usr/bin/google-chrome-stable \
  && ln -sf /opt/chromedriver-linux64/chromedriver /usr/bin/chromedriver

# Wrap the real CfT binary to inject --no-sandbox and --disable-dev-shm-usage.
# Required both when running as root and in restricted Pod Security contexts
# that drop user-namespace capabilities.
RUN real=/opt/chrome-linux64/chrome \
  && mv "$real" "${real}-orig" \
  && printf '#!/bin/sh\nexec "%s-orig" --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"\n' "$real" > "$real" \
  && chmod +x "$real"

# Disable Selenium Manager so it cannot override the pinned ChromeDriver.
ENV SE_MANAGER_ENABLED=false

# Set BEFORE the venv setup. rfbrowser init looks at PLAYWRIGHT_BROWSERS_PATH
# to find existing browser binaries; the playwright base image already placed
# them here with chmod 777. Also ensures pnpm-installed @playwright/test uses
# the same directory. Previously this was set AFTER rfbrowser init, causing
# init to download a second ~1.4 GB copy to ~/.cache/ms-playwright.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Install Robot Framework + RF Browser into an isolated venv.
# Pin playwright==1.60.0 first (matches the base image's Node.js Playwright
# version) so rfbrowser init finds the correct browser revision at
# /ms-playwright and skips the download.
RUN python3 -m venv /opt/rfbrowser \
  && /opt/rfbrowser/bin/pip install --upgrade pip \
  && /opt/rfbrowser/bin/pip install "playwright==1.60.0" \
  && /opt/rfbrowser/bin/pip install \
       robotframework robotframework-browser \
       pandas openpyxl \
       robotframework-sshlibrary paramiko \
       urllib3 robotframework-requests robotframework-seleniumlibrary \
       robotframework-databaselibrary oracledb \
       pymysql robotframework-jsonlibrary PyPDF2 tabulate \
       robotframework-csvlibrary mss

# Initialise RF Browser. With playwright==1.60.0 and PLAYWRIGHT_BROWSERS_PATH
# already set, this should register the pre-installed browsers and skip the
# download entirely.
RUN /opt/rfbrowser/bin/python -m Browser.entry init || true

ENV PATH="/opt/rfbrowser/bin:${PATH}"

# Create the runner user (uid 1000) and take ownership of writeable dirs.
# NOTE: we do NOT touch /ms-playwright — the base image already set it to
# chmod 777, so adding a chmod here would create a ~789 MB copy-on-write
# layer of the entire browser directory for zero benefit.
RUN getent passwd 1000 | cut -d: -f1 | xargs -r userdel -f \
  && useradd -m -u 1000 -s /bin/bash runner \
  && chown -R runner:runner /opt/rfbrowser /opt/chrome-linux64 /opt/chromedriver-linux64


##############################################################################
# Stage 2 — runner  (the code layer — only this stage rebuilds on code changes)
#
# Inherits the full base stage above; adds only the Node.js runner source.
# On a machine that already built or loaded the base stage, rebuilding after
# a code change takes < 2 minutes and produces ~100 MB of new layers.
#
# For air-gapped delivery use scripts/runner-delta.py to extract only these
# new layers as a small (~100 MB) delta archive instead of the full image.
##############################################################################
FROM base AS runner

WORKDIR /app

# Copy workspace manifests first so pnpm install is cached separately from src
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/runner/package.json ./packages/runner/
RUN pnpm install --frozen-lockfile

# Copy runner HTTP server source
COPY packages/runner/src ./packages/runner/src

# Copy and arm the entrypoint (runs as root, chowns volumes, drops to runner)
COPY packages/runner/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
  && chown -R runner:runner /app

# NOTE: USER is intentionally NOT set here. The entrypoint runs as root so it
# can chown the Docker-managed volumes (/scripts, /artifacts) which are always
# created root-owned at first mount, then drops to `runner` via `exec su runner`.

# Volumes mounted at runtime:
#   /scripts    → compiled .spec.js / .robot files partitioned by projectId
#   /artifacts  → screenshots, traces, videos partitioned by projectId
VOLUME ["/scripts", "/artifacts"]

EXPOSE 5001
EXPOSE 6080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]

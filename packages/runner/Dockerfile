FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# Install Node 20 + Python 3 + pip + VNC tools for live browser viewing
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y \
       nodejs tzdata python3 python3-pip python3-venv \
       x11vnc novnc python3-websockify \
       openbox x11-apps \
  && corepack enable && corepack prepare pnpm@9.15.9 --activate

# Google Chrome + ChromeDriver for SeleniumLibrary-based scripts.
# Pinned to Chrome for Testing v131 to avoid CDP breakage introduced in
# Chrome 147+ (Runtime.evaluate removed) that makes older ChromeDriver crash.
# Both binaries come from the same CfT build so version compatibility is
# guaranteed; Selenium Manager auto-download is disabled so it can't override.
ARG CHROME_VERSION=131.0.6778.85
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y unzip \
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

# Wrap the real CfT binary to inject --no-sandbox (required when Chrome cannot
# use user namespaces — true both when running as root AND when running as a
# non-root UID inside a restricted Pod Security context that drops capabilities).
# --disable-dev-shm-usage routes shared memory to /tmp, which every UID can write.
RUN real=/opt/chrome-linux64/chrome \
  && mv "$real" "${real}-orig" \
  && printf '#!/bin/sh\nexec "%s-orig" --no-sandbox --disable-dev-shm-usage --disable-gpu "$@"\n' "$real" > "$real" \
  && chmod +x "$real"

# Disable Selenium Manager so it won't try to download a different chromedriver
# at runtime and accidentally override the pinned version above.
ENV SE_MANAGER_ENABLED=false

# Install Robot Framework + RF Browser into a venv so it never conflicts with system pip
RUN python3 -m venv /opt/rfbrowser \
  && /opt/rfbrowser/bin/pip install --upgrade pip \
  && /opt/rfbrowser/bin/pip install robotframework robotframework-browser pandas openpyxl \
       robotframework-sshlibrary paramiko \
       urllib3 robotframework-requests robotframework-seleniumlibrary \
       robotframework-databaselibrary oracledb \
       pymysql robotframework-jsonlibrary PyPDF2 tabulate \
       robotframework-csvlibrary

# Initialise RF Browser — downloads Playwright browsers managed by RF Browser
RUN /opt/rfbrowser/bin/python -m Browser.entry init || true

# Make `robot` available on PATH from the venv
ENV PATH="/opt/rfbrowser/bin:${PATH}"

# Point the pnpm-installed @playwright/test at the browsers the base image already has.
# The base image ships a specific chromium revision; if pnpm installs a different patch
# of @playwright/test that expects a different revision, install it explicitly here.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node /app/node_modules/.pnpm/@playwright+test@1.60.0/node_modules/@playwright/test/cli.js install chromium || true

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/runner/package.json ./packages/runner/
RUN pnpm install --frozen-lockfile

# Copy runner HTTP server source
COPY packages/runner/src ./packages/runner/src

# Create a non-root user (uid 1000) and transfer ownership of everything the
# runner writes to at runtime. /ms-playwright is owned by root in the base image
# so we use chmod (world-readable) rather than chown to avoid copying the whole
# layer. /opt contains Chrome, ChromeDriver, and the rfbrowser venv — all ours.
#
# Ubuntu 22.04 (Jammy) base images ship an 'ubuntu' user at UID 1000; the
# mcr.microsoft.com/playwright:*-jammy image inherits it. Remove any existing
# UID 1000 occupant first so useradd -u 1000 runner never collides.
RUN getent passwd 1000 | cut -d: -f1 | xargs -r userdel -f \
  && useradd -m -u 1000 -s /bin/bash runner \
  && chown -R runner:runner /app /opt/rfbrowser /opt/chrome-linux64 /opt/chromedriver-linux64 \
  && chmod -R a+rX /ms-playwright

# Switch to the non-root runner user. Kubernetes pod-security runAsNonRoot
# enforcement will also enforce this at scheduling time.
USER runner

# Volumes mounted at runtime:
#   /scripts    → compiled .spec.js files partitioned by projectId
#   /artifacts  → screenshots, traces, videos partitioned by projectId
VOLUME ["/scripts", "/artifacts"]

EXPOSE 5001
EXPOSE 6080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["node", "--max-old-space-size=512", "packages/runner/src/index.js"]

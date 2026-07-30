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

# Container runs as root; Chrome refuses to start as root without --no-sandbox.
# Wrap the real CfT binary so every Open Browser call gets the flag automatically.
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
       pymysql robotframework-jsonlibrary

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
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy runner HTTP server source
COPY packages/runner/src ./packages/runner/src

# Volumes mounted at runtime:
#   /scripts    → compiled .spec.js files partitioned by projectId
#   /artifacts  → screenshots, traces, videos partitioned by projectId
VOLUME ["/scripts", "/artifacts"]

EXPOSE 5001
EXPOSE 6080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["node", "--max-old-space-size=512", "packages/runner/src/index.js"]

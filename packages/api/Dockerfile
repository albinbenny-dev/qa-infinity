FROM node:20-alpine

# Install pnpm, curl, Chromium, and ffmpeg (required for Playwright video recording)
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && \
    apk add --no-cache curl openssl openssl-dev tzdata \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont ffmpeg

# Tell playwright-core where to find the system Chromium.
# PLAYWRIGHT_BROWSERS_PATH points to a fixed directory (not $HOME/.cache) so the
# image works as any non-root UID without needing a writable home directory.
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-cache

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json ./packages/api/
RUN pnpm install --no-frozen-lockfile

# Symlink system ffmpeg into the path Playwright expects for video recording.
# Uses PLAYWRIGHT_BROWSERS_PATH (/opt/playwright-cache) instead of $HOME/.cache
# so this works for any runtime UID.
RUN node -e "\
  const fs = require('fs'); \
  const raw = fs.readFileSync('packages/api/node_modules/playwright-core/browsers.json', 'utf8'); \
  const entry = JSON.parse(raw).browsers.find(b => b.name === 'ffmpeg'); \
  const rev = entry ? entry.revision : '1011'; \
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH + '/ffmpeg-' + rev; \
  fs.mkdirSync(dir, { recursive: true }); \
  const dest = dir + '/ffmpeg-linux'; \
  if (!fs.existsSync(dest)) fs.symlinkSync('/usr/bin/ffmpeg', dest); \
  console.log('ffmpeg symlinked at', dest); \
"

# Copy Prisma schema and generate client (generated at build time — not at startup)
COPY packages/api/prisma ./packages/api/prisma
RUN cd packages/api && ./node_modules/.bin/prisma generate

# Copy source
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/

# Extension dist — served as a downloadable zip
COPY packages/extension/dist ./packages/extension/dist

# Grant the built-in 'node' user (uid 1000) ownership of all runtime directories.
# /opt/playwright-cache holds the ffmpeg symlink created above.
RUN chown -R node:node /app /opt/playwright-cache

# Switch to non-root user. The 'node' user (uid 1000) is provided by node:alpine.
USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start via tsx directly — no pnpm invocation at runtime, no corepack network calls.
# HOME=/tmp ensures any npm/corepack/prisma cache writes land in a writable path
# for a non-root UID. prisma db push applies schema migrations before the server starts.
CMD ["sh", "-c", "HOME=/tmp /app/packages/api/node_modules/.bin/prisma db push --accept-data-loss && exec /app/packages/api/node_modules/.bin/tsx /app/packages/api/src/index.ts"]

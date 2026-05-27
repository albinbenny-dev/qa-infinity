FROM node:20-alpine

# Install pnpm, curl, and Chromium for UI screenshot capture
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && \
    apk add --no-cache curl openssl openssl-dev tzdata \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Tell playwright-core where to find the system Chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json ./packages/api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy Prisma schema and generate client
# Use the local prisma binary (v5.22.0) — NOT npx which may pull a different version from cache
COPY packages/api/prisma ./packages/api/prisma
RUN cd packages/api && ./node_modules/.bin/prisma generate

# Copy source
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD sh -c "cd packages/api && ./node_modules/.bin/prisma migrate deploy && cd /app && pnpm --filter @qa-infinity/api dev"

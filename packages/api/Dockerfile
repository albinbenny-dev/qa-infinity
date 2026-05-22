FROM node:20-alpine

# Install pnpm and curl (curl needed for HEALTHCHECK)
RUN npm install -g pnpm && apk add --no-cache curl openssl openssl-dev

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json ./packages/api/
RUN pnpm install --frozen-lockfile

# Copy Prisma schema (generation requires DATABASE_URL set at runtime)
COPY packages/api/prisma ./packages/api/prisma

# Copy source
COPY packages/api/src ./packages/api/src
COPY packages/api/tsconfig.json ./packages/api/

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["pnpm", "--filter", "@qa-infinity/api", "dev"]

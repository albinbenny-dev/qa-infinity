FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Install Node 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get install -y nodejs \
  && npm install -g pnpm

WORKDIR /app

# Copy workspace files for dependency resolution
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/runner/package.json ./packages/runner/
RUN pnpm install --frozen-lockfile

# Copy runner HTTP server source
COPY packages/runner/src ./packages/runner/src

# Volumes mounted at runtime:
#   /scripts    → compiled .spec.js files partitioned by projectId
#   /artifacts  → screenshots, traces, videos partitioned by projectId
VOLUME ["/scripts", "/artifacts"]

EXPOSE 5001

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["node", "packages/runner/src/index.js"]

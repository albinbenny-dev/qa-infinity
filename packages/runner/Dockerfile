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

# Volumes mounted at runtime:
#   /scripts    → compiled .spec.ts files partitioned by projectId
#   /artifacts  → screenshots, traces, videos partitioned by projectId
#
# This container has no CMD — the qa-api triggers runs via:
#   docker exec qa-runner pnpm playwright test /scripts/{projectId}/{script}.spec.ts
VOLUME ["/scripts", "/artifacts"]

# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy manifests only so source changes don't bust the install layer
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/api/package.json ./packages/api/
COPY packages/runner/package.json ./packages/runner/
RUN pnpm install --frozen-lockfile --shamefully-hoist

COPY packages/frontend ./packages/frontend
WORKDIR /app/packages/frontend
RUN NODE_OPTIONS="--max-old-space-size=4096" /app/node_modules/.bin/vite build
WORKDIR /app

# ── Stage 2: Serve ─────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# The COPY above can carry over restrictive permission bits from the build
# host's checkout (e.g. some public/ files ending up owner/group-readable
# only) — nginx's worker runs as a low-privileged user, so a non-world-
# readable file 403s even though it exists. Normalize to world-readable.
RUN chmod -R a+rX /usr/share/nginx/html

# Replace the default (root-requiring) nginx main config with an unprivileged
# one that writes pid and temp files to /tmp. This lets the container run as
# any non-root UID without needing to bind port 80 or touch root-owned paths.
# The server-block config (listen 8080, proxy rules) is still mounted at runtime
# via docker-compose: nginx/nginx.conf → /etc/nginx/conf.d/default.conf
COPY packages/frontend/nginx-main.conf /etc/nginx/nginx.conf

# Listen on 8080 (unprivileged port) — matches nginx/nginx.conf server block
EXPOSE 8080

# Run as nobody (uid 65534) — satisfies runAsNonRoot Pod Security constraints
USER nobody

CMD ["nginx", "-g", "daemon off;"]

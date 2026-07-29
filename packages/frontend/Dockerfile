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

# Nginx config is mounted via docker-compose (nginx/nginx.conf → /etc/nginx/conf.d/default.conf)

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

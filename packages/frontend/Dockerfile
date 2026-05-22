# ── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile

RUN pnpm --filter @qa-infinity/frontend build

# ── Stage 2: Serve ─────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

# Nginx config is mounted via docker-compose (nginx/nginx.conf → /etc/nginx/conf.d/default.conf)

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

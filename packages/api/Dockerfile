FROM node:20-alpine

# Install pnpm and curl (curl needed for HEALTHCHECK)
RUN npm install -g pnpm && apk add --no-cache curl

WORKDIR /app

# Copy package manifest and install dependencies first (layer cache)
COPY package.json ./
RUN pnpm install --frozen-lockfile

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN pnpm db:generate

# Copy source
COPY src ./src
COPY tsconfig.json ./

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["tsx", "src/index.ts"]

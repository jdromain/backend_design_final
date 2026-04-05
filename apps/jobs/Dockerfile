# Build context: repo root (docker-compose.yml sets context: .)
# Build: docker compose build jobs

# ─── Stage 1: install + build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./

COPY packages/core-types/package.json   packages/core-types/
COPY packages/event-bus/package.json    packages/event-bus/
COPY packages/logging/package.json      packages/logging/
COPY packages/utils/package.json        packages/utils/
COPY packages/vector-store/package.json packages/vector-store/
COPY apps/jobs/package.json             apps/jobs/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/jobs/ apps/jobs/

RUN mkdir -p packages/event-bus/node_modules/@rezovo && \
    ln -sfn ../../../core-types packages/event-bus/node_modules/@rezovo/core-types && \
    mkdir -p apps/jobs/node_modules/@rezovo && \
    ln -sfn ../../../../packages/core-types apps/jobs/node_modules/@rezovo/core-types

RUN pnpm --filter "@rezovo/jobs..." run build

# ─── Stage 2: production image ───────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

COPY packages/core-types/package.json   packages/core-types/
COPY packages/event-bus/package.json    packages/event-bus/
COPY packages/logging/package.json      packages/logging/
COPY packages/utils/package.json        packages/utils/
COPY packages/vector-store/package.json packages/vector-store/
COPY apps/jobs/package.json             apps/jobs/

COPY --from=builder /app/packages/core-types/dist   packages/core-types/dist
COPY --from=builder /app/packages/event-bus/dist    packages/event-bus/dist
COPY --from=builder /app/packages/logging/dist      packages/logging/dist
COPY --from=builder /app/packages/utils/dist        packages/utils/dist
COPY --from=builder /app/packages/vector-store/dist packages/vector-store/dist
COPY --from=builder /app/apps/jobs/dist             apps/jobs/dist

RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production

# jobs is a background worker — no HTTP server, no health check, no exposed ports.
# Monitor with: docker compose logs jobs

CMD ["node", "apps/jobs/dist/index.js"]

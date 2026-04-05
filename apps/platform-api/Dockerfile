# Build context: repo root (docker-compose.yml sets context: .)
# Build: docker compose build platform-api

# ─── Stage 1: install + build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy lockfile and workspace manifests first so dependency install is cached
# independently of source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json .npmrc ./

# Copy every package manifest so pnpm can resolve the workspace graph.
COPY packages/core-types/package.json   packages/core-types/
COPY packages/event-bus/package.json    packages/event-bus/
COPY packages/logging/package.json      packages/logging/
COPY packages/utils/package.json        packages/utils/
COPY packages/vector-store/package.json packages/vector-store/
COPY apps/platform-api/package.json     apps/platform-api/

RUN pnpm install --frozen-lockfile

# Copy full source for packages and the app.
COPY packages/ packages/
COPY apps/platform-api/ apps/platform-api/

# pnpm workspace links under package-local node_modules can be wrong in partial Docker graphs;
# TypeScript resolves the nearest node_modules and stops. Pin valid links for each importer.
RUN mkdir -p packages/event-bus/node_modules/@rezovo && \
    ln -sfn ../../../core-types packages/event-bus/node_modules/@rezovo/core-types && \
    mkdir -p apps/platform-api/node_modules/@rezovo && \
    ln -sfn ../../../../packages/core-types apps/platform-api/node_modules/@rezovo/core-types

# Topological build: platform-api and all workspace dependencies.
RUN pnpm --filter "@rezovo/platform-api..." run build

# ─── Stage 2: production image ───────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# Copy workspace descriptor files so pnpm can wire up the monorepo in prod.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# Copy package manifests (required for prod install).
COPY packages/core-types/package.json   packages/core-types/
COPY packages/event-bus/package.json    packages/event-bus/
COPY packages/logging/package.json      packages/logging/
COPY packages/utils/package.json        packages/utils/
COPY packages/vector-store/package.json packages/vector-store/
COPY apps/platform-api/package.json     apps/platform-api/

# Copy compiled output from builder.
COPY --from=builder /app/packages/core-types/dist   packages/core-types/dist
COPY --from=builder /app/packages/event-bus/dist    packages/event-bus/dist
COPY --from=builder /app/packages/logging/dist      packages/logging/dist
COPY --from=builder /app/packages/utils/dist        packages/utils/dist
COPY --from=builder /app/packages/vector-store/dist packages/vector-store/dist
COPY --from=builder /app/apps/platform-api/dist     apps/platform-api/dist

# Install production dependencies only.
RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "apps/platform-api/dist/index.js"]

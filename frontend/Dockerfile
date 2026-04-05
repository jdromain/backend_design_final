# Build context: repo root (docker-compose.yml sets context: .)
# Build: docker compose build frontend
#
# NEXT_PUBLIC_* vars are baked into the JS bundle at build time.
# Pass them via build.args in docker-compose.yml — they are not runtime env vars.

# ─── Stage 1: install dependencies ───────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# frontend has no workspace:* deps on internal @rezovo/* packages,
# so we only need the root workspace descriptor and the frontend manifest.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY frontend/package.json frontend/

RUN pnpm install --frozen-lockfile --filter frontend

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY --from=deps /app/node_modules       ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

COPY frontend/ frontend/
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./

# NEXT_PUBLIC_* values are baked into the compiled JS at build time.
# Default to localhost:3001 which works for local Compose with published ports.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_DEFAULT_TENANT_ID=tenant-default
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
ARG NEXT_PUBLIC_ENABLE_DEV_LOGIN=false
ARG CLERK_ENABLED=false

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DEFAULT_TENANT_ID=$NEXT_PUBLIC_DEFAULT_TENANT_ID
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_ENABLE_DEV_LOGIN=$NEXT_PUBLIC_ENABLE_DEV_LOGIN
ENV CLERK_ENABLED=$CLERK_ENABLED
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter frontend build

# ─── Stage 3: production runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/frontend/public           ./frontend/public
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static     ./frontend/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "frontend/server.js"]

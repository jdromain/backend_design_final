# Multi-stage build for platform-api
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy packages (shared libraries)
COPY packages/ ./packages/

# Copy platform-api source
COPY apps/platform-api/ ./apps/platform-api/

# Install dependencies (including devDependencies for build)
RUN npm ci --workspace=apps/platform-api --workspace=packages

# Build the application and packages
RUN npm run build --workspace=packages --if-present
RUN npm run build --workspace=apps/platform-api

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy built artifacts from builder
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/platform-api/dist ./apps/platform-api/dist
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Run the application
CMD ["node", "apps/platform-api/dist/index.js"]





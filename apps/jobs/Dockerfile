# Multi-stage build for jobs worker
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Copy packages (shared libraries)
COPY packages/ ./packages/

# Copy jobs source
COPY apps/jobs/ ./apps/jobs/

# Install dependencies
RUN npm ci --workspace=apps/jobs --workspace=packages

# Build the application
RUN npm run build --workspace=packages --if-present
RUN npm run build --workspace=apps/jobs

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy built artifacts from builder
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/jobs/dist ./apps/jobs/dist
COPY --from=builder /app/node_modules ./node_modules

# Set environment
ENV NODE_ENV=production

# Run the application
CMD ["node", "apps/jobs/dist/index.js"]





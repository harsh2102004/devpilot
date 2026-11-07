# DevPilot Backend Server & Worker Dockerfile (Sub-Phase 10A)
# Multi-stage production container with Git CLI & non-root user execution

FROM node:20-alpine AS base

# Install system dependencies: Git (for repo cloner) and curl (for healthchecks)
RUN apk add --no-cache git curl docker-cli bash

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Create required runtime directories and set ownership to unprivileged 'node' user (Task 8)
RUN mkdir -p /app/uploads/avatars /app/public/temp \
    && chown -R node:node /app

# Switch to unprivileged non-root user (uid 1000)
USER node

# Set production environment defaults
ENV NODE_ENV=production
ENV PORT=5000

# Expose API port
EXPOSE 5000

# Healthcheck validating server HTTP response
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=15s \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Default command: API server
CMD ["npm", "start"]


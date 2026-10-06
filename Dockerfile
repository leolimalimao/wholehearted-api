# ==========================================
# 1. Builder Stage
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including dev for building NestJS)
RUN npm ci

# Copy source code and build config
COPY tsconfig*.json nest-cli.json ./
COPY src/ ./src/

# Compile TypeScript
RUN npm run build

# Prune devDependencies to keep only production modules
RUN npm prune --omit=dev

# ==========================================
# 2. Production Runner with Embedded Redis
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

# Install redis and supervisor
RUN apk add --no-cache redis supervisor

# Copy build artifacts and production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copy supervisor config and entrypoint
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV REDIS_URL=redis://127.0.0.1:6380

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]

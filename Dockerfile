# syntax=docker/dockerfile:1

##############################################
# Stage 1 — build the Mastra server + Studio #
##############################################
FROM node:22-slim AS builder

WORKDIR /app

# Native deps needed by some Mastra/AI SDK transitive packages during install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first so this layer caches across source-only changes.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY tsconfig.json ./
COPY src ./src

ENV MASTRA_TELEMETRY_DISABLED=1
ENV MASTRA_SKIP_PEERDEP_CHECK=1
# Bundling is memory-hungry; raise this if the Coolify build OOMs.
ENV NODE_OPTIONS=--max-old-space-size=4096

# Produces .mastra/output (server + its own node_modules) and
# .mastra/output/studio (the Studio SPA assets).
RUN npx mastra build --studio


#############################
# Stage 2 — runtime image   #
#############################
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# .mastra/output ships with its own production node_modules — no second install.
COPY --from=builder /app/.mastra/output ./.mastra/output

# SQLite lives here. Mount a Coolify persistent volume at /app/data or the
# database is wiped on every redeploy.
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV PORT=4111
ENV MASTRA_HOST=0.0.0.0
ENV MASTRA_STUDIO_PATH=/app/.mastra/output/studio
ENV MASTRA_DB_URL=file:/app/data/mastra.db
ENV MASTRA_TELEMETRY_DISABLED=1

EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4111/health || exit 1

CMD ["node", ".mastra/output/index.mjs"]

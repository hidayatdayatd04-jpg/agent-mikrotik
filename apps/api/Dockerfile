# Backend API — Bun, dependencies pinned by bun.lock, non-root user.
# Build context: repository root. Build:
#   docker build -f apps/api/Dockerfile -t mikrotik-agent-api .
FROM oven/bun:1.4.1-slim AS base
WORKDIR /app

# 1. Install with lockfile only (layer-cached, no dev churn)
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/mikrotik-tools/package.json packages/mikrotik-tools/
RUN bun install --frozen-lockfile --production

# 2. Application source (pinned MCP versions come from bun.lock)
COPY packages/shared packages/shared
COPY packages/mikrotik-tools packages/mikrotik-tools
COPY apps/api apps/api
COPY drizzle drizzle
# Rosetta documentation corpus (sqlite). For large corpora mount a volume
# over /app/tooling/corpus instead of baking it into the image.
COPY tooling/corpus tooling/corpus

# 3. Non-root runtime user (Debian-based image: useradd/groupadd)
RUN groupadd --system app && useradd --system --gid app app \
  && chown -R app:app /app
USER app

ENV NODE_ENV=production
# Default paths inside the container (corpus baked at build or volume-mounted)
ENV ROSETTA_DATA_DIR=/app/tooling/corpus
EXPOSE 3001

# health: liveness (process up) + readiness (database reachable)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3001/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Bun's default server fetch; graceful shutdown handled via SIGTERM (index.ts).
CMD ["bun", "run", "apps/api/src/index.ts"]

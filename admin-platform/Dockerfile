# Build context is the repository root (Railway: root directory "/", Dockerfile path admin-platform/Dockerfile),
# because the cash report reuses the app's read-only POS model from pos/ instead of a second money calculation.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json platform-core.js qr-resolver.js spaceverse-runtime-manifest.js spaceverse-runtime-manifest.d.ts customer-wallet-repository.d.ts customer-directory-repository.d.ts ./
COPY *.js package-lock.json spaceverse-runtime-release.d.ts spaceverse-runtime-image.d.ts ./
COPY scripts/spaceverse-runtime-container-entrypoint.mjs ./scripts/
COPY pos ./pos
# Synthetic Admin integration tests exercise the real native proxy handler.
COPY routes ./routes
# The cash report test builds the POS tables from the app's own migrations.
COPY migrations ./migrations

WORKDIR /app/admin-platform
COPY admin-platform/package.json admin-platform/package-lock.json ./
RUN npm ci

COPY admin-platform/ ./

# Keep build-time tests within small builder CPU quotas; not a runtime setting.
ARG VITEST_MAX_WORKERS=1
RUN npm run typecheck \
  && npm run lint \
  && npm test -- --maxWorkers="${VITEST_MAX_WORKERS}" \
  && npm run test:security -- --maxWorkers="${VITEST_MAX_WORKERS}" \
  && npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]

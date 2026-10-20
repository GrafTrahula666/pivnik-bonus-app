# syntax=docker/dockerfile:1
# Local build recipe only. No service deployment or database migration.
FROM node:22-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562
WORKDIR /app
COPY package.json package-lock.json ./
# The caller supplies a public package cache as a separate build context.
# Reinstall from the lockfile offline; cache and logs live only in tmpfs.
RUN --network=none \
    --mount=type=bind,from=npm-cache,source=.,target=/opt/npm-cache,ro \
    --mount=type=tmpfs,target=/tmp/npm-cache \
    cp -R /opt/npm-cache/_cacache /tmp/npm-cache/ && \
    npm ci --offline --cache /tmp/npm-cache --omit=dev --ignore-scripts --no-audit --no-fund
COPY . ./
ARG SOURCE_RELEASE_SHA
ARG SOURCE_RELEASE_FINGERPRINT
LABEL org.opencontainers.image.source="https://github.com/GrafTrahula666/pivnik-bonus-app"
LABEL org.opencontainers.image.revision=$SOURCE_RELEASE_SHA
LABEL spaceverse.runtime.contract="tenant-runtime-v1"
LABEL spaceverse.runtime.code-fingerprint=$SOURCE_RELEASE_FINGERPRINT
ENV NODE_ENV=production
ENV SPACEVERSE_RUNTIME_MODE=tenant
USER node
EXPOSE 3000
ENTRYPOINT []
CMD ["node","scripts/spaceverse-runtime-container-entrypoint.mjs"]

FROM node:24-bookworm-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app/halloween-live
COPY halloween-live/package.json halloween-live/package-lock.json ./
RUN npm ci --include=dev
COPY halloween-live/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production LIVE_BIND=0.0.0.0 PORT=4317
WORKDIR /app/halloween-live
COPY --from=build /app/halloween-live/ ./
COPY migrations/011_halloween_raffle.sql /app/migrations/011_halloween_raffle.sql
USER node
EXPOSE 4317
CMD ["node", "src/server.js"]

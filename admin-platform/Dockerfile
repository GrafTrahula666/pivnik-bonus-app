# Build context is the repository root (Railway: root directory "/", Dockerfile path admin-platform/Dockerfile),
# because the cash report reuses the app's read-only POS model from pos/ instead of a second money calculation.
FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json platform-core.js qr-resolver.js ./
COPY pos ./pos

WORKDIR /app/admin-platform
COPY admin-platform/package.json admin-platform/package-lock.json ./
RUN npm ci

COPY admin-platform/ ./

RUN npm run typecheck \
  && npm run lint \
  && npm test \
  && npm run test:security \
  && npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]

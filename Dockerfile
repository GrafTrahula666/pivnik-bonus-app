FROM node:22-bookworm-slim

WORKDIR /app

COPY admin-platform/package.json admin-platform/package-lock.json ./
RUN npm ci

COPY admin-platform/ ./

RUN node scripts/patch-operations-role-visibility.mjs \
  && npm run typecheck \
  && npm run lint \
  && npm test \
  && npm run test:security \
  && npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]

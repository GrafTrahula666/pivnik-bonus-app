# Build context is this folder (Railway service root directory: admin-platform).
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

RUN npm run typecheck \
  && npm run lint \
  && npm test \
  && npm run test:security \
  && npm run build

ENV NODE_ENV=production
CMD ["npm", "start"]

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends xz-utils ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /staging-loader
COPY admin-staging/parts/ ./parts/
COPY admin-staging/staging-preflight.mjs ./staging-preflight.mjs

RUN cat ./parts/part* | tr -d '\r\n' | base64 -d > /tmp/admin-source.tar.xz \
  && mkdir -p /tmp/admin-source \
  && tar -xJf /tmp/admin-source.tar.xz -C /tmp/admin-source \
  && mkdir -p /app \
  && if [ -f /tmp/admin-source/admin-platform/package.json ]; then cp -a /tmp/admin-source/admin-platform/. /app/; \
     elif [ -f /tmp/admin-source/package.json ]; then cp -a /tmp/admin-source/. /app/; \
     else echo 'Admin source archive did not contain package.json' >&2; find /tmp/admin-source -maxdepth 3 -type f | head -80; exit 1; fi \
  && cp /staging-loader/staging-preflight.mjs /app/staging-preflight.mjs

WORKDIR /app
RUN npm install --include=dev
RUN npm run typecheck
RUN npm run lint
RUN npm run test
RUN npm run test:security
RUN npm run build

ENV NODE_ENV=production
CMD ["npm","start"]

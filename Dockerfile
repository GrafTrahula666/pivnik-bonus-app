FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]

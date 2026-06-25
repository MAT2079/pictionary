# Poll-worker image (spec §16, Windows compose). Build context: the worker/ dir.
# Outbound-only: it never exposes a port.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
# sharp ships prebuilt binaries for linux/amd64; no native toolchain needed.
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# RENDER_URL, WORKER_SECRET, FORGE_URL supplied at runtime (compose / Discord bot).
CMD ["node", "dist/index.js"]

# Debian rather than Alpine: better-sqlite3 ships a prebuilt linux-x64 binary,
# so the image needs no compiler.
FROM node:22-bookworm-slim

WORKDIR /app
COPY . .

# Full install first, because a Phaser client build needs its dev dependencies.
# --ignore-scripts is required: `npm ci` sees better-sqlite3's binding.gyp and
# tries to compile it, which fails here and is pointless given the prebuilds.
RUN npm ci --ignore-scripts
RUN if [ -f client/package.json ]; then npm run build -w client; fi
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV DB_PATH=/data/wolfjam.db

# Runs node directly, not through npm, so SIGTERM reaches the server on deploys.
CMD ["node", "--import", "tsx", "server/src/index.ts"]

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package.json package-lock.json ./

# curl serves the healthcheck. Playwright fetches Chromium's headless shell plus the system
# libraries and fallback fonts (CJK, emoji) it renders with.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && npm ci --omit=dev \
 && npx playwright install --with-deps --only-shell chromium \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/*

COPY src ./src
COPY public ./public
# Served to signed-in users from /cli/appshots.mjs.
COPY cli ./cli

ENV PORT=3000 \
    DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

# Node 24 runs the TypeScript sources directly; there is no build step.
CMD ["node", "src/server.ts"]

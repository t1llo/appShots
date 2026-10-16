# The web pages are the one part that is built: React, bundled by Vite into web/dist.
FROM node:24-bookworm-slim AS web

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY vite.config.ts ./
# The Studio checks slides with the server's own schemas and picks stand-in screenshots with its code.
COPY src ./src
COPY web ./web
RUN npm run build


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
COPY --from=web /app/web/dist ./web/dist
# Served to signed-in users from /cli/appshots.mjs, and to anybody from /skill.md and /skill/<file>.md.
COPY cli ./cli
COPY skill ./skill
# The pages under /docs, the privacy policy and the terms, as Markdown.
COPY docs ./docs

ENV PORT=3000 \
    DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

# Node 24 runs the server's TypeScript sources directly; only the web pages above are built.
CMD ["node", "src/server.ts"]

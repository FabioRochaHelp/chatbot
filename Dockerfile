FROM node:24-bookworm-slim AS base
# o chromium do Debian traz como dependência todas as libs de sistema
# (libnss3, libgbm, libgtk-3, libx*, libasound2...) que o README lista para o puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    TOKENS_DIR=/usr/src/app/tokens \
    DATA_DIR=/usr/src/app/data \
    NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        fonts-noto-color-emoji \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
EXPOSE 3333
ENTRYPOINT ["/usr/bin/tini", "--"]

# desenvolvimento: código montado via volume (docker-compose, profile dev)
FROM base AS dev
ENV NODE_ENV=development
CMD ["sh", "-c", "npm install && npm run dev"]

# build do painel (React): só o web/dist vai para a imagem final
FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM base AS prod
# o postinstall (prisma generate) precisa do schema e do prisma.config.js
COPY package*.json prisma.config.js ./
COPY prisma ./prisma
COPY server/config.js ./server/config.js
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
COPY --from=web /web/dist ./web/dist
RUN mkdir -p tokens data && chown -R node:node /usr/src/app
USER node
VOLUME ["/usr/src/app/tokens", "/usr/src/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]

FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public
COPY docs ./docs
COPY LICENSE README.md CHANGELOG.md SECURITY.md .env.example ./

RUN mkdir -p /data && chown -R node:node /data
USER node

ENV HOTE=0.0.0.0 \
    PORT=3000 \
    DB_PATH=/data/registris.db \
    PREUVES_DIR=/data/preuves \
    LOGOS_DIR=/data/logos \
    ANCRAGES_DIR=/data/ancrages \
    SAUVEGARDES_DIR=/data/sauvegardes

VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD wget -qO- http://127.0.0.1:3000/sante || exit 1

CMD ["node", "src/cli.js", "servir"]

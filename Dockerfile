FROM node:20-alpine

# Chromium + fonts for Puppeteer PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

RUN addgroup -S executor && adduser -S executor -G executor && \
    addgroup -g 987 dockerhost && \
    adduser executor dockerhost && \
    mkdir -p /tmp/jobs && \
    chown executor:executor /tmp/jobs

USER executor

EXPOSE 3000
EXPOSE 3001

CMD ["node", "dist/index.js"]

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

RUN addgroup -S executor && adduser -S executor -G executor && \
    addgroup -g 987 dockerhost && \
    adduser executor dockerhost && \
    apk add --no-cache su-exec

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]

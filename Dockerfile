FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

RUN addgroup -S executor && adduser -S executor -G executor && \
    addgroup -g 987 dockerhost && \
    adduser executor dockerhost

USER executor

EXPOSE 3000
EXPOSE 3001

CMD ["node", "dist/index.js"]

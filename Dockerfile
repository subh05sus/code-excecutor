FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

RUN addgroup -S executor && adduser -S executor -G executor

USER executor

EXPOSE 3000

CMD ["node", "dist/index.js"]

# Browser checks and page screenshots for web practicals (SparkMentis, 2026-10-20).
# The job serves the student's site from memory on 127.0.0.1 inside this
# container (no network) and drives Chromium over it: the trainer's checks,
# then a screenshot of each page at phone and desktop widths.
# Built by the executor when missing (LanguageConfig.build).
FROM node:20-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/runner
COPY package.json run.mjs ./
RUN npm install --omit=dev --no-audit --no-fund && chromium --version
ENV CHROME_PATH=/usr/bin/chromium HOME=/tmp

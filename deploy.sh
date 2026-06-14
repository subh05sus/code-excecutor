#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "==> Stashing any local changes..."
git stash

echo "==> Pulling latest changes..."
git pull

echo "==> Restoring local changes..."
git stash pop || echo "Nothing to restore or conflicts to resolve."

echo "==> Installing dependencies..."
npm ci

echo "==> Building TypeScript..."
npm run build

echo "==> Rebuilding and restarting containers..."
docker compose down
docker compose build --no-cache
docker compose up -d

echo "==> Done. Container status:"
docker compose ps

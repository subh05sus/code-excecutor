# Code Executor — Deployment Guide

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Docker Engine | 24+ |
| Docker Compose | v2+ (`docker compose`, not `docker-compose`) |
| Available RAM | ≥ 1 GB (service + language containers) |
| OS | Linux (recommended) or any Docker-capable host |

> **Linux strongly recommended.** Docker socket (`/var/run/docker.sock`) bind-mount works natively on Linux. On macOS/Windows, Docker runs in a VM — socket and `/tmp/jobs` volume paths behave differently. Use a Linux VM or cloud instance for production.

---

## Environment Variables

Create a `.env` file in the project root (never commit this):

```env
INTERNAL_TOKEN=your-strong-random-secret-here
PORT=3000
NODE_ENV=production
```

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `INTERNAL_TOKEN` | **Yes** | — | Shared secret with your main server. Min 32 chars recommended. |
| `PORT` | No | `3000` | HTTP port the service listens on |
| `NODE_ENV` | No | — | Set to `production` for prod deploys |

Generate a strong token:
```bash
openssl rand -hex 32
```

---

## Build & Run

### Option A — Docker Compose (recommended)

```bash
# Build image and start service
docker compose up --build -d

# Tail logs
docker compose logs -f code-executor

# Stop
docker compose down
```

### Option B — Manual Docker

```bash
# Build
npm run build
docker build -t code-executor .

# Run
docker run -d \
  --name code-executor \
  -p 3000:3000 \
  -e INTERNAL_TOKEN=your-secret \
  -e NODE_ENV=production \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /tmp/jobs:/tmp/jobs \
  --restart unless-stopped \
  code-executor
```

### Option C — Local dev (no Docker for the service itself)

```bash
cp .env.example .env
# Edit .env with your INTERNAL_TOKEN

npm install
npm run dev   # tsx watch — hot reload
```

Note: even in local dev, code execution still requires Docker running on the host.

---

## First Boot

On startup, the service pre-pulls all 8 language Docker images. This takes **3–10 minutes** depending on network speed. Watch logs:

```bash
docker compose logs -f code-executor
```

You'll see:
```
Starting code-executor...
Pre-pulling 8 Docker images...
Pulled: node:20-alpine
Pulled: python:3.12-alpine
...
BullMQ worker started (concurrency=5)
HTTP server listening on port 3000
```

Service is ready only after `HTTP server listening` line appears.

**Pre-pull images manually** (optional, speeds up first boot):

```bash
docker pull node:20-alpine
docker pull python:3.12-alpine
docker pull openjdk:21-slim
docker pull gcc:14
docker pull golang:1.22-alpine
docker pull rust:1.78-slim
docker pull php:8.3-cli-alpine
docker pull ruby:3.3-alpine
```

---

## Health Check

```bash
curl http://localhost:3000/health
# → {"status":"ok"}
```

---

## Verify End-to-End

```bash
export TOKEN=your-secret

# Submit a job
JOB=$(curl -s -X POST http://localhost:3000/execute \
  -H "X-Internal-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"language":"python","code":"print(42)"}')

echo $JOB
# → {"jobId":"1"}

JOB_ID=$(echo $JOB | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)

# Poll for result
curl -s http://localhost:3000/jobs/$JOB_ID \
  -H "X-Internal-Token: $TOKEN"
# → {"status":"completed","result":{"stdout":"42\n","stderr":"","exitCode":0,...}}
```

---

## Docker Socket Permissions

The service container needs access to `/var/run/docker.sock`. On most Linux systems this works out of the box. If you get a `permission denied` error:

```bash
# Check socket group
ls -la /var/run/docker.sock
# → srw-rw---- 1 root docker ...

# Option 1: Add current user to docker group (then log out/in)
sudo usermod -aG docker $USER

# Option 2: Change socket permissions (less secure, fine for private servers)
sudo chmod 666 /var/run/docker.sock
```

---

## Redis

The service connects to an external Redis instance. Connection config is hardcoded in `src/config/env.ts` with fallback to these defaults:

| Param | Value |
|-------|-------|
| Host | `ec2-52-7-14-144.compute-1.amazonaws.com` |
| Port | `6379` |
| Username | `default` |
| Password | `meow1234` |

To override via env vars, add to `.env`:

```env
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_USERNAME=default
REDIS_PASSWORD=your-password
```

Verify Redis connectivity before starting:

```bash
redis-cli -h ec2-52-7-14-144.compute-1.amazonaws.com -p 6379 -a meow1234 ping
# → PONG
```

---

## Calling From the Main Server

Add to your main server's environment:

```env
CODE_EXECUTOR_URL=http://code-executor:3000
CODE_EXECUTOR_TOKEN=your-shared-secret
```

If both services run in the same Docker network, use the service name (`code-executor`) as the hostname. Otherwise use the host IP or domain.

**Example network setup in docker-compose (if co-located):**

```yaml
# In your main server's docker-compose.yml
services:
  main-server:
    # ...
    networks:
      - app-net

  code-executor:
    image: code-executor:latest   # or build: ./code-executor
    environment:
      - INTERNAL_TOKEN=${INTERNAL_TOKEN}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /tmp/jobs:/tmp/jobs
    networks:
      - app-net

networks:
  app-net:
```

---

## Updating / Redeploying

```bash
# Pull latest code
git pull

# Rebuild and restart with zero-downtime (compose handles it)
npm run build
docker compose up --build -d
```

In-flight jobs complete before the worker shuts down (graceful drain on `SIGTERM`).

---

## Disk & Memory Footprint

| Item | Size (approx) |
|------|--------------|
| Service Docker image | ~200 MB |
| All 8 language images (pulled once) | ~5–8 GB |
| Redis memory (200 recent jobs) | < 50 MB |
| `/tmp/jobs` temp files | Cleaned up per job, near zero at rest |

Ensure the host has **at least 10 GB free disk** for language images.

---

## Troubleshooting

**Jobs stuck in `waiting`**

Worker not running. Check logs:
```bash
docker compose logs code-executor | grep -i error
```

**`permission denied` on Docker socket**

See [Docker Socket Permissions](#docker-socket-permissions) above.

**Container OOM (exitCode 137)**

User code exceeded 128 MB. Expected behaviour — not a service bug.

**Rust/Java jobs very slow on first run**

First execution pulls the image if not already cached. Subsequent runs are fast. Pre-pull images at deploy time to avoid this.

**`Redis connection refused`**

Check Redis host/port/password. Verify firewall allows outbound to Redis port.

**Service starts but `/health` times out**

Port not exposed or mapped. Verify `docker compose ps` shows `3000->3000`.

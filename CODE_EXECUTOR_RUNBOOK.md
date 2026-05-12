# Code Executor — API Runbook

Internal microservice that runs untrusted code in isolated Docker containers. Submit a job, poll for result.

---

## Authentication

Every request (except `GET /health`) requires the internal token header:

```
X-Internal-Token: <your-secret>
```

Returns `401` if missing or wrong. Token is compared with constant-time equality to prevent timing attacks.

---

## Endpoints

### `GET /health`

No auth required. Returns `200` when service is up.

```json
{ "status": "ok" }
```

---

### `POST /execute`

Submit code for execution. Returns immediately with a job ID — execution is async.

**Request**

```http
POST /execute
Content-Type: application/json
X-Internal-Token: <token>

{
  "language": "python",
  "code": "print('hello world')"
}
```

**Response — `202 Accepted`**

```json
{ "jobId": "42" }
```

**Validation errors — `400 Bad Request`**

```json
{ "error": "Invalid language", "supported": ["javascript","python","java","cpp","go","rust","php","ruby"] }
{ "error": "code must be a non-empty string" }
{ "error": "code exceeds maximum length of 65536 bytes" }
```

---

### `GET /jobs/:jobId`

Poll for execution result.

**Request**

```http
GET /jobs/42
X-Internal-Token: <token>
```

**Response shapes**

| `status` | When | Extra fields |
|----------|------|-------------|
| `waiting` | Job queued, not picked up yet | — |
| `active` | Worker executing now | — |
| `delayed` | Retrying (shouldn't happen, attempts=1) | — |
| `completed` | Done | `result` object |
| `failed` | Worker threw | `error` string |
| `unknown` | State unrecognizable | — |

**Completed response**

```json
{
  "status": "completed",
  "result": {
    "stdout": "hello world\n",
    "stderr": "",
    "exitCode": 0,
    "timedOut": false,
    "executionTimeMs": 312
  }
}
```

**Failed response**

```json
{
  "status": "failed",
  "error": "Docker daemon unreachable"
}
```

**Not found — `404`**

```json
{ "error": "Job not found" }
```

---

## Supported Languages

| `language` value | Runtime | Docker image |
|-----------------|---------|-------------|
| `javascript` | Node.js 20 | `node:20-alpine` |
| `python` | Python 3.12 | `python:3.12-alpine` |
| `java` | OpenJDK 21 | `openjdk:21-slim` |
| `cpp` | GCC 14 | `gcc:14` |
| `go` | Go 1.22 | `golang:1.22-alpine` |
| `rust` | Rust 1.78 | `rust:1.78-slim` |
| `php` | PHP 8.3 | `php:8.3-cli-alpine` |
| `ruby` | Ruby 3.3 | `ruby:3.3-alpine` |

---

## Execution Limits

| Limit | Value |
|-------|-------|
| Memory | 128 MB (swap disabled) |
| Run timeout | 10 seconds |
| Compile timeout (Java/C++/Rust) | 15 seconds |
| Max code size | 64 KB |
| Max output (stdout + stderr) | 1 MB each (truncated with `[output truncated]`) |
| Network | **Disabled** inside container |

---

## Result Field Reference

| Field | Type | Notes |
|-------|------|-------|
| `stdout` | string | Captured standard output |
| `stderr` | string | Captured standard error |
| `exitCode` | number \| null | Process exit code. `null` if timed out or container vanished |
| `timedOut` | boolean | `true` if execution exceeded timeout |
| `executionTimeMs` | number | Wall time from job start to finish (includes compile for compiled langs) |

### Exit code meanings

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Runtime error / compile failure |
| `137` | OOM-killed (exceeded 128MB) |
| `null` | Timed out (SIGKILL sent) |

---

## Polling Pattern

The recommended client flow:

```typescript
async function executeCode(language: string, code: string): Promise<ExecutionResult> {
  const BASE = "http://code-executor:3000";
  const HEADERS = { "X-Internal-Token": process.env.INTERNAL_TOKEN!, "Content-Type": "application/json" };

  // 1. Submit
  const submit = await fetch(`${BASE}/execute`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ language, code }),
  });
  const { jobId } = await submit.json();

  // 2. Poll
  while (true) {
    await new Promise((r) => setTimeout(r, 500));

    const poll = await fetch(`${BASE}/jobs/${jobId}`, { headers: HEADERS });
    const data = await poll.json();

    if (data.status === "completed") return data.result;
    if (data.status === "failed") throw new Error(data.error);
  }
}
```

Recommended poll interval: **500ms**. Max reasonable wait: **~30 seconds** (compile + run for slow languages like Rust/Java).

---

## Compiled Language Behaviour

Java, C++, and Rust run in **two stages**: compile first, then run. If compilation fails, the response still has `status: completed` with `exitCode` non-zero and the compiler error in `stderr`. `timedOut: false` in this case.

**Example — C++ compile error:**

```json
{
  "status": "completed",
  "result": {
    "stdout": "",
    "stderr": "solution.cpp:3:1: error: expected ';' before '}'\n",
    "exitCode": 1,
    "timedOut": false,
    "executionTimeMs": 2841
  }
}
```

---

## Error Scenarios

| Scenario | `status` | `exitCode` | `timedOut` |
|----------|----------|-----------|-----------|
| Code runs successfully | `completed` | `0` | `false` |
| Runtime exception | `completed` | `1` | `false` |
| Compile error (Java/C++/Rust) | `completed` | `1` | `false` |
| Infinite loop / hangs | `completed` | `null` | `true` |
| Exceeds 128MB | `completed` | `137` | `false` |
| Docker daemon down | `failed` | — | — |

---

## Queue Behaviour

- Jobs process with **5 concurrent workers**
- Under heavy load, jobs queue in Redis and process in order
- No automatic retries — each job runs once (`attempts: 1`)
- Completed/failed jobs kept in Redis for last **200 entries**, then auto-purged

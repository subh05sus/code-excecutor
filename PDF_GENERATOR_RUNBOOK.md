# PDF Generator — API Runbook

Internal microservice queue for generating PDFs from HTML. Submit a job, poll for result. Part of the same `code-executor` service — shares auth, Redis, and BullBoard.

Primary use case: transcript and result document generation for Sparkmentis.

---

## Authentication

Every request requires the internal token header:

```
X-Internal-Token: <your-secret>
```

Returns `401` if missing or wrong.

---

## Endpoints

### `POST /pdf`

Submit HTML for PDF rendering. Returns immediately with a job ID — rendering is async.

**Request**

```http
POST /pdf
Content-Type: application/json
X-Internal-Token: <token>

{
  "html": "<!doctype html><html><body><h1>Transcript</h1></body></html>",
  "options": {
    "format": "A4",
    "landscape": false,
    "margin": { "top": "20mm", "right": "15mm", "bottom": "20mm", "left": "15mm" },
    "printBackground": true,
    "displayHeaderFooter": false,
    "filename": "transcript-session-123.pdf"
  }
}
```

`options` is optional. All sub-fields are optional. Defaults: A4, portrait, 20mm top/bottom, 15mm left/right, `printBackground: true`.

**Response — `202 Accepted`**

```json
{ "jobId": "42" }
```

**Validation errors — `400 Bad Request`**

```json
{ "error": "html must be a non-empty string" }
{ "error": "html exceeds maximum size of 1MB" }
{ "error": "options must be an object" }
```

---

### `GET /pdf-jobs/:jobId`

Poll for PDF generation result.

**Request**

```http
GET /pdf-jobs/42
X-Internal-Token: <token>
```

**Response shapes**

| `status` | When | Extra fields |
|----------|------|-------------|
| `waiting` | Job queued, not picked up yet | — |
| `active` | Worker rendering now | — |
| `delayed` | Retrying (shouldn't happen, attempts=1) | — |
| `completed` | Done | `result` object |
| `failed` | Worker threw | `error` string |
| `unknown` | State unrecognizable | — |

**Completed response**

```json
{
  "status": "completed",
  "result": {
    "url": "https://s3.amazonaws.com/your-bucket/pdfs/2026/06/14/42.pdf?X-Amz-Signature=...",
    "key": "pdfs/2026/06/14/42.pdf",
    "sizeBytes": 184321,
    "expiresAt": "2026-06-14T13:00:00.000Z",
    "renderTimeMs": 1842
  }
}
```

**Failed response**

```json
{
  "status": "failed",
  "error": "PDF render timed out"
}
```

**Not found — `404`**

```json
{ "error": "PDF job not found" }
```

---

## Input Requirements

### HTML must be self-contained

Network access is **fully disabled** inside the renderer. External URLs (`http://`, `https://`) are blocked — requests are aborted silently.

All assets must be inlined:
- Images → `data:image/png;base64,...`
- Fonts → `@font-face` with `src: url("data:font/woff2;base64,...")`
- CSS → `<style>` tags or inline styles

If an image `src` points to an external URL, that image will not appear in the PDF (the request is blocked, not an error).

---

## Limits

| Limit | Value |
|-------|-------|
| Max HTML input | 1 MB |
| Max PDF output | 10 MB |
| Render timeout | 30 seconds |
| Default paper format | A4 |
| Network | **Disabled** — data: URIs only |

---

## Result Field Reference

| Field | Type | Notes |
|-------|------|-------|
| `url` | string | Presigned S3 URL — expires at `expiresAt` |
| `key` | string | S3 object key, format: `<prefix>/<YYYY>/<MM>/<DD>/<jobId>.pdf` |
| `sizeBytes` | number | PDF byte size |
| `expiresAt` | string | ISO 8601 timestamp when the presigned URL expires |
| `renderTimeMs` | number | Wall time from job start to S3 upload complete |

**Presigned URL expiry**

Default TTL is 3600 seconds (1 hour). Configurable via `PDF_SIGNED_URL_TTL_SECONDS`. After expiry, the URL returns 403 — you must re-fetch the job result to get a new presigned URL if the job is still retained in Redis.

---

## Polling Pattern

Same pattern as the code-execution queue:

```typescript
async function generatePdf(html: string, options?: PdfRenderOptions): Promise<PdfResult> {
  const BASE = "http://code-executor:3000";
  const HEADERS = { "X-Internal-Token": process.env.INTERNAL_TOKEN!, "Content-Type": "application/json" };

  // 1. Submit
  const submit = await fetch(`${BASE}/pdf`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ html, options }),
  });
  const { jobId } = await submit.json();

  // 2. Poll
  while (true) {
    await new Promise((r) => setTimeout(r, 500));

    const poll = await fetch(`${BASE}/pdf-jobs/${jobId}`, { headers: HEADERS });
    const data = await poll.json();

    if (data.status === "completed") return data.result;
    if (data.status === "failed") throw new Error(data.error);
  }
}
```

Recommended poll interval: **500ms**. Max reasonable wait: **~35 seconds** (complex HTML + S3 upload).

---

## Error Scenarios

| Scenario | `status` | Notes |
|----------|----------|-------|
| PDF generated successfully | `completed` | `result.url` is valid presigned S3 URL |
| HTML too large | `400` at POST | Rejected before queuing |
| Render takes > 30s | `failed` | `"PDF render timed out"` |
| Generated PDF > 10MB | `failed` | `"PDF exceeds maximum size of 10MB"` |
| S3 upload fails | `failed` | `"S3 upload failed: <code>"` |
| External URL in HTML | no error | Request silently aborted; element missing from PDF |

---

## Queue Behaviour

- **2 concurrent workers** (Chromium is memory-heavy; each page ~150–300 MB)
- Jobs queue in Redis under load, process in order
- No automatic retries — each job runs once (`attempts: 1`)
- Completed/failed jobs retained for last **200 entries**, then auto-purged
- Browser recycles every **50 jobs** to prevent memory leaks
- BullBoard at port 3001 shows `pdf-generation` queue alongside `code-execution`

---

## Required Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PDF_S3_BUCKET` | Yes | — | S3 bucket for PDF storage |
| `PDF_S3_REGION` | Yes | — | AWS region (e.g. `us-east-1`) |
| `PDF_S3_KEY_PREFIX` | No | `pdfs` | S3 key prefix |
| `PDF_SIGNED_URL_TTL_SECONDS` | No | `3600` | Presigned URL lifetime |
| `PDF_MAX_HTML_BYTES` | No | `1048576` | HTML size cap in bytes |
| `PDF_MAX_OUTPUT_BYTES` | No | `10485760` | PDF size cap in bytes |
| `PDF_RENDER_TIMEOUT_MS` | No | `30000` | Per-job render timeout |
| `PDF_WORKER_CONCURRENCY` | No | `2` | Parallel renders |
| `PDF_BROWSER_RECYCLE_AFTER` | No | `50` | Jobs before browser restart |
| `AWS_ACCESS_KEY_ID` | No | — | Skip on EC2; IAM role used automatically |
| `AWS_SECRET_ACCESS_KEY` | No | — | Skip on EC2; IAM role used automatically |

---

## S3 Bucket IAM Policy (minimum)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/pdfs/*"
    }
  ]
}
```

On EC2, attach this policy to the instance IAM role. No `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` needed.

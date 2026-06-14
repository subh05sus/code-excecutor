function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, defaultVal: string): string {
  return process.env[name] ?? defaultVal;
}

export const pdfConfig = {
  s3: {
    bucket: requireEnv("PDF_S3_BUCKET"),
    region: requireEnv("PDF_S3_REGION"),
    keyPrefix: optionalEnv("PDF_S3_KEY_PREFIX", "pdfs"),
    signedUrlTtlSeconds: parseInt(optionalEnv("PDF_SIGNED_URL_TTL_SECONDS", "3600"), 10),
  },
  limits: {
    maxHtmlBytes: parseInt(optionalEnv("PDF_MAX_HTML_BYTES", String(1 * 1024 * 1024)), 10),
    maxOutputBytes: parseInt(optionalEnv("PDF_MAX_OUTPUT_BYTES", String(10 * 1024 * 1024)), 10),
    renderTimeoutMs: parseInt(optionalEnv("PDF_RENDER_TIMEOUT_MS", "30000"), 10),
  },
  worker: {
    concurrency: parseInt(optionalEnv("PDF_WORKER_CONCURRENCY", "2"), 10),
    browserRecycleAfter: parseInt(optionalEnv("PDF_BROWSER_RECYCLE_AFTER", "50"), 10),
  },
};

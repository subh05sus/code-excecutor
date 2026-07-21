import { config } from "../config/env";

/**
 * POST JSON to a SparkMentis callback URL with the shared bearer secret.
 * Retries once on network error or 5xx. Returns the parsed JSON body.
 */
export async function postCallback<T = unknown>(url: string, body: unknown): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.transcript.callbackSecret}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status >= 500) {
        lastErr = new Error(`Callback ${url} returned ${res.status}`);
        continue;
      }
      if (!res.ok) {
        throw new Error(`Callback ${url} returned ${res.status}`);
      }
      return (await res.json().catch(() => ({}))) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Callback ${url} failed`);
}

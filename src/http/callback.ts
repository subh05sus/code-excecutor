import { config } from "../config/env";

type LogFn = (msg: string) => Promise<unknown> | void;

/**
 * POST JSON to a SparkMentis callback URL with the shared bearer secret.
 * Retries once on network error or 5xx. Returns the parsed JSON body.
 * Optionally logs breadcrumbs (secret presence + response) via `log`.
 */
export async function postCallback<T = unknown>(url: string, body: unknown, log?: LogFn): Promise<T> {
  const secret = config.internalToken;
  const secretInfo = secret ? `len=${secret.length} prefix=${secret.slice(0, 4)}…` : "EMPTY";
  if (log) await log(`POST ${url} (auth secret: ${secretInfo})`);

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      const text = await res.text();
      if (res.status >= 500) {
        lastErr = new Error(`Callback ${url} returned ${res.status}: ${text.slice(0, 300)}`);
        if (log) await log(`  <- ${res.status} (will retry): ${text.slice(0, 200)}`);
        continue;
      }
      if (!res.ok) {
        if (log) await log(`  <- ${res.status}: ${text.slice(0, 200)}`);
        throw new Error(`Callback ${url} returned ${res.status}: ${text.slice(0, 300)}`);
      }
      if (log) await log(`  <- ${res.status} ok`);
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      lastErr = err;
      if (log) await log(`  <- error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Callback ${url} failed`);
}

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { runBrowserJob } from "../../executor/dockerExecutor";

/**
 * Browser checks and screenshots for web practicals (SparkMentis, 2026-10-20).
 * Run in the request, not the queue: a run carries the site's images and
 * returns its screenshots, too big to park in the Redis SparkMentor shares.
 * One Chromium at a time by default (BROWSER_CONCURRENCY), a short line after.
 */
const router = Router();
const CONCURRENCY = Math.max(1, Number(process.env["BROWSER_CONCURRENCY"] ?? 1) || 1);
const MAX_WAITING = 12;
let running = 0;
const waiting: Array<() => void> = [];

async function slot(): Promise<() => void> {
  if (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  return () => {
    running--;
    waiting.shift()?.();
  };
}

router.post("/browser-runs", async (req: Request, res: Response) => {
  if (waiting.length >= MAX_WAITING) {
    res.status(503).json({ error: "The checker is busy — try again shortly", retryAfter: 30 });
    return;
  }
  const payload = JSON.stringify(req.body ?? {});
  const release = await slot();
  try {
    const run = await runBrowserJob(`browser-${crypto.randomUUID()}`, payload);
    const at = run.stdout.lastIndexOf("---SPARK_BROWSER---");
    if (at < 0) {
      res.status(502).json({ error: run.timedOut ? "The checker ran out of time" : "The checker didn't finish", stderr: run.stderr.slice(-2000) });
      return;
    }
    res.type("application/json").send(run.stdout.slice(at + "---SPARK_BROWSER---".length).trim());
  } catch (err) {
    console.error("[browser-runs]", (err as Error).message);
    res.status(500).json({ error: "The checker couldn't run" });
  } finally {
    release();
  }
});

export { router as browserRunsRouter };

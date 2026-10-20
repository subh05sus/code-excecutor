import { Router, Request, Response } from "express";
import { ensureSandbox, sandboxDb, sandboxRequest, sandboxStats, stopSandbox, SandboxBusyError, SandboxMissingError } from "../../sandbox/manager";

/**
 * Live student sites (SparkMentis practical exams): POST /sandboxes/:key starts
 * or updates one, /request sends it an HTTP request, /db shows its database,
 * DELETE stops it. The app is the only caller (X-Internal-Token).
 */
const router = Router();
const KEY = /^[A-Za-z0-9_-]{1,120}$/;
const FOLDER = /^[A-Za-z0-9_-]{1,64}$/;
const DB_NAME = /^[A-Za-z0-9_]{1,64}$/;

function fail(res: Response, err: unknown): void {
  if (err instanceof SandboxBusyError) {
    res.status(503).json({ error: err.message, retryAfter: 5 });
    return;
  }
  if (err instanceof SandboxMissingError) {
    res.status(404).json({ error: err.message });
    return;
  }
  console.error("[sandboxes]", (err as Error).message);
  res.status(500).json({ error: "The site couldn't be reached" });
}

router.get("/sandboxes", (_req: Request, res: Response) => {
  res.json(sandboxStats());
});

router.post("/sandboxes/:key", async (req: Request, res: Response) => {
  const key = String(req.params["key"]);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const folder = String(body["folder"] ?? "");
  const db = body["database"] as { name?: unknown; sql?: unknown } | null | undefined;
  const files = body["files"];
  const assets = body["assets"];
  if (!KEY.test(key) || !FOLDER.test(folder)) {
    res.status(400).json({ error: "Bad site key or folder" });
    return;
  }
  if (db && (typeof db.name !== "string" || !DB_NAME.test(db.name) || typeof db.sql !== "string")) {
    res.status(400).json({ error: "Bad database" });
    return;
  }
  if (!files || typeof files !== "object" || Array.isArray(files) || !Array.isArray(assets ?? [])) {
    res.status(400).json({ error: "Bad files" });
    return;
  }
  try {
    const out = await ensureSandbox(
      { key, folder, database: db ? { name: db.name as string, sql: db.sql as string } : null },
      {
        files: Object.fromEntries(Object.entries(files as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<string, string>,
        assets: ((assets ?? []) as Array<Record<string, unknown>>)
          .filter((a) => typeof a?.["path"] === "string" && typeof a?.["key"] === "string")
          .map((a) => ({ path: a["path"] as string, key: a["key"] as string, data: typeof a["data"] === "string" ? (a["data"] as string) : undefined })),
      }
    );
    res.json(out);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/sandboxes/:key/request", async (req: Request, res: Response) => {
  const key = String(req.params["key"]);
  if (!KEY.test(key)) {
    res.status(400).json({ error: "Bad site key" });
    return;
  }
  try {
    res.json(await sandboxRequest(key, req.body ?? {}));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/sandboxes/:key/db", async (req: Request, res: Response) => {
  const key = String(req.params["key"]);
  if (!KEY.test(key)) {
    res.status(400).json({ error: "Bad site key" });
    return;
  }
  try {
    res.json(await sandboxDb(key, req.body ?? {}));
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/sandboxes/:key", async (req: Request, res: Response) => {
  const key = String(req.params["key"]);
  if (!KEY.test(key)) {
    res.status(400).json({ error: "Bad site key" });
    return;
  }
  res.json({ stopped: await stopSandbox(key) });
});

export { router as sandboxesRouter };

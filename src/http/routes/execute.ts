import { Router, Request, Response } from "express";
import { SUPPORTED_LANGUAGES } from "../../config/languages";
import { executionQueue } from "../../queue/executionQueue";
import { SupportedLanguage } from "../../types/index";

const router = Router();

// SQL datasets and multi-file PHP projects travel inside the runner script.
const MAX_CODE_LENGTH = 1024 * 1024; // 1MB

router.post("/execute", async (req: Request, res: Response): Promise<void> => {
  const { language, code, cases, caseTimeoutMs } = req.body as { language?: unknown; code?: unknown; cases?: unknown; caseTimeoutMs?: unknown };

  if (!language || typeof language !== "string" || !SUPPORTED_LANGUAGES.has(language as SupportedLanguage)) {
    res.status(400).json({
      error: "Invalid language",
      supported: [...SUPPORTED_LANGUAGES],
    });
    return;
  }

  if (!code || typeof code !== "string" || code.trim().length === 0) {
    res.status(400).json({ error: "code must be a non-empty string" });
    return;
  }

  if (code.length > MAX_CODE_LENGTH) {
    res.status(400).json({ error: `code exceeds maximum length of ${MAX_CODE_LENGTH} bytes` });
    return;
  }

  // Program mode (practical exams): stdin per case, compiled once.
  let jobCases: Array<{ stdin: string }> | undefined;
  if (cases !== undefined) {
    if (!Array.isArray(cases) || cases.length === 0 || cases.length > 50 || cases.some((c) => typeof c?.stdin !== "string" || c.stdin.length > 256 * 1024)) {
      res.status(400).json({ error: "cases must be 1–50 items of { stdin } (at most 256 KB each)" });
      return;
    }
    jobCases = cases.map((c: { stdin: string }) => ({ stdin: c.stdin }));
  }

  const job = await executionQueue.add("run", {
    language: language as SupportedLanguage,
    code,
    ...(jobCases ? { cases: jobCases, caseTimeoutMs: typeof caseTimeoutMs === "number" ? caseTimeoutMs : undefined } : {}),
  });

  res.status(202).json({ jobId: job.id });
});

export { router as executeRouter };

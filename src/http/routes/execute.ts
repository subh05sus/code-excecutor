import { Router, Request, Response } from "express";
import { SUPPORTED_LANGUAGES } from "../../config/languages";
import { executionQueue } from "../../queue/executionQueue";
import { SupportedLanguage } from "../../types/index";

const router = Router();

const MAX_CODE_LENGTH = 64 * 1024; // 64KB

router.post("/execute", async (req: Request, res: Response): Promise<void> => {
  const { language, code } = req.body as { language?: unknown; code?: unknown };

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

  const job = await executionQueue.add("run", {
    language: language as SupportedLanguage,
    code,
  });

  res.status(202).json({ jobId: job.id });
});

export { router as executeRouter };

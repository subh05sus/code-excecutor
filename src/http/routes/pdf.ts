import { Router, Request, Response } from "express";
import { pdfQueue } from "../../queue/pdfQueue";
import { pdfConfig } from "../../config/pdf";
import { PdfRenderOptions } from "../../types/pdf";

const router = Router();

router.post("/pdf", async (req: Request, res: Response): Promise<void> => {
  const { html, options } = req.body as { html?: unknown; options?: unknown };

  if (!html || typeof html !== "string" || html.trim().length === 0) {
    res.status(400).json({ error: "html must be a non-empty string" });
    return;
  }

  if (Buffer.byteLength(html, "utf8") > pdfConfig.limits.maxHtmlBytes) {
    const maxMb = pdfConfig.limits.maxHtmlBytes / (1024 * 1024);
    res.status(400).json({ error: `html exceeds maximum size of ${maxMb}MB` });
    return;
  }

  if (options !== undefined && (typeof options !== "object" || Array.isArray(options) || options === null)) {
    res.status(400).json({ error: "options must be an object" });
    return;
  }

  const job = await pdfQueue.add("render", { html, options: options as PdfRenderOptions | undefined });

  res.status(202).json({ jobId: job.id });
});

export { router as pdfRouter };

import { Router, Request, Response } from "express";
import { Job } from "bullmq";
import { pdfQueue } from "../../queue/pdfQueue";
import { PdfResult, PdfJobStatusResponse } from "../../types/pdf";

const router = Router();

router.get("/pdf-jobs/:jobId", async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params["jobId"]);

  const job = await Job.fromId<PdfResult>(pdfQueue, jobId);

  if (!job) {
    res.status(404).json({ error: "PDF job not found" });
    return;
  }

  const state = await job.getState();

  let response: PdfJobStatusResponse;

  if (state === "completed") {
    response = { status: "completed", result: job.returnvalue };
  } else if (state === "failed") {
    response = { status: "failed", error: job.failedReason ?? "Unknown error" };
  } else if (state === "active" || state === "waiting" || state === "delayed") {
    response = { status: state };
  } else {
    response = { status: "unknown" };
  }

  res.status(200).json(response);
});

export { router as pdfJobsRouter };

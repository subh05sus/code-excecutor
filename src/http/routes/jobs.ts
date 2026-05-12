import { Router, Request, Response } from "express";
import { Job } from "bullmq";
import { executionQueue } from "../../queue/executionQueue";
import { ExecutionResult, JobStatusResponse } from "../../types/index";

const router = Router();

router.get("/jobs/:jobId", async (req: Request, res: Response): Promise<void> => {
  const jobId = String(req.params["jobId"]);

  const job = await Job.fromId<ExecutionResult>(executionQueue, jobId);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const state = await job.getState();

  let response: JobStatusResponse;

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

export { router as jobsRouter };

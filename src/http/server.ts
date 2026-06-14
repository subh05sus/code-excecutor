import express from "express";
import { internalAuth } from "./middleware/auth";
import { executeRouter } from "./routes/execute";
import { jobsRouter } from "./routes/jobs";
import { pdfRouter } from "./routes/pdf";
import { pdfJobsRouter } from "./routes/pdfJobs";

export function createApp() {
  const app = express();

  // 1100kb: headroom above 1MB HTML limit for JSON envelope
  app.use(express.json({ limit: "1100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(internalAuth);
  app.use(executeRouter);
  app.use(jobsRouter);
  app.use(pdfRouter);
  app.use(pdfJobsRouter);

  return app;
}

import express from "express";
import { internalAuth } from "./middleware/auth";
import { executeRouter } from "./routes/execute";
import { jobsRouter } from "./routes/jobs";
import { pdfRouter } from "./routes/pdf";
import { pdfJobsRouter } from "./routes/pdfJobs";
import { transcriptBatchRouter } from "./routes/transcriptBatch";
import { sandboxesRouter } from "./routes/sandboxes";
import { browserRunsRouter } from "./routes/browserRuns";

export function createApp() {
  const app = express();

  // 2mb: transcript batches ship inlined HTML back and forth. Practical
  // exams' live sites and browser runs carry a project's images (32mb).
  const small = express.json({ limit: "2mb" });
  const large = express.json({ limit: "32mb" });
  app.use((req, res, next) => (req.path.startsWith("/sandboxes") || req.path === "/browser-runs" ? large(req, res, next) : small(req, res, next)));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(internalAuth);
  app.use(executeRouter);
  app.use(jobsRouter);
  app.use(pdfRouter);
  app.use(pdfJobsRouter);
  app.use(transcriptBatchRouter);
  app.use(sandboxesRouter);
  app.use(browserRunsRouter);

  return app;
}

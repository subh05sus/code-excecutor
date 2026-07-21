import express from "express";
import { internalAuth } from "./middleware/auth";
import { executeRouter } from "./routes/execute";
import { jobsRouter } from "./routes/jobs";
import { pdfRouter } from "./routes/pdf";
import { pdfJobsRouter } from "./routes/pdfJobs";
import { transcriptBatchRouter } from "./routes/transcriptBatch";

export function createApp() {
  const app = express();

  // 2mb: transcript batches ship inlined HTML back and forth
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(internalAuth);
  app.use(executeRouter);
  app.use(jobsRouter);
  app.use(pdfRouter);
  app.use(pdfJobsRouter);
  app.use(transcriptBatchRouter);

  return app;
}

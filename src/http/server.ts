import express from "express";
import { internalAuth } from "./middleware/auth";
import { executeRouter } from "./routes/execute";
import { jobsRouter } from "./routes/jobs";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "128kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(internalAuth);
  app.use(executeRouter);
  app.use(jobsRouter);

  return app;
}

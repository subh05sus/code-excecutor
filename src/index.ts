import { config } from "./config/env";
import { createApp } from "./http/server";
import { createBullBoardServer } from "./http/bullboard";
import { createWorker } from "./queue/worker";
import { prePullImages } from "./executor/dockerExecutor";

async function main() {
  console.log("Starting code-executor...");

  await prePullImages();

  const worker = createWorker();
  console.log("BullMQ worker started (concurrency=5)");

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`HTTP server listening on port ${config.port}`);
  });

  const bullBoardServer = createBullBoardServer();

  const shutdown = async () => {
    console.log("Shutting down...");
    await worker.close();
    bullBoardServer.close();
    server.close(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

import { config } from "./config/env";
import { createApp } from "./http/server";
import { createBullBoardServer } from "./http/bullboard";
import { createWorker } from "./queue/worker";
import { createPdfWorker } from "./queue/pdfWorker";
import { prePullImages } from "./executor/dockerExecutor";
import { warmup as warmupBrowser, closeBrowser } from "./pdf/browserPool";
import { pdfConfig } from "./config/pdf";

async function main() {
  console.log("Starting code-executor...");

  await Promise.all([prePullImages(), warmupBrowser()]);

  const worker = createWorker();
  console.log("BullMQ code-execution worker started (concurrency=5)");

  const pdfWorker = createPdfWorker();
  console.log(`BullMQ pdf-generation worker started (concurrency=${pdfConfig.worker.concurrency})`);

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`HTTP server listening on port ${config.port}`);
  });

  const bullBoardServer = createBullBoardServer();

  const shutdown = async () => {
    console.log("Shutting down...");
    await Promise.all([worker.close(), pdfWorker.close()]);
    await closeBrowser();
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

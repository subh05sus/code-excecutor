import { Worker } from "bullmq";
import { PdfJobData, PdfResult } from "../types/pdf";
import { redisConnection } from "./connection";
import { renderPdf } from "../pdf/pdfRenderer";
import { pdfConfig } from "../config/pdf";

export function createPdfWorker(): Worker {
  const worker = new Worker<PdfJobData, PdfResult>(
    "pdf-generation",
    async (job) => {
      return await renderPdf(job.id ?? "unknown", job.data);
    },
    {
      connection: redisConnection,
      concurrency: pdfConfig.worker.concurrency,
    }
  );

  worker.on("completed", (job) => {
    console.log(`PDF job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`PDF job ${job?.id} failed:`, err.message);
  });

  return worker;
}

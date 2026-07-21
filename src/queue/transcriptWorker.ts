import { Worker, Job } from "bullmq";
import { TranscriptJobData, PrepareResponse } from "../types/transcript";
import { redisConnection } from "./connection";
import { config } from "../config/env";
import { postCallback } from "../http/callback";
import { renderHtmlToPdf } from "../pdf/pdfRenderer";
import { uploadToBucket } from "../pdf/s3Uploader";

/**
 * Per-item transcript worker. Pulls render-ready HTML from SparkMentis
 * (prepare), renders + uploads the PDF to the target bucket/key, then reports
 * back (complete). Cancellation/dedup/gate failures are resolved by prepare and
 * simply short-circuit here (no retry). Render/upload errors throw so BullMQ
 * retries; on the final failure we report ok:false so the batch can finalize.
 */
export function createTranscriptWorker(): Worker {
  const worker = new Worker<TranscriptJobData>(
    "transcript-generation",
    async (job) => {
      const { itemId, prepareUrl, completeUrl } = job.data;

      const prep = await postCallback<PrepareResponse>(prepareUrl, { itemId });

      if (prep.action !== "render") {
        // cancelled | skip | error — SparkMentis already recorded the outcome.
        return { itemId, action: prep.action };
      }

      const buffer = await renderHtmlToPdf(prep.html, prep.pdfOptions ?? {});
      await uploadToBucket(prep.s3Bucket, prep.s3Key, buffer, "application/pdf");
      await postCallback(completeUrl, { itemId, ok: true });

      return { itemId, action: "render", sizeBytes: buffer.byteLength };
    },
    {
      connection: redisConnection,
      concurrency: config.transcript.workerConcurrency,
    }
  );

  worker.on("completed", (job) => {
    console.log(`Transcript job ${job.id} completed`);
  });

  worker.on("failed", async (job: Job<TranscriptJobData> | undefined, err) => {
    console.error(`Transcript job ${job?.id} failed:`, err?.message);
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    // Only report the terminal failure so the batch can finalize.
    if (job.attemptsMade >= maxAttempts) {
      try {
        await postCallback(job.data.completeUrl, {
          itemId: job.data.itemId,
          ok: false,
          error: err?.message ?? "render failed",
        });
      } catch (e) {
        console.error(`Transcript job ${job.id} final complete callback failed:`, e);
      }
    }
  });

  return worker;
}

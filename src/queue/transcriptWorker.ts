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
  const secret = config.transcript.callbackSecret;
  console.log(
    `[transcript-worker] callback secret: ${secret ? `SET (len=${secret.length}, prefix=${secret.slice(0, 4)}…)` : "MISSING — callbacks will 401"}`
  );

  const worker = new Worker<TranscriptJobData>(
    "transcript-generation",
    async (job) => {
      const { itemId, prepareUrl, completeUrl } = job.data;
      const log = (msg: string) => job.log(msg);

      await log(`item ${itemId}: preparing`);
      const prep = await postCallback<PrepareResponse>(prepareUrl, { itemId }, log);
      await log(`item ${itemId}: prepare action=${prep.action}`);

      if (prep.action !== "render") {
        // cancelled | skip | error — SparkMentis already recorded the outcome.
        return { itemId, action: prep.action };
      }

      await log(`item ${itemId}: rendering → s3://${prep.s3Bucket}/${prep.s3Key}`);
      const buffer = await renderHtmlToPdf(prep.html, prep.pdfOptions ?? {});
      await uploadToBucket(prep.s3Bucket, prep.s3Key, buffer, "application/pdf");
      await log(`item ${itemId}: uploaded ${buffer.byteLength} bytes, completing`);
      await postCallback(completeUrl, { itemId, ok: true }, log);

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
        await postCallback(
          job.data.completeUrl,
          { itemId: job.data.itemId, ok: false, error: err?.message ?? "render failed" },
          (m) => job.log(m)
        );
      } catch (e) {
        console.error(`Transcript job ${job.id} final complete callback failed:`, e);
      }
    }
  });

  return worker;
}

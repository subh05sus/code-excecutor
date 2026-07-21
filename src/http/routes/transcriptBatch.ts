import { Router, Request, Response } from "express";
import { transcriptQueue } from "../../queue/transcriptQueue";

const router = Router();

/**
 * Enqueue a bulk transcript batch (called by SparkMentis). One BullMQ job per
 * item; each job drives the SparkMentis prepare/complete callbacks.
 *
 * Job ids are auto-generated (not custom): retry/regenerate re-enqueue the same
 * items and must produce fresh jobs, and BullMQ would drop a re-add of an
 * existing custom id (retained by removeOnComplete). Idempotency is enforced in
 * SparkMentis instead (atomic claim + idempotent result + finalize-once).
 */
router.post("/transcript-batch", async (req: Request, res: Response): Promise<void> => {
  const { requestId, items, callbackBaseUrl } = req.body as {
    requestId?: string;
    items?: { itemId: string }[];
    callbackBaseUrl?: string;
  };

  if (!requestId || !Array.isArray(items) || items.length === 0 || !callbackBaseUrl) {
    res.status(400).json({ error: "requestId, items[], and callbackBaseUrl are required" });
    return;
  }

  const prepareUrl = `${callbackBaseUrl}/api/internal/transcripts/prepare`;
  const completeUrl = `${callbackBaseUrl}/api/internal/transcripts/complete`;

  try {
    await transcriptQueue.addBulk(
      items.map((it) => ({
        name: "render",
        data: { itemId: it.itemId, prepareUrl, completeUrl },
      }))
    );
  } catch (err) {
    console.error("[transcript-batch] enqueue failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "enqueue failed" });
    return;
  }

  res.status(202).json({ requestId, queued: items.length });
});

export { router as transcriptBatchRouter };

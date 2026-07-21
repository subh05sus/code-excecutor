import { Queue } from "bullmq";
import { TranscriptJobData } from "../types/transcript";
import { redisConnection } from "./connection";

export const transcriptQueue = new Queue<TranscriptJobData>("transcript-generation", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

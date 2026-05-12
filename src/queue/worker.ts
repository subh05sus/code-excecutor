import { Worker } from "bullmq";
import { ExecutionJobData, ExecutionResult } from "../types/index";
import { redisConnection } from "./connection";
import { runInDocker } from "../executor/dockerExecutor";

export function createWorker(): Worker {
  const worker = new Worker<ExecutionJobData, ExecutionResult>(
    "code-execution",
    async (job) => {
      return await runInDocker(job.id ?? "unknown", job.data);
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  worker.on("completed", (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

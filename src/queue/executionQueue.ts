import { Queue } from "bullmq";
import { ExecutionJobData } from "../types/index";
import { redisConnection } from "./connection";

export const executionQueue = new Queue<ExecutionJobData>("code-execution", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});

import { Queue } from "bullmq";
import { PdfJobData } from "../types/pdf";
import { redisConnection } from "./connection";

export const pdfQueue = new Queue<PdfJobData>("pdf-generation", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});

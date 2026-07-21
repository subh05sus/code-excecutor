import { PdfRenderOptions } from "./pdf";

/** One BullMQ job = one transcript item, driven via SparkMentis callbacks. */
export interface TranscriptJobData {
  itemId: string;
  prepareUrl: string;
  completeUrl: string;
}

/** Response from the SparkMentis prepare callback. */
export type PrepareResponse =
  | { action: "cancelled" }
  | { action: "skip" }
  | { action: "error"; error?: string }
  | {
      action: "render";
      itemId: string;
      transcriptId: string;
      serialNo: string;
      s3Bucket: string;
      s3Key: string;
      html: string;
      pdfOptions?: PdfRenderOptions;
    };

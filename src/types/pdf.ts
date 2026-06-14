export interface PdfJobData {
  html: string;
  options?: PdfRenderOptions;
}

export interface PdfRenderOptions {
  format?: "A4" | "A3" | "Letter" | "Legal";
  landscape?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  printBackground?: boolean;
  displayHeaderFooter?: boolean;
  filename?: string;
}

export interface PdfResult {
  url: string;
  key: string;
  sizeBytes: number;
  expiresAt: string;
  renderTimeMs: number;
}

export type PdfJobStatusResponse =
  | { status: "waiting" | "active" | "delayed" | "unknown" }
  | { status: "completed"; result: PdfResult }
  | { status: "failed"; error: string };

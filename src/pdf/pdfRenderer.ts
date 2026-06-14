import { PdfJobData, PdfResult } from "../types/pdf";
import { pdfConfig } from "../config/pdf";
import { getPage, releasePage } from "./browserPool";
import { uploadAndSign } from "./s3Uploader";

function buildS3Key(jobId: string, filename?: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${pdfConfig.s3.keyPrefix}/${y}/${m}/${d}/${filename ?? `${jobId}.pdf`}`;
}

export async function renderPdf(jobId: string, data: PdfJobData): Promise<PdfResult> {
  const { html, options = {} } = data;
  const startMs = Date.now();

  const page = await getPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("about:")) {
        req.continue();
      } else {
        req.abort();
      }
    });

    await page.setContent(html, {
      waitUntil: "load",
      timeout: pdfConfig.limits.renderTimeoutMs,
    });

    const pdfBuffer = await Promise.race([
      page.pdf({
        format: options.format ?? "A4",
        landscape: options.landscape ?? false,
        margin: options.margin ?? { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
        printBackground: options.printBackground ?? true,
        displayHeaderFooter: options.displayHeaderFooter ?? false,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("PDF render timed out")),
          pdfConfig.limits.renderTimeoutMs
        )
      ),
    ]);

    if (pdfBuffer.byteLength > pdfConfig.limits.maxOutputBytes) {
      const maxMb = pdfConfig.limits.maxOutputBytes / (1024 * 1024);
      throw new Error(`PDF exceeds maximum size of ${maxMb}MB`);
    }

    const key = buildS3Key(jobId, options.filename);
    const { url, expiresAt } = await uploadAndSign(key, Buffer.from(pdfBuffer), "application/pdf");

    return {
      url,
      key,
      sizeBytes: pdfBuffer.byteLength,
      expiresAt,
      renderTimeMs: Date.now() - startMs,
    };
  } finally {
    await releasePage(page);
  }
}

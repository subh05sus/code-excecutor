import puppeteer, { Browser, Page } from "puppeteer-core";
import { pdfConfig } from "../config/pdf";

let browser: Browser | null = null;
let jobCount = 0;

const CHROMIUM_FLAGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
];

async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    executablePath: process.env["PUPPETEER_EXECUTABLE_PATH"] ?? "/usr/bin/chromium-browser",
    args: CHROMIUM_FLAGS,
    headless: true,
  });
}

export async function warmup(): Promise<void> {
  browser = await launchBrowser();
  console.log("Puppeteer browser launched");
}

export async function getPage(): Promise<Page> {
  if (!browser || !browser.connected) {
    browser = await launchBrowser();
  }
  return browser.newPage();
}

export async function releasePage(page: Page): Promise<void> {
  try {
    await page.close();
  } catch {
    // ignore close errors — browser may have crashed
  }

  jobCount++;
  if (jobCount >= pdfConfig.worker.browserRecycleAfter) {
    jobCount = 0;
    const old = browser;
    browser = await launchBrowser();
    await old?.close().catch(() => {});
  }
}

export async function closeBrowser(): Promise<void> {
  await browser?.close().catch(() => {});
  browser = null;
}

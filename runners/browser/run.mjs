// Browser checks and screenshots for a web practical (SparkMentis, 2026-10-20).
// Input: argv[2] = job.json {
//   files: {path: text}, assets: {path: base64}, entry,
//   checks: [{ id, steps: [{ goto | click | type | select | check | submit | wait | expect }] }],
//   shots: { pages: [path], widths: [390, 1280], maxHeight, quality },
//   deadlineMs }
// Output: "\n---SPARK_BROWSER---\n" + JSON { checks, shots, console, fatal? } on stdout.
import http from "node:http";
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const T0 = Date.now();
const job = JSON.parse(readFileSync(process.argv[2], "utf8"));
const DEADLINE = Math.min(Number(job.deadlineMs) || 100_000, 150_000);
const left = () => DEADLINE - (Date.now() - T0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => String(s ?? "").replace(/\s+/g, " ").slice(0, 300);

const TYPES = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
  txt: "text/plain; charset=utf-8", xml: "application/xml", mp3: "audio/mpeg", mp4: "video/mp4",
};
const typeOf = (p) => TYPES[p.split(".").pop().toLowerCase()] ?? "application/octet-stream";

const files = new Map();
for (const [p, text] of Object.entries(job.files ?? {})) files.set(p, Buffer.from(String(text), "utf8"));
for (const [p, b64] of Object.entries(job.assets ?? {})) files.set(p, Buffer.from(String(b64), "base64"));

// The site, as if opened from its folder: "/" and folders serve their index.html;
// a form posted to a page just gets that page.
const server = http.createServer((req, res) => {
  let path = "";
  try {
    path = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "");
  } catch {
    path = "";
  }
  if (path === "" || path.endsWith("/")) path += "index.html";
  const body = files.get(path) ?? files.get(`${path}/index.html`);
  req.resume();
  if (!body) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    res.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
    return;
  }
  res.writeHead(200, { "content-type": typeOf(path), "cache-control": "no-store" });
  res.end(body);
});
await new Promise((r) => server.listen(8123, "127.0.0.1", r));
const BASE = "http://127.0.0.1:8123/";

const report = { checks: [], shots: [], console: {} };
const emit = () => {
  process.stdout.write("\n---SPARK_BROWSER---\n" + JSON.stringify(report) + "\n");
};

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-zygote", "--disable-extensions", "--mute-audio", "--disable-crash-reporter", "--font-render-hinting=none"],
  });
} catch (err) {
  report.fatal = `The browser didn't start: ${short(err.message)}`;
  emit();
  process.exit(0);
}

const ok = () => ({ ok: true });
const fail = (detail) => ({ ok: false, detail: short(detail) });
const clean = (p) => String(p ?? "").replace(/^\.?\/+/, "");

/** An action that may load another page (a link, a submitted form) or not (JavaScript handles it). */
async function settle(page, action) {
  const nav = page.waitForNavigation({ waitUntil: "load", timeout: 2500 }).catch(() => null);
  await action();
  await nav;
  await sleep(250);
}

async function inspect(page, selector) {
  return page.evaluate((sel) => {
    let els;
    try {
      els = sel ? [...document.querySelectorAll(sel)] : [document.body];
    } catch (e) {
      return { error: `“${sel}” isn't a valid selector` };
    }
    const shown = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
    };
    return {
      count: els.length,
      visible: els.filter(shown).length,
      text: els.map((el) => (el.innerText || el.value || el.getAttribute("alt") || "").toString()).join("\n").slice(0, 20000),
      invalid: document.querySelectorAll(":invalid:not(form)").length,
      path: location.pathname,
    };
  }, selector ?? null);
}

async function judge(page, e, state) {
  if (Array.isArray(e.anyOf) && e.anyOf.length) {
    const misses = [];
    for (const alt of e.anyOf) {
      const r = await judge(page, alt, state);
      if (r.ok) return ok();
      misses.push(r.detail);
    }
    return fail(misses.join(" — or — "));
  }
  const info = await inspect(page, e.selector);
  if (info.error) return fail(info.error);
  const what = e.selector ? `“${e.selector}”` : "the page";
  if (e.exists === true && info.count === 0) return fail(`${what} isn't on the page`);
  if (e.exists === false && info.count > 0) return fail(`${what} is on the page`);
  if (e.visible === true && info.visible === 0) return fail(`${what} isn't showing`);
  if (e.visible === false && info.visible > 0) return fail(`${what} is showing`);
  if (e.count) {
    if (e.count.min != null && info.count < e.count.min) return fail(`${what}: found ${info.count}, expected at least ${e.count.min}`);
    if (e.count.max != null && info.count > e.count.max) return fail(`${what}: found ${info.count}, expected at most ${e.count.max}`);
  }
  if (e.text && !info.text.toLowerCase().includes(String(e.text).toLowerCase())) return fail(`${what} doesn't say “${e.text}”`);
  if (e.notText && info.text.toLowerCase().includes(String(e.notText).toLowerCase())) return fail(`${what} says “${e.notText}”`);
  if (e.url && !info.path.toLowerCase().includes(String(e.url).toLowerCase())) return fail(`Ended on ${info.path}, not ${e.url}`);
  if (e.notUrl && info.path.toLowerCase().includes(String(e.notUrl).toLowerCase())) return fail(`Ended on ${info.path}`);
  if (e.alert === true && state.dialogs.length <= state.mark) return fail("No pop-up message appeared");
  if (e.alert === false && state.dialogs.length > state.mark) return fail(`A pop-up appeared: “${state.dialogs.at(-1)}”`);
  if (e.invalid === true && info.invalid === 0) return fail("No field was marked as invalid");
  if (e.attr && e.selector) {
    const v = await page.$eval(e.selector, (el, name) => el.getAttribute(name), e.attr.name).catch(() => null);
    if (v == null) return fail(`${what} has no ${e.attr.name}`);
    if (e.attr.value != null && !String(v).toLowerCase().includes(String(e.attr.value).toLowerCase())) return fail(`${what}'s ${e.attr.name} is “${short(v)}”`);
  }
  if (e.style && e.selector) {
    const v = await page.$eval(e.selector, (el, prop) => getComputedStyle(el).getPropertyValue(prop), e.style.prop).catch(() => null);
    if (v == null) return fail(`${what} isn't on the page`);
    if (!String(v).toLowerCase().includes(String(e.style.value).toLowerCase())) return fail(`${what}'s ${e.style.prop} is “${short(v)}”`);
  }
  return ok();
}

async function runStep(page, step, state) {
  if (step.expect) return judge(page, step.expect, state);
  state.mark = state.dialogs.length;
  if (step.goto !== undefined) {
    const resp = await page.goto(BASE + clean(step.goto), { waitUntil: "load", timeout: 8000 });
    if (resp && resp.status() === 404) return fail(`${clean(step.goto) || "index.html"} doesn't exist`);
    await sleep(150);
    return ok();
  }
  if (step.click) {
    await page.waitForSelector(step.click, { timeout: 2500 });
    await settle(page, () => page.click(step.click));
    return ok();
  }
  if (step.type) {
    await page.waitForSelector(step.type.selector, { timeout: 2500 });
    await page.$eval(step.type.selector, (el) => {
      el.focus();
      if ("value" in el) el.value = "";
    });
    await page.type(step.type.selector, String(step.type.text ?? ""));
    return ok();
  }
  if (step.select) {
    await page.waitForSelector(step.select.selector, { timeout: 2500 });
    await page.select(step.select.selector, String(step.select.value));
    return ok();
  }
  if (step.check) {
    await page.waitForSelector(step.check, { timeout: 2500 });
    await page.click(step.check);
    return ok();
  }
  if (step.submit) {
    await page.waitForSelector(step.submit, { timeout: 2500 });
    await settle(page, () =>
      page.$eval(step.submit, (el) => {
        const form = el.tagName === "FORM" ? el : el.closest("form");
        if (!form) throw new Error("There's no form there");
        const button = form.querySelector('[type="submit"], button:not([type]), input[type="image"]');
        if (button) button.click();
        else if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      })
    );
    return ok();
  }
  if (step.wait) {
    await sleep(Math.min(3000, Number(step.wait) || 0));
    return ok();
  }
  return fail("This step isn't one the checker knows");
}

for (const check of job.checks ?? []) {
  if (left() < 8000) {
    report.checks.push({ id: check.id, passed: false, skipped: true, steps: [] });
    continue;
  }
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.setDefaultTimeout(5000);
  const state = { dialogs: [], mark: 0 };
  page.on("dialog", async (d) => {
    state.dialogs.push(d.message());
    await d.dismiss().catch(() => {});
  });
  const steps = [];
  let failed = false;
  if (!(check.steps ?? []).some((s) => s.goto !== undefined)) {
    await page.goto(BASE + clean(job.entry || "index.html"), { waitUntil: "load", timeout: 8000 }).catch(() => {});
  }
  for (const step of check.steps ?? []) {
    if (failed) {
      steps.push({ ok: false, skipped: true });
      continue;
    }
    try {
      const r = await Promise.race([runStep(page, step, state), sleep(10_000).then(() => fail("This step took too long"))]);
      steps.push(r);
      if (!r.ok) failed = true;
    } catch (err) {
      steps.push(fail(err.message));
      failed = true;
    }
  }
  await ctx.close().catch(() => {});
  report.checks.push({ id: check.id, passed: !failed && steps.every((s) => s.ok), steps });
}

const shots = job.shots ?? { pages: [], widths: [] };
for (const p of shots.pages ?? []) {
  for (const width of shots.widths ?? []) {
    if (left() < 5000) break;
    const page = await browser.newPage();
    const logs = (report.console[p] ??= []);
    page.on("console", (m) => {
      if ((m.type() === "error" || m.type() === "warn") && logs.length < 30) logs.push(short(m.text()));
    });
    page.on("pageerror", (e) => {
      if (logs.length < 30) logs.push(short(e.message));
    });
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    try {
      await page.setViewport({ width, height: width < 600 ? 844 : 800, isMobile: width < 600, hasTouch: width < 600, deviceScaleFactor: 1 });
      const resp = await page.goto(BASE + clean(p), { waitUntil: "load", timeout: 8000 });
      if (resp && resp.status() === 404) {
        report.shots.push({ page: p, width, missing: true });
        continue;
      }
      await sleep(700);
      const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0));
      const height = Math.max(200, Math.min(full, Number(shots.maxHeight) || 2400));
      const jpeg = await page.screenshot({ type: "jpeg", quality: Number(shots.quality) || 60, clip: { x: 0, y: 0, width, height }, captureBeyondViewport: true });
      report.shots.push({ page: p, width, height, jpeg: Buffer.from(jpeg).toString("base64") });
    } catch (err) {
      report.shots.push({ page: p, width, error: short(err.message) });
    } finally {
      await page.close().catch(() => {});
    }
  }
}

await browser.close().catch(() => {});
server.close();
emit();
process.exit(0);

import crypto from "crypto";
import { PassThrough } from "stream";
import type Docker from "dockerode";
import { docker, ensureImage } from "../executor/dockerExecutor";
import { tarOf, type TarEntry } from "./tar";

/**
 * Live student sites for PHP and full-stack practicals (SparkMentis, owner
 * 2026-10-20: "A live site per student"): one container per (attempt,
 * question) running the question's MariaDB and PHP's server, as in XAMPP.
 * No network; requests and database views go in through `docker exec`.
 * A site pauses (is removed) after its idle time, and a cap keeps the shared
 * host safe — over it, the least recently used idle site makes room, or the
 * caller is told to wait a few seconds.
 */

const IMAGE = "sparkmentis-lamp-runner:1";
const LABEL = "sparkmentis.sandbox";
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const IDLE_MS = num(process.env["SANDBOX_IDLE_MS"], 10 * 60_000);
const MAX_LIVE = num(process.env["SANDBOX_MAX"], 30);
const MEMORY = num(process.env["SANDBOX_MEMORY_MB"], 256) * 1024 * 1024;
/** A site used within this long isn't evicted to make room. */
const EVICT_IDLE_MS = 90_000;

export type SandboxSpec = {
  key: string;
  /** Served under http://localhost/<folder>/, as in XAMPP's htdocs. */
  folder: string;
  /** The question's database: its name and the SQL that creates it (CREATE DATABASE, USE, tables, rows). */
  database: { name: string; sql: string } | null;
};

export type SandboxFiles = {
  files: Record<string, string>;
  /** Binary files by path; `data` (base64) only when the site doesn't have that key yet. */
  assets: Array<{ path: string; key: string; data?: string }>;
};

type Sandbox = {
  key: string;
  name: string;
  container: Docker.Container;
  folder: string;
  dbName: string | null;
  textPaths: Set<string>;
  assets: Map<string, string>;
  lastUsed: number;
  busy: number;
  ready: Promise<{ dbOk: boolean | null; dbLog: string }>;
  /** Binary files the first copy-in had no data for. */
  initialMissing: string[];
};

const live = new Map<string, Sandbox>();
const starting = new Map<string, Promise<Sandbox>>();

export class SandboxBusyError extends Error {}
export class SandboxMissingError extends Error {}

const nameOf = (key: string) => `sbx-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 24)}`;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_][A-Za-z0-9_. \-/]*$/;
const safePath = (p: string) => SAFE_PATH.test(p) && !p.startsWith("/") && p.length <= 240;

/** Runs a command in the site with `input` on stdin; output as text. */
async function execIn(container: Docker.Container, cmd: string[], input: string | Buffer, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const exec = await container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: false });
  const stream = (await exec.start({ hijack: true, stdin: true })) as NodeJS.ReadWriteStream;
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.on("data", (c: Buffer) => out.push(c));
  stderr.on("data", (c: Buffer) => err.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  const done = new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("close", resolve);
    stream.on("error", reject);
  });
  stream.write(input);
  stream.end();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([done.then(() => false), new Promise<boolean>((r) => (timer = setTimeout(() => r(true), timeoutMs)))]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    (stream as unknown as { destroy?: () => void }).destroy?.();
    return { stdout: "", stderr: "timed out", exitCode: null };
  }
  const info = await exec.inspect().catch(() => null);
  return { stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), exitCode: info?.ExitCode ?? null };
}

/**
 * Copies files in under /tmp. Docker's own copy (putArchive) refuses a
 * read-only root even for a tmpfs path, so the archive is streamed to `tar`
 * inside the site; ownership isn't restored (no capabilities to chown).
 */
async function copyIn(container: Docker.Container, entries: TarEntry[]): Promise<void> {
  const r = await execIn(container, ["tar", "-x", "-C", "/tmp", "-f", "-", "--no-same-owner", "--no-same-permissions"], tarOf(entries), 30_000);
  if (r.exitCode !== 0) throw new Error(`Copying the files in failed: ${r.stderr.slice(0, 300)}`);
}

async function removeContainer(name: string): Promise<void> {
  try {
    await docker.getContainer(name).remove({ force: true });
  } catch {
    /* gone already */
  }
}

/** Makes room under the cap: removes the least recently used site idle long enough, or says it's busy. */
async function makeRoom(): Promise<void> {
  if (live.size + starting.size < MAX_LIVE) return;
  const idle = [...live.values()].filter((s) => s.busy === 0 && Date.now() - s.lastUsed > EVICT_IDLE_MS).sort((a, b) => a.lastUsed - b.lastUsed);
  if (idle.length === 0) throw new SandboxBusyError("All live sites are in use — try again in a few seconds");
  await stopSandbox(idle[0].key);
}

async function create(spec: SandboxSpec, initial: SandboxFiles): Promise<Sandbox> {
  await makeRoom();
  await ensureImage(IMAGE);
  const name = nameOf(spec.key);
  await removeContainer(name);
  const container = await docker.createContainer({
    name,
    Image: IMAGE,
    Entrypoint: ["/bin/bash"],
    Cmd: ["/opt/sbx/boot.sh"],
    Labels: { [LABEL]: "1" },
    HostConfig: {
      NetworkMode: "none",
      Memory: MEMORY,
      MemorySwap: MEMORY,
      PidsLimit: 256,
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=192m" },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      AutoRemove: false,
    },
  });
  await container.start();
  const s: Sandbox = {
    key: spec.key,
    name,
    container,
    folder: spec.folder,
    dbName: spec.database?.name ?? null,
    textPaths: new Set(),
    assets: new Map(),
    lastUsed: Date.now(),
    busy: 0,
    ready: Promise.resolve({ dbOk: null, dbLog: "" }),
    initialMissing: [],
  };
  const entries: TarEntry[] = [{ name: "init/folder", data: Buffer.from(spec.folder) }];
  if (spec.database) {
    entries.push({ name: "init/dbname", data: Buffer.from(spec.database.name) }, { name: "init/db.sql", data: Buffer.from(spec.database.sql) });
  }
  entries.push(...fileEntries(s, initial, s.initialMissing));
  entries.push({ name: "init/go", data: Buffer.from("1") });
  await copyIn(container, entries);
  s.ready = (async () => {
    const r = await execIn(container, ["bash", "-c", "for i in $(seq 1 600); do [ -f /tmp/init/ready ] && break; sleep 0.05; done; [ -f /tmp/init/ready ] || exit 1; cat /tmp/init/db-load.status 2>/dev/null; echo; tail -c 3000 /tmp/init/db-load.log 2>/dev/null"], "", 45_000);
    if (r.exitCode !== 0) throw new Error("The site didn't start in time");
    const [status, ...log] = r.stdout.split("\n");
    return { dbOk: spec.database ? status.trim() === "0" : null, dbLog: log.join("\n").trim() };
  })();
  return s;
}

/** Tar entries for the files that changed, and the bookkeeping of what the site now holds. */
function fileEntries(s: Sandbox, sync: SandboxFiles, missing: string[] = []): TarEntry[] {
  const root = `www/${s.folder}`;
  const entries: TarEntry[] = [{ name: root, dir: true }];
  s.textPaths = new Set();
  for (const [path, text] of Object.entries(sync.files)) {
    if (!safePath(path)) continue;
    entries.push({ name: `${root}/${path}`, data: Buffer.from(text, "utf8") });
    s.textPaths.add(path);
  }
  for (const a of sync.assets) {
    if (!safePath(a.path) || s.assets.get(a.path) === a.key) continue;
    if (a.data == null) {
      missing.push(a.path);
      continue;
    }
    entries.push({ name: `${root}/${a.path}`, data: Buffer.from(a.data, "base64") });
    s.assets.set(a.path, a.key);
  }
  return entries;
}

/** Copies the project in: text files every time, binary files only when new; removes what's gone. */
async function syncFiles(s: Sandbox, sync: SandboxFiles): Promise<string[]> {
  const before = new Set([...s.textPaths, ...s.assets.keys()]);
  const missing: string[] = [];
  const entries = fileEntries(s, sync, missing);
  const keep = new Set([...Object.keys(sync.files), ...sync.assets.map((a) => a.path)]);
  const gone = [...before].filter((p) => !keep.has(p) && safePath(p));
  for (const p of gone) s.assets.delete(p);
  if (gone.length) {
    const quoted = gone.map((p) => `'/tmp/www/${s.folder}/${p.replace(/'/g, "")}'`).join(" ");
    await execIn(s.container, ["bash", "-c", `rm -f ${quoted}`], "", 10_000);
  }
  await copyIn(s.container, entries);
  return missing;
}

/** Starts the site when it isn't running (or its folder or database changed), then copies the files in. */
export async function ensureSandbox(spec: SandboxSpec, files: SandboxFiles): Promise<{ created: boolean; missingAssets: string[]; dbOk: boolean | null; dbLog: string }> {
  let s = live.get(spec.key);
  if (s && (s.folder !== spec.folder || s.dbName !== (spec.database?.name ?? null))) {
    await stopSandbox(spec.key);
    s = undefined;
  }
  let created = false;
  if (!s) {
    let pending = starting.get(spec.key);
    if (!pending) {
      pending = create(spec, files);
      starting.set(spec.key, pending);
      created = true;
    }
    try {
      s = await pending;
      live.set(spec.key, s);
    } finally {
      starting.delete(spec.key);
    }
  }
  s.lastUsed = Date.now();
  s.busy++;
  try {
    const missingAssets = created ? s.initialMissing : await syncFiles(s, files);
    const boot = await s.ready;
    return { created, missingAssets, ...boot };
  } finally {
    s.busy--;
  }
}

async function use<T>(key: string, fn: (s: Sandbox) => Promise<T>): Promise<T> {
  const s = live.get(key);
  if (!s) throw new SandboxMissingError("The site isn't running — open the question again");
  s.lastUsed = Date.now();
  s.busy++;
  try {
    await s.ready;
    return await fn(s);
  } finally {
    s.busy--;
    s.lastUsed = Date.now();
  }
}

const parseJson = (r: { stdout: string; stderr: string }) => {
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { error: (r.stderr || r.stdout || "The site didn't answer").slice(0, 500) };
  }
};

/** One HTTP request to the site, from inside it (see runners/lamp/sbx/request.php). */
export async function sandboxRequest(key: string, req: unknown): Promise<unknown> {
  return use(key, async (s) => parseJson(await execIn(s.container, ["php", "/opt/sbx/request.php"], JSON.stringify(req), 25_000)));
}

/** The site's database: tables, rows, a query, or a reset to the question's rows (runners/lamp/sbx/db.php). */
export async function sandboxDb(key: string, req: unknown): Promise<unknown> {
  return use(key, async (s) => parseJson(await execIn(s.container, ["php", "/opt/sbx/db.php"], JSON.stringify(req), 20_000)));
}

export async function stopSandbox(key: string): Promise<boolean> {
  const s = live.get(key);
  live.delete(key);
  await removeContainer(s?.name ?? nameOf(key));
  return !!s;
}

export function sandboxStats(): { live: number; starting: number; max: number; idleMs: number } {
  return { live: live.size, starting: starting.size, max: MAX_LIVE, idleMs: IDLE_MS };
}

/** Sites left from before a restart are gone from memory: remove them. */
export async function cleanupSandboxes(): Promise<number> {
  const list = await docker.listContainers({ all: true, filters: { label: [`${LABEL}=1`] } });
  await Promise.all(list.map((c) => removeContainer(c.Id)));
  return list.length;
}

/** Pauses (removes) sites idle past their time, every 30 s. */
export function startSandboxReaper(): NodeJS.Timeout {
  return setInterval(() => {
    for (const s of live.values()) {
      if (s.busy === 0 && Date.now() - s.lastUsed > IDLE_MS) {
        void stopSandbox(s.key).then(() => console.log(`Sandbox ${s.name} paused after ${Math.round(IDLE_MS / 60000)} idle minutes`));
      }
    }
  }, 30_000);
}

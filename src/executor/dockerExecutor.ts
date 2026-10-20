import Docker from "dockerode";
import fs from "fs/promises";
import path from "path";
import { CaseResult, ExecutionJobData, ExecutionResult } from "../types/index";
import { BROWSER_RUNNER, languageConfigs } from "../config/languages";
import { collectOutput } from "./outputCollector";

export const docker = new Docker({ socketPath: process.env["DOCKER_SOCKET"] ?? "/var/run/docker.sock" });
// The same path inside this container and on the host: it is bind-mounted
// here, and each job's folder is bind-mounted into the job's own container.
const JOBS_DIR = process.env["JOBS_DIR"] ?? "/tmp/jobs";
const RUN_TIMEOUT_MS = 10_000;
const COMPILE_TIMEOUT_MS = 15_000;
const MEMORY_BYTES = 128 * 1024 * 1024;
const PIDS_LIMIT = 128;

/**
 * Runner images we build ourselves, while they build. Builds run in the
 * background at startup (a new runner can take minutes), so the service — and
 * SparkMentor's PDFs and transcripts, which share it — answers at once; a job
 * that needs one still building waits for it.
 */
const building = new Map<string, Promise<void>>();

export async function prePullImages(): Promise<void> {
  const configs: Array<{ image: string; build?: string }> = [...Object.values(languageConfigs), BROWSER_RUNNER];
  const built = new Map(configs.filter((c) => c.build).map((c) => [c.image, c.build as string]));
  const images = [...new Set(configs.map((c) => c.image))];

  console.log(`Pre-pulling ${images.length} Docker images...`);

  await Promise.all(
    images.map(async (image) => {
      try {
        const runner = built.get(image);
        if (runner) {
          // Ours, not on a registry: build it when missing (e.g. after a prune).
          if (await hasImage(image)) return console.log(`Present: ${image}`);
          console.log(`Building ${image} from runners/${runner} in the background...`);
          const job = buildRunnerImage(image, runner)
            .then(() => console.log(`Built: ${image}`))
            .catch((err) => console.warn(`Failed to build ${image}:`, (err as Error).message))
            .finally(() => building.delete(image));
          building.set(image, job);
          return;
        }
        await pullImage(image);
        console.log(`Pulled: ${image}`);
      } catch (err) {
        console.warn(`Failed to pull ${image}:`, (err as Error).message);
      }
    })
  );
}

/** Waits while an image of ours is still being built. */
export async function ensureImage(image: string): Promise<void> {
  const job = building.get(image);
  if (job) await job;
}

async function hasImage(image: string): Promise<boolean> {
  try {
    await docker.getImage(image).inspect();
    return true;
  } catch {
    return false;
  }
}

const RUNNERS_DIR = path.resolve(__dirname, "../../runners");

/** Every file under a runner's folder, relative to it (the build context). */
async function contextFiles(dir: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await contextFiles(dir, rel)));
    else out.push(rel);
  }
  return out;
}

async function buildRunnerImage(image: string, runner: string): Promise<void> {
  const context = path.join(RUNNERS_DIR, runner);
  const src = await contextFiles(context);
  return new Promise((resolve, reject) => {
    docker.buildImage({ context, src }, { t: image }, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) return reject(err ?? new Error("no build output"));
      docker.modem.followProgress(stream, (err2: Error | null, output: Array<{ error?: string }>) => {
        const failed = err2?.message ?? output?.find((o) => o.error)?.error;
        if (failed) return reject(new Error(failed));
        resolve();
      });
    });
  });
}

function pullImage(image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2: Error | null) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

async function runContainer(
  image: string,
  cmd: string[],
  jobDir: string,
  readOnly: boolean,
  timeoutMs: number,
  opts: { memoryBytes?: number; tmpfs?: Record<string, string>; env?: string[]; pidsLimit?: number; maxOutputBytes?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  const memory = opts.memoryBytes ?? MEMORY_BYTES;
  await ensureImage(image);
  const container = await docker.createContainer({
    Image: image,
    Cmd: cmd,
    WorkingDir: "/code",
    ...(opts.env?.length ? { Env: opts.env } : {}),
    HostConfig: {
      Binds: [`${jobDir}:/code${readOnly ? ":ro" : ":z"}`],
      ...(opts.tmpfs ? { Tmpfs: opts.tmpfs } : {}),
      Memory: memory,
      MemorySwap: memory,
      PidsLimit: opts.pidsLimit ?? PIDS_LIMIT,
      NetworkMode: "none",
      AutoRemove: true,
      ReadonlyRootfs: readOnly,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
    },
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });

  const stream = await container.attach({
    stream: true,
    stdout: true,
    stderr: true,
  });

  await container.start();

  let timedOut = false;

  const outputPromise = collectOutput(container, stream as NodeJS.ReadableStream, opts.maxOutputBytes);
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => {
      timedOut = true;
      resolve(null);
    }, timeoutMs)
  );

  const raceResult = await Promise.race([outputPromise, timeoutPromise]);

  if (timedOut) {
    try {
      await container.kill();
    } catch {
      // container may already be gone
    }
    return { stdout: "", stderr: "Execution timed out.", exitCode: null, timedOut: true };
  }

  const { stdout, stderr } = raceResult!;

  let exitCode: number | null = null;
  try {
    const info = await container.inspect();
    exitCode = info.State.ExitCode ?? null;
  } catch {
    // container already removed by AutoRemove
  }

  return { stdout, stderr, exitCode, timedOut: false };
}

/** A job's own folder, shared with its containers. */
async function makeJobDir(jobId: string): Promise<string> {
  const jobDir = path.join(JOBS_DIR, jobId);
  // Not recursive: when the jobs folder is gone on the host (systemd-tmpfiles
  // ages out /tmp), a recursive mkdir under the stale mount never settles and
  // the job hangs "active" forever. This way the job fails, and says why.
  try {
    await fs.mkdir(jobDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`The jobs folder ${JOBS_DIR} is missing on the host; restart the executor (docker compose up -d)`);
    }
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  await fs.chmod(jobDir, 0o777);
  return jobDir;
}

// Program mode: each case's output is cut at this size.
const CASE_OUTPUT_BYTES = 64 * 1024;
const MAX_CASES = 50;

const shellQuote = (s: string) => (/^[A-Za-z0-9_./=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** Program mode's script: every case's stdin from in/<i>, its output base64 between markers. */
function casesScript(runCmd: string[], count: number, perCaseSec: number): string {
  const run = runCmd.map(shellQuote).join(" ");
  return [
    "#!/bin/sh",
    "cd /code",
    "i=0",
    `while [ $i -lt ${count} ]; do`,
    `  timeout -s KILL ${perCaseSec} ${run} < "in/$i" > /tmp/out 2> /tmp/err`,
    "  code=$?",
    '  echo "@@SPARK_CASE $i $code"',
    `  head -c ${CASE_OUTPUT_BYTES} /tmp/out | base64 | tr -d '\\n'; echo`,
    `  head -c ${CASE_OUTPUT_BYTES} /tmp/err | base64 | tr -d '\\n'; echo`,
    "  i=$((i+1))",
    "done",
    'echo "@@SPARK_END"',
    "",
  ].join("\n");
}

/** One result per case from the script's output; a case the run never reached timed out. */
export function parseCases(stdout: string, count: number): CaseResult[] {
  const lines = stdout.split("\n");
  const out: CaseResult[] = Array.from({ length: count }, () => ({ stdout: "", stderr: "", exitCode: null, timedOut: true }));
  for (let i = 0; i < lines.length; i++) {
    const m = /^@@SPARK_CASE (\d+) (\d+)$/.exec(lines[i].trim());
    if (!m) continue;
    const idx = Number(m[1]);
    const code = Number(m[2]);
    if (idx >= count) continue;
    const decode = (b: string | undefined) => Buffer.from((b ?? "").trim(), "base64").toString("utf8");
    // 124: coreutils' own timeout code; 137/143: killed (busybox and coreutils with -s KILL).
    const timedOut = code === 124 || code === 137 || code === 143;
    out[idx] = { stdout: decode(lines[i + 1]), stderr: decode(lines[i + 2]), exitCode: timedOut ? null : code, timedOut };
  }
  return out;
}

export async function runInDocker(
  jobId: string,
  data: ExecutionJobData
): Promise<ExecutionResult> {
  const langConfig = languageConfigs[data.language];
  const jobDir = await makeJobDir(jobId);
  await fs.writeFile(path.join(jobDir, langConfig.filename), data.code, "utf8");
  const cases = data.cases?.slice(0, MAX_CASES);

  const start = Date.now();

  try {
    if (langConfig.compileCmd) {
      const compile = await runContainer(
        langConfig.image,
        langConfig.compileCmd,
        jobDir,
        false,
        langConfig.compileTimeoutMs ?? COMPILE_TIMEOUT_MS,
        { memoryBytes: langConfig.memoryBytes, env: langConfig.env, tmpfs: langConfig.tmpfs, pidsLimit: langConfig.pidsLimit }
      );

      if (compile.timedOut || (compile.exitCode !== null && compile.exitCode !== 0)) {
        return {
          stdout: compile.stdout,
          stderr: compile.stderr,
          exitCode: compile.exitCode,
          timedOut: compile.timedOut,
          executionTimeMs: Date.now() - start,
        };
      }
    }

    if (cases) {
      const perCaseSec = Math.max(1, Math.min(15, Math.ceil((data.caseTimeoutMs ?? 5000) / 1000)));
      await fs.mkdir(path.join(jobDir, "in"));
      await Promise.all(cases.map((c, i) => fs.writeFile(path.join(jobDir, "in", String(i)), c.stdin ?? "", "utf8")));
      await fs.writeFile(path.join(jobDir, "cases.sh"), casesScript(langConfig.runCmd, cases.length, perCaseSec), "utf8");
      const run = await runContainer(
        langConfig.image,
        ["sh", "/code/cases.sh"],
        jobDir,
        !langConfig.compileCmd,
        Math.min(150_000, cases.length * (perCaseSec * 1000 + 1500) + 5000),
        {
          memoryBytes: langConfig.memoryBytes,
          env: langConfig.env,
          tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m", ...(langConfig.tmpfs ?? {}) },
          pidsLimit: langConfig.pidsLimit,
          maxOutputBytes: 8 * 1024 * 1024,
        }
      );
      return {
        stdout: run.timedOut ? "" : run.stdout.split("@@SPARK_CASE")[0],
        stderr: run.stderr,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        executionTimeMs: Date.now() - start,
        cases: parseCases(run.stdout, cases.length),
      };
    }

    const run = await runContainer(
      langConfig.image,
      langConfig.runCmd,
      jobDir,
      !langConfig.compileCmd,
      langConfig.runTimeoutMs ?? RUN_TIMEOUT_MS,
      { memoryBytes: langConfig.memoryBytes, tmpfs: langConfig.tmpfs, env: langConfig.env, pidsLimit: langConfig.pidsLimit }
    );

    return {
      stdout: run.stdout,
      stderr: run.stderr,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      executionTimeMs: Date.now() - start,
    };
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}

/** A browser run for a web practical (runners/browser): its checks and screenshots, as the runner's JSON. */
export async function runBrowserJob(jobId: string, payload: string): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  const jobDir = await makeJobDir(jobId);
  try {
    await fs.writeFile(path.join(jobDir, "job.json"), payload, "utf8");
    return await runContainer(BROWSER_RUNNER.image, ["node", "/opt/runner/run.mjs", "/code/job.json"], jobDir, true, 170_000, {
      memoryBytes: BROWSER_RUNNER.memoryBytes,
      tmpfs: { ...BROWSER_RUNNER.tmpfs },
      pidsLimit: BROWSER_RUNNER.pidsLimit,
      env: ["HOME=/tmp", "CHROME_PATH=/usr/bin/chromium"],
      maxOutputBytes: 32 * 1024 * 1024,
    });
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true });
  }
}

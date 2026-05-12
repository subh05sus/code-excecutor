import Docker from "dockerode";
import fs from "fs/promises";
import path from "path";
import { ExecutionJobData, ExecutionResult } from "../types/index";
import { languageConfigs } from "../config/languages";
import { collectOutput } from "./outputCollector";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const JOBS_DIR = "/tmp/jobs";
const RUN_TIMEOUT_MS = 10_000;
const COMPILE_TIMEOUT_MS = 15_000;
const MEMORY_BYTES = 128 * 1024 * 1024;

export async function prePullImages(): Promise<void> {
  const configs = Object.values(languageConfigs);
  const images = [...new Set(configs.map((c) => c.image))];

  console.log(`Pre-pulling ${images.length} Docker images...`);

  await Promise.all(
    images.map(async (image) => {
      try {
        await pullImage(image);
        console.log(`Pulled: ${image}`);
      } catch (err) {
        console.warn(`Failed to pull ${image}:`, (err as Error).message);
      }
    })
  );
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
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  const container = await docker.createContainer({
    Image: image,
    Cmd: cmd,
    WorkingDir: "/code",
    HostConfig: {
      Binds: [`${jobDir}:/code${readOnly ? ":ro" : ""}`],
      Memory: MEMORY_BYTES,
      MemorySwap: MEMORY_BYTES,
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

  const outputPromise = collectOutput(container, stream as NodeJS.ReadableStream);
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

export async function runInDocker(
  jobId: string,
  data: ExecutionJobData
): Promise<ExecutionResult> {
  const langConfig = languageConfigs[data.language];
  const jobDir = path.join(JOBS_DIR, jobId);

  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(jobDir, langConfig.filename), data.code, "utf8");

  const start = Date.now();

  try {
    if (langConfig.compileCmd) {
      const compile = await runContainer(
        langConfig.image,
        langConfig.compileCmd,
        jobDir,
        false,
        COMPILE_TIMEOUT_MS
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

    const run = await runContainer(
      langConfig.image,
      langConfig.runCmd,
      jobDir,
      !langConfig.compileCmd,
      RUN_TIMEOUT_MS
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

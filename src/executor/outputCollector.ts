import { PassThrough } from "stream";
import Docker from "dockerode";

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB

export interface CollectedOutput {
  stdout: string;
  stderr: string;
}

export async function collectOutput(
  container: Docker.Container,
  stream: NodeJS.ReadableStream
): Promise<CollectedOutput> {
  const stdoutPass = new PassThrough();
  const stderrPass = new PassThrough();

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutSize = 0;
  let stderrSize = 0;
  let truncatedStdout = false;
  let truncatedStderr = false;

  stdoutPass.on("data", (chunk: Buffer) => {
    if (stdoutSize < MAX_OUTPUT_BYTES) {
      const remaining = MAX_OUTPUT_BYTES - stdoutSize;
      stdoutChunks.push(chunk.slice(0, remaining));
      stdoutSize += chunk.length;
      if (stdoutSize >= MAX_OUTPUT_BYTES) truncatedStdout = true;
    }
  });

  stderrPass.on("data", (chunk: Buffer) => {
    if (stderrSize < MAX_OUTPUT_BYTES) {
      const remaining = MAX_OUTPUT_BYTES - stderrSize;
      stderrChunks.push(chunk.slice(0, remaining));
      stderrSize += chunk.length;
      if (stderrSize >= MAX_OUTPUT_BYTES) truncatedStderr = true;
    }
  });

  container.modem.demuxStream(stream, stdoutPass, stderrPass);

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  stdoutPass.end();
  stderrPass.end();

  let stdout = Buffer.concat(stdoutChunks).toString("utf8");
  let stderr = Buffer.concat(stderrChunks).toString("utf8");

  if (truncatedStdout) stdout += "\n[output truncated]";
  if (truncatedStderr) stderr += "\n[output truncated]";

  return { stdout, stderr };
}

export type SupportedLanguage =
  | "javascript"
  | "python"
  | "java"
  | "cpp"
  | "go"
  | "rust"
  | "php"
  | "ruby"
  | "sql";

export interface LanguageConfig {
  image: string;
  filename: string;
  compileCmd?: string[];
  runCmd: string[];
  /** Memory cap for the run container (default 128 MB). tmpfs pages count toward it. */
  memoryBytes?: number;
  /** Writable tmpfs mounts for the run container; the root filesystem stays read-only. */
  tmpfs?: Record<string, string>;
  /** Run time limit (default 10 s). */
  runTimeoutMs?: number;
}

export interface ExecutionJobData {
  language: SupportedLanguage;
  code: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  executionTimeMs: number;
}

export type JobStatusResponse =
  | { status: "waiting" | "active" | "delayed" | "unknown" }
  | { status: "completed"; result: ExecutionResult }
  | { status: "failed"; error: string };

export type SupportedLanguage =
  | "javascript"
  | "python"
  | "java"
  | "cpp"
  | "c"
  | "csharp"
  | "go"
  | "rust"
  | "php"
  | "ruby"
  | "sql"
  | "lamp";

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
  /** Built here, not pulled: the folder under runners/ holding its Dockerfile. */
  build?: string;
  /** Environment for the compile and run containers. */
  env?: string[];
  /** Compile time limit (default 15 s). */
  compileTimeoutMs?: number;
  /** Most processes a run may start (default 128). */
  pidsLimit?: number;
}

export interface ExecutionJobData {
  language: SupportedLanguage;
  code: string;
  /** Program mode (practical exams): compile once, then run once per case with its stdin. */
  cases?: Array<{ stdin: string }>;
  /** Time limit per case in program mode (default 5 s, at most 15 s). */
  caseTimeoutMs?: number;
}

export interface CaseResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  executionTimeMs: number;
  /** Program mode: one result per case, in order (absent when it didn't compile). */
  cases?: CaseResult[];
}

export type JobStatusResponse =
  | { status: "waiting" | "active" | "delayed" | "unknown" }
  | { status: "completed"; result: ExecutionResult }
  | { status: "failed"; error: string };

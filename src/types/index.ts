export type SupportedLanguage =
  | "javascript"
  | "python"
  | "java"
  | "cpp"
  | "go"
  | "rust"
  | "php"
  | "ruby";

export interface LanguageConfig {
  image: string;
  filename: string;
  compileCmd?: string[];
  runCmd: string[];
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

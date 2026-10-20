import { LanguageConfig, SupportedLanguage } from "../types/index";

export const SUPPORTED_LANGUAGES = new Set<SupportedLanguage>([
  "javascript",
  "python",
  "java",
  "cpp",
  "c",
  "csharp",
  "go",
  "rust",
  "php",
  "ruby",
  "sql",
  "lamp",
]);

export const languageConfigs: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    image: "node:20-alpine",
    filename: "solution.js",
    runCmd: ["node", "solution.js"],
  },
  python: {
    image: "python:3.12-alpine",
    filename: "solution.py",
    runCmd: ["python", "solution.py"],
  },
  java: {
    // Docker Hub dropped the openjdk images (openjdk:21-slim 404s since mid-2025); Temurin is the maintained OpenJDK build.
    image: "eclipse-temurin:21-jdk-alpine",
    filename: "Main.java",
    compileCmd: ["javac", "Main.java"],
    runCmd: ["java", "Main"],
  },
  cpp: {
    image: "gcc:14",
    filename: "solution.cpp",
    compileCmd: ["g++", "-std=c++20", "-o", "solution", "solution.cpp"],
    runCmd: ["./solution"],
  },
  c: {
    image: "gcc:14",
    filename: "solution.c",
    compileCmd: ["gcc", "-O2", "-std=gnu17", "-o", "solution", "solution.c", "-lm"],
    runCmd: ["./solution"],
  },
  // Practical exams (2026-10-20): Roslyn's csc straight from the SDK, ~2 s a file
  // (runners/csharp). The runtime needs a writable HOME for its caches.
  csharp: {
    image: "sparkmentis-csharp-runner:8",
    build: "csharp",
    filename: "solution.cs",
    compileCmd: ["csc-compile", "solution.cs", "solution.dll"],
    runCmd: ["dotnet", "solution.dll"],
    env: ["HOME=/tmp", "DOTNET_CLI_TELEMETRY_OPTOUT=1", "DOTNET_NOLOGO=1", "DOTNET_gcServer=0", "DOTNET_GCHeapHardLimit=0xC000000"],
    tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m" },
    memoryBytes: 640 * 1024 * 1024,
    compileTimeoutMs: 40_000,
  },
  // `go run` needed a writable /tmp (it failed on the read-only root) and
  // compiled the standard library cold every time (~10 s). The runner image
  // has a warm build cache; the build step writes to the container's own
  // layer, so only the student's file is compiled.
  go: {
    image: "sparkmentis-go-runner:1.22",
    build: "go",
    filename: "solution.go",
    compileCmd: ["go", "build", "-o", "solution", "solution.go"],
    runCmd: ["./solution"],
  },
  rust: {
    image: "rust:1.78-slim",
    filename: "solution.rs",
    compileCmd: ["rustc", "-o", "solution", "solution.rs"],
    runCmd: ["./solution"],
  },
  php: {
    image: "php:8.3-cli-alpine",
    filename: "solution.php",
    runCmd: ["php", "solution.php"],
    // Website projects: the runner writes the project and PHP's session files
    // here, then serves it with `php -S` on loopback.
    tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=32m" },
    runTimeoutMs: 20_000,
  },
  ruby: {
    image: "ruby:3.3-alpine",
    filename: "solution.rb",
    runCmd: ["ruby", "solution.rb"],
  },
  // SQL exams: run.sh boots a throwaway MariaDB (MySQL dialect, as in XAMPP)
  // on this tmpfs, loads each dataset into its own database and runs the
  // student's SQL against it. Nothing persists past the run.
  sql: {
    image: "mariadb:11.4",
    filename: "run.sh",
    runCmd: ["bash", "run.sh"],
    tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=192m" },
    memoryBytes: 384 * 1024 * 1024,
    runTimeoutMs: 25_000,
  },
  // Full-stack practicals (2026-10-20): the app's run.sh boots the question's
  // MariaDB on /tmp, loads its tables and rows, and replays the checks against
  // PHP's server (runners/lamp: MariaDB 11.4 + PHP 8.3 with mysqli and PDO).
  lamp: {
    image: "sparkmentis-lamp-runner:1",
    build: "lamp",
    filename: "run.sh",
    runCmd: ["bash", "run.sh"],
    tmpfs: { "/tmp": "rw,nosuid,nodev,size=256m" },
    memoryBytes: 512 * 1024 * 1024,
    runTimeoutMs: 45_000,
  },
};

/** Not a language: the browser runner for web practicals' checks and screenshots (runners/browser). */
export const BROWSER_RUNNER = {
  image: "sparkmentis-browser-runner:1",
  build: "browser",
  memoryBytes: 1024 * 1024 * 1024,
  tmpfs: { "/tmp": "rw,nosuid,nodev,size=384m" },
  pidsLimit: 512,
} as const;

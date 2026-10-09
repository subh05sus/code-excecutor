import { LanguageConfig, SupportedLanguage } from "../types/index";

export const SUPPORTED_LANGUAGES = new Set<SupportedLanguage>([
  "javascript",
  "python",
  "java",
  "cpp",
  "go",
  "rust",
  "php",
  "ruby",
  "sql",
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
    image: "openjdk:21-slim",
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
  go: {
    image: "golang:1.22-alpine",
    filename: "solution.go",
    runCmd: ["go", "run", "solution.go"],
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
};

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
    compileCmd: ["g++", "-o", "solution", "solution.cpp"],
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
  },
  ruby: {
    image: "ruby:3.3-alpine",
    filename: "solution.rb",
    runCmd: ["ruby", "solution.rb"],
  },
};

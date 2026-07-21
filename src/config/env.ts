function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  internalToken: requireEnv("INTERNAL_TOKEN"),
  port: parseInt(process.env["PORT"] ?? "3000", 10),
  redis: {
    host: process.env["REDIS_HOST"] ?? "ec2-52-7-14-144.compute-1.amazonaws.com",
    port: parseInt(process.env["REDIS_PORT"] ?? "6379", 10),
    username: process.env["REDIS_USERNAME"] ?? "default",
    password: process.env["REDIS_PASSWORD"] ?? "meow1234",
  },
  transcript: {
    // Callbacks INTO SparkMentis reuse the shared INTERNAL_TOKEN (config.internalToken).
    workerConcurrency: parseInt(process.env["TRANSCRIPT_WORKER_CONCURRENCY"] ?? "3", 10),
  },
};

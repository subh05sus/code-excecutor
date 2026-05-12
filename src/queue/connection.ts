import IORedis from "ioredis";
import { config } from "../config/env";

export const redisConnection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  username: config.redis.username,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

import { env } from "../env";

export const isRedisEnabled = env.REDIS_ENABLED;

type RedisClient = any;

let client: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (!isRedisEnabled) {
    throw new Error("Redis is not enabled");
  }
  if (client) return client;
  
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require("ioredis");
  
  const url = env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not configured");
  }
  client = new Redis(url, {
    lazyConnect: true
  });
  return client;
}

import { createLogger } from "@rezovo/logging";
import { isRedisEnabled, getRedisClient } from "../../redis/client";
import { RedisKeys, RedisTTL } from "./redisKeys";

const logger = createLogger({ service: "realtime-core", module: "sessionStore" });

export class SessionStore {
  private redis: ReturnType<typeof getRedisClient> | null = null;

  constructor() {
    try {
      if (isRedisEnabled) {
        this.redis = getRedisClient();
      }
    } catch {
      logger.warn("Redis not available, guardrail counters are in memory-only mode");
    }
  }

  async incrementWarnCount(callId: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const key = RedisKeys.warnCount(callId);
      const count = await this.redis.incr(key);
      await this.redis.expire(key, RedisTTL.GUARDRAIL_WARN);
      return count;
    } catch {
      return 0;
    }
  }
}

export const sessionStore = new SessionStore();

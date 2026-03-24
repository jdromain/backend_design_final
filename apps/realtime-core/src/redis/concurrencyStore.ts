import { createLogger } from "@rezovo/logging";
import { getRedisClient, isRedisEnabled } from "./client";

const logger = createLogger({ service: "realtime-core", module: "concurrencyStore" });

const localCounts = new Map<string, number>();

function redisKey(tenantId: string): string {
  return `tenant:concurrency:${tenantId}`;
}

export async function acquireTenantSlot(
  tenantId: string,
  limit: number
): Promise<{ allowed: boolean; active: number }> {
  if (isRedisEnabled) {
    try {
      const redis = getRedisClient();
      const key = redisKey(tenantId);
      const active = await redis.incr(key);
      if (active > limit) {
        await redis.decr(key);
        return { allowed: false, active: active - 1 };
      }
      return { allowed: true, active };
    } catch (err) {
      logger.warn("redis acquireTenantSlot failed, falling back to local map", { error: (err as Error).message });
    }
  }

  const active = (localCounts.get(tenantId) ?? 0) + 1;
  if (active > limit) {
    return { allowed: false, active: active - 1 };
  }
  localCounts.set(tenantId, active);
  return { allowed: true, active };
}

export async function releaseTenantSlot(tenantId: string): Promise<void> {
  if (isRedisEnabled) {
    try {
      const redis = getRedisClient();
      const key = redisKey(tenantId);
      await redis.decr(key);
      return;
    } catch (err) {
      logger.warn("redis releaseTenantSlot failed, falling back to local map", { error: (err as Error).message });
    }
  }

  const active = localCounts.get(tenantId) ?? 0;
  const next = Math.max(0, active - 1);
  if (next === 0) {
    localCounts.delete(tenantId);
  } else {
    localCounts.set(tenantId, next);
  }
}








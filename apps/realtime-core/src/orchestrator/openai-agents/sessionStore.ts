/**
 * sessionStore.ts
 *
 * Redis-backed session persistence for conversation state and history.
 * Enables crash recovery — if a realtime-core instance dies mid-call,
 * another instance can resume from Redis without losing context.
 *
 * Falls back gracefully when Redis is unavailable (in-memory only).
 */

import { createLogger } from "@rezovo/logging";
import { isRedisEnabled, getRedisClient } from "../../redis/client";
import { RedisKeys, RedisTTL } from "./redisKeys";
import { ConversationStateMachine } from "../stateMachine";
import type { AgentInputItem } from "@openai/agents";
import { createHash } from "crypto";

const logger = createLogger({ service: "realtime-core", module: "sessionStore" });

export class SessionStore {
  private redis: ReturnType<typeof getRedisClient> | null = null;

  constructor() {
    try {
      if (isRedisEnabled) {
        this.redis = getRedisClient();
      }
    } catch {
      logger.warn("Redis not available, session store operating in memory-only mode");
    }
  }

  // ─── State Machine Persistence ───

  async saveState(callId: string, machine: ConversationStateMachine): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(
        RedisKeys.callState(callId),
        RedisTTL.CALL_STATE,
        machine.serialize()
      );
    } catch (err) {
      logger.warn("failed to persist state to Redis", {
        callId,
        error: (err as Error).message,
      });
    }
  }

  async loadState(callId: string, opts?: { maxRetries?: number }): Promise<ConversationStateMachine | null> {
    if (!this.redis) return null;
    try {
      const json = await this.redis.get(RedisKeys.callState(callId));
      if (!json) return null;
      return ConversationStateMachine.deserialize(json, opts);
    } catch (err) {
      logger.warn("failed to load state from Redis", {
        callId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  // ─── Conversation History Persistence ───

  async saveHistory(callId: string, history: AgentInputItem[]): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(
        RedisKeys.callHistory(callId),
        RedisTTL.CALL_HISTORY,
        JSON.stringify(history)
      );
    } catch (err) {
      logger.warn("failed to persist history to Redis", {
        callId,
        error: (err as Error).message,
      });
    }
  }

  async loadHistory(callId: string): Promise<AgentInputItem[] | null> {
    if (!this.redis) return null;
    try {
      const json = await this.redis.get(RedisKeys.callHistory(callId));
      if (!json) return null;
      return JSON.parse(json) as AgentInputItem[];
    } catch (err) {
      logger.warn("failed to load history from Redis", {
        callId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  // ─── KB Context Cache ───

  async saveKbContext(callId: string, context: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(
        RedisKeys.kbPrefetch(callId),
        RedisTTL.KB_PREFETCH,
        context
      );
    } catch (err) {
      logger.warn("failed to cache KB context", {
        callId,
        error: (err as Error).message,
      });
    }
  }

  async loadKbContext(callId: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(RedisKeys.kbPrefetch(callId));
    } catch {
      return null;
    }
  }

  // ─── Idempotency ───

  /**
   * Generate a stable idempotency key from call + tool + args.
   */
  generateIdempotencyKey(callId: string, toolName: string, args: Record<string, unknown>): string {
    const stableFields = Object.keys(args)
      .sort()
      .map((key) => `${key}:${JSON.stringify(args[key])}`)
      .join("|");
    const input = `${callId}:${toolName}:${stableFields}`;
    return createHash("sha256").update(input).digest("hex").slice(0, 16);
  }

  async getIdempotentResult(key: string): Promise<unknown | null> {
    if (!this.redis) return null;
    try {
      const cached = await this.redis.get(RedisKeys.idempotency(key));
      if (cached) {
        logger.info("idempotent cache hit", { key });
        return JSON.parse(cached);
      }
      return null;
    } catch {
      return null;
    }
  }

  async setIdempotentResult(key: string, result: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(
        RedisKeys.idempotency(key),
        RedisTTL.IDEMPOTENCY,
        JSON.stringify(result)
      );
    } catch (err) {
      logger.warn("failed to cache idempotent result", {
        key,
        error: (err as Error).message,
      });
    }
  }

  // ─── Guardrail State ───

  async getWarnCount(callId: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      const count = await this.redis.get(RedisKeys.warnCount(callId));
      return count ? parseInt(count, 10) : 0;
    } catch {
      return 0;
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

  // ─── Cleanup ───

  async cleanupCall(callId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(
        RedisKeys.callState(callId),
        RedisKeys.callHistory(callId),
        RedisKeys.kbPrefetch(callId),
        RedisKeys.warnCount(callId)
      );
      logger.debug("cleaned up Redis state for call", { callId });
    } catch (err) {
      logger.warn("failed to cleanup Redis state", {
        callId,
        error: (err as Error).message,
      });
    }
  }
}

/** Singleton instance */
export const sessionStore = new SessionStore();

import { createLogger } from "@rezovo/logging";
import type { CallTranscriptEntry } from "@rezovo/core-types";
import type { AgentInputItem } from "@openai/agents";
import { isRedisEnabled, getRedisClient } from "../../redis/client";
import { RedisKeys, RedisTTL } from "./redisKeys";
import type { ApprovalGateState, CallContext, PendingAction } from "./agents";

const logger = createLogger({ service: "realtime-core", module: "sessionStore" });

export type PersistedConversationContext = Pick<
  CallContext,
  | "slotMemory"
  | "pendingAction"
  | "approvedActionHash"
  | "approvalGateState"
  | "currentDateTime"
  | "kbPassages"
>;

export type PersistedConversationState = {
  callId: string;
  history: AgentInputItem[];
  currentAgentName: string;
  context: PersistedConversationContext;
  transcript: CallTranscriptEntry[];
  turnCount: number;
  latestIntent?: string;
  latestIntentConfidence?: number;
  latestSlots?: Record<string, unknown>;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPendingAction(value: unknown): value is PendingAction {
  if (!isRecord(value)) return false;
  return (
    typeof value.toolName === "string" &&
    isRecord(value.args) &&
    typeof value.actionHash === "string" &&
    typeof value.createdAtMs === "number" &&
    typeof value.expiresAtMs === "number"
  );
}

function isApprovalGateState(value: unknown): value is ApprovalGateState {
  return (
    value === "none" ||
    value === "awaiting_confirmation" ||
    value === "approved_for_turn" ||
    value === "rejected"
  );
}

function coercePersistedState(value: unknown): PersistedConversationState | null {
  if (!isRecord(value)) return null;
  if (typeof value.callId !== "string") return null;
  if (!Array.isArray(value.history)) return null;
  if (typeof value.currentAgentName !== "string") return null;
  if (!isRecord(value.context)) return null;
  if (!Array.isArray(value.transcript)) return null;
  if (typeof value.turnCount !== "number") return null;
  if (typeof value.updatedAt !== "string") return null;

  const context = value.context;
  const slotMemory = isRecord(context.slotMemory) ? context.slotMemory : {};
  const pendingAction = context.pendingAction === null ? null : isPendingAction(context.pendingAction) ? context.pendingAction : null;
  const approvedActionHash =
    typeof context.approvedActionHash === "string" ? context.approvedActionHash : null;
  const approvalGateState: ApprovalGateState = isApprovalGateState(context.approvalGateState)
    ? context.approvalGateState
    : "none";
  const currentDateTime =
    typeof context.currentDateTime === "string" ? context.currentDateTime : new Date().toISOString();
  const kbPassages = Array.isArray(context.kbPassages)
    ? context.kbPassages.filter((p): p is string => typeof p === "string")
    : [];

  const transcript = value.transcript.filter((entry): entry is CallTranscriptEntry => {
    if (!isRecord(entry)) return false;
    return (
      (entry.from === "agent" || entry.from === "user") &&
      typeof entry.text === "string" &&
      typeof entry.timestamp === "string"
    );
  });

  return {
    callId: value.callId,
    history: value.history as AgentInputItem[],
    currentAgentName: value.currentAgentName,
    context: {
      slotMemory,
      pendingAction,
      approvedActionHash,
      approvalGateState,
      currentDateTime,
      kbPassages,
    },
    transcript,
    turnCount: value.turnCount,
    latestIntent: typeof value.latestIntent === "string" ? value.latestIntent : undefined,
    latestIntentConfidence:
      typeof value.latestIntentConfidence === "number" ? value.latestIntentConfidence : undefined,
    latestSlots: isRecord(value.latestSlots) ? value.latestSlots : undefined,
    updatedAt: value.updatedAt,
  };
}

export class SessionStore {
  private redis: ReturnType<typeof getRedisClient> | null = null;
  private warnCountFallback = new Map<string, number>();
  private conversationFallback = new Map<string, PersistedConversationState>();

  constructor() {
    try {
      if (isRedisEnabled) {
        this.redis = getRedisClient();
      }
    } catch {
      logger.warn("Redis not available, session durability is in memory-only mode");
    }
  }

  async incrementWarnCount(callId: string): Promise<number> {
    if (!this.redis) {
      const next = (this.warnCountFallback.get(callId) ?? 0) + 1;
      this.warnCountFallback.set(callId, next);
      return next;
    }
    try {
      const key = RedisKeys.warnCount(callId);
      const count = await this.redis.incr(key);
      await this.redis.expire(key, RedisTTL.GUARDRAIL_WARN);
      return count;
    } catch {
      const next = (this.warnCountFallback.get(callId) ?? 0) + 1;
      this.warnCountFallback.set(callId, next);
      return next;
    }
  }

  async getConversationState(callId: string): Promise<PersistedConversationState | null> {
    if (!this.redis) {
      return this.conversationFallback.get(callId) ?? null;
    }
    try {
      const raw = await this.redis.get(RedisKeys.conversationState(callId));
      if (!raw) return this.conversationFallback.get(callId) ?? null;
      const parsed = JSON.parse(raw);
      const state = coercePersistedState(parsed);
      if (!state) {
        logger.warn("invalid conversation state payload in redis", { callId });
        return this.conversationFallback.get(callId) ?? null;
      }
      this.conversationFallback.set(callId, state);
      return state;
    } catch (error) {
      logger.warn("failed to load conversation state", {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.conversationFallback.get(callId) ?? null;
    }
  }

  async saveConversationState(callId: string, state: Omit<PersistedConversationState, "updatedAt">): Promise<void> {
    const payload: PersistedConversationState = {
      ...state,
      updatedAt: new Date().toISOString(),
    };

    this.conversationFallback.set(callId, payload);

    if (!this.redis) return;

    try {
      await this.redis.set(
        RedisKeys.conversationState(callId),
        JSON.stringify(payload),
        "EX",
        RedisTTL.CONVERSATION_STATE,
      );
    } catch (error) {
      logger.warn("failed to persist conversation state", {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async clearConversationState(callId: string): Promise<void> {
    this.conversationFallback.delete(callId);

    if (!this.redis) return;
    try {
      await this.redis.del(RedisKeys.conversationState(callId));
    } catch (error) {
      logger.warn("failed to clear conversation state", {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const sessionStore = new SessionStore();

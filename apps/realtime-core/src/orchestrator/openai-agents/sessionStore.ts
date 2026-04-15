import { createLogger } from "@rezovo/logging";
import type { CallTranscriptEntry } from "@rezovo/core-types";
import type { AgentInputItem } from "@openai/agents";
import type { RealtimeItem } from "@openai/agents/realtime";
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
  | "kbHealth"
  | "lastNamespaceUsed"
>;

export type PersistedConversationMode = "legacy" | "realtime_agents";

export type PersistedConversationState = {
  mode: PersistedConversationMode;
  callId: string;
  history?: AgentInputItem[];
  realtimeHistory?: RealtimeItem[];
  currentAgentName: string;
  context: PersistedConversationContext;
  transcript: CallTranscriptEntry[];
  turnCount: number;
  latestIntent?: string;
  latestIntentConfidence?: number;
  latestSlots?: Record<string, unknown>;
  emptyPassCountByCall?: number;
  updatedAt: string;
};

export type PersistedRealtimeConversationState = PersistedConversationState & {
  mode: "realtime_agents";
  realtimeHistory: RealtimeItem[];
};

export type PersistedLegacyConversationState = PersistedConversationState & {
  mode: "legacy";
  history: AgentInputItem[];
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
  if (typeof value.currentAgentName !== "string") return null;
  if (!isRecord(value.context)) return null;
  if (!Array.isArray(value.transcript)) return null;
  if (typeof value.turnCount !== "number") return null;
  if (typeof value.updatedAt !== "string") return null;

  const context = value.context;
  const mode: PersistedConversationMode =
    value.mode === "realtime_agents" ? "realtime_agents" : "legacy";
  const history = Array.isArray(value.history) ? (value.history as AgentInputItem[]) : undefined;
  const realtimeHistory = Array.isArray(value.realtimeHistory)
    ? (value.realtimeHistory as RealtimeItem[])
    : undefined;

  if (mode === "legacy" && !history) return null;
  if (mode === "realtime_agents" && !realtimeHistory) return null;

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
  const kbHealth = isRecord(context.kbHealth)
    ? (() => {
        const status: "unknown" | "healthy" | "degraded" =
          context.kbHealth.status === "healthy" ||
          context.kbHealth.status === "degraded" ||
          context.kbHealth.status === "unknown"
            ? context.kbHealth.status
            : "unknown";
        return {
          status,
          totalQueries:
            typeof context.kbHealth.totalQueries === "number" && context.kbHealth.totalQueries >= 0
              ? context.kbHealth.totalQueries
              : 0,
          hitQueries:
            typeof context.kbHealth.hitQueries === "number" && context.kbHealth.hitQueries >= 0
              ? context.kbHealth.hitQueries
              : 0,
          zeroHitStreak:
            typeof context.kbHealth.zeroHitStreak === "number" && context.kbHealth.zeroHitStreak >= 0
              ? context.kbHealth.zeroHitStreak
              : 0,
          lastCheckedAt:
            typeof context.kbHealth.lastCheckedAt === "string" ? context.kbHealth.lastCheckedAt : undefined,
          lastHitAt: typeof context.kbHealth.lastHitAt === "string" ? context.kbHealth.lastHitAt : undefined,
          lastNamespaceUsed:
            typeof context.kbHealth.lastNamespaceUsed === "string"
              ? context.kbHealth.lastNamespaceUsed
              : undefined,
          lastMatchCount:
            typeof context.kbHealth.lastMatchCount === "number"
              ? context.kbHealth.lastMatchCount
              : undefined,
        };
      })()
    : undefined;
  const lastNamespaceUsed =
    typeof context.lastNamespaceUsed === "string" ? context.lastNamespaceUsed : undefined;

  const transcript = value.transcript.filter((entry): entry is CallTranscriptEntry => {
    if (!isRecord(entry)) return false;
    return (
      (entry.from === "agent" || entry.from === "user") &&
      typeof entry.text === "string" &&
      typeof entry.timestamp === "string"
    );
  });

  return {
    mode,
    callId: value.callId,
    history,
    realtimeHistory,
    currentAgentName: value.currentAgentName,
    context: {
      slotMemory,
      pendingAction,
      approvedActionHash,
      approvalGateState,
      currentDateTime,
      kbPassages,
      kbHealth,
      lastNamespaceUsed,
    },
    transcript,
    turnCount: value.turnCount,
    latestIntent: typeof value.latestIntent === "string" ? value.latestIntent : undefined,
    latestIntentConfidence:
      typeof value.latestIntentConfidence === "number" ? value.latestIntentConfidence : undefined,
    latestSlots: isRecord(value.latestSlots) ? value.latestSlots : undefined,
    emptyPassCountByCall:
      typeof value.emptyPassCountByCall === "number" && value.emptyPassCountByCall >= 0
        ? value.emptyPassCountByCall
        : 0,
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

  async getConversationState(callId: string): Promise<PersistedLegacyConversationState | null> {
    if (!this.redis) {
      const local = this.conversationFallback.get(callId) ?? null;
      if (!local || (local.mode ?? "legacy") !== "legacy" || !local.history) return null;
      return local as PersistedLegacyConversationState;
    }
    try {
      const raw = await this.redis.get(RedisKeys.conversationState(callId));
      if (!raw) {
        const local = this.conversationFallback.get(callId) ?? null;
        if (!local || (local.mode ?? "legacy") !== "legacy" || !local.history) return null;
        return local as PersistedLegacyConversationState;
      }
      const parsed = JSON.parse(raw);
      const state = coercePersistedState(parsed);
      if (!state) {
        logger.warn("invalid conversation state payload in redis", { callId });
        const local = this.conversationFallback.get(callId) ?? null;
        if (!local || (local.mode ?? "legacy") !== "legacy" || !local.history) return null;
        return local as PersistedLegacyConversationState;
      }
      this.conversationFallback.set(callId, state);
      if ((state.mode ?? "legacy") !== "legacy" || !state.history) return null;
      return state as PersistedLegacyConversationState;
    } catch (error) {
      logger.warn("failed to load conversation state", {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
      const local = this.conversationFallback.get(callId) ?? null;
      if (!local || (local.mode ?? "legacy") !== "legacy" || !local.history) return null;
      return local as PersistedLegacyConversationState;
    }
  }

  async saveConversationState(
    callId: string,
    state: Omit<PersistedConversationState, "updatedAt" | "mode" | "realtimeHistory"> & { history: AgentInputItem[] },
  ): Promise<void> {
    const payload: PersistedConversationState = {
      mode: "legacy",
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

  async getRealtimeConversationState(callId: string): Promise<PersistedRealtimeConversationState | null> {
    if (!this.redis) {
      const local = this.conversationFallback.get(callId) ?? null;
      if (!local || local.mode !== "realtime_agents" || !local.realtimeHistory) return null;
      return local as PersistedRealtimeConversationState;
    }

    try {
      const raw = await this.redis.get(RedisKeys.conversationState(callId));
      if (!raw) {
        const local = this.conversationFallback.get(callId) ?? null;
        if (!local || local.mode !== "realtime_agents" || !local.realtimeHistory) return null;
        return local as PersistedRealtimeConversationState;
      }

      const parsed = JSON.parse(raw);
      const state = coercePersistedState(parsed);
      if (!state) return null;
      this.conversationFallback.set(callId, state);
      if (state.mode !== "realtime_agents" || !state.realtimeHistory) return null;
      return state as PersistedRealtimeConversationState;
    } catch (error) {
      logger.warn("failed to load realtime conversation state", {
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
      const local = this.conversationFallback.get(callId) ?? null;
      if (!local || local.mode !== "realtime_agents" || !local.realtimeHistory) return null;
      return local as PersistedRealtimeConversationState;
    }
  }

  async saveRealtimeConversationState(
    callId: string,
    state: Omit<PersistedRealtimeConversationState, "updatedAt" | "mode">,
  ): Promise<void> {
    const payload: PersistedRealtimeConversationState = {
      mode: "realtime_agents",
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
      logger.warn("failed to persist realtime conversation state", {
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

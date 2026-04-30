/**
 * TypeBox response shapes for high-traffic demo routes (contract tests + Fastify serialization).
 */
import { Type, type Static } from "@sinclair/typebox";

const ServiceHealthSlice = Type.Object({
  name: Type.String(),
  status: Type.String(),
  latencyMs: Type.Optional(Type.Number()),
  message: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

/** Body inside `sendData` for GET /health */
export const SystemHealthDataSchema = Type.Object({
  overall: Type.Union([
    Type.Literal("operational"),
    Type.Literal("degraded"),
    Type.Literal("outage"),
  ]),
  telephony: Type.Array(ServiceHealthSlice),
  stt: Type.Array(ServiceHealthSlice),
  tts: Type.Array(ServiceHealthSlice),
  llm: Type.Array(ServiceHealthSlice),
  tools: Type.Array(ServiceHealthSlice),
  integrations: Type.Array(ServiceHealthSlice),
});

export const HealthEnvelopeSchema = Type.Object({
  data: SystemHealthDataSchema,
});

export type HealthEnvelope = Static<typeof HealthEnvelopeSchema>;

/** Single row from GET /calls (UI mapping); allow extra keys from API evolution */
export const CallListItemSchema = Type.Object(
  {
    callId: Type.String(),
    startedAt: Type.String(),
    result: Type.String(),
  },
  { additionalProperties: true }
);

export const CallsListEnvelopeSchema = Type.Object({
  data: Type.Array(CallListItemSchema),
});

export const AnalyticsSummarySchema = Type.Object({
  totalCalls: Type.Number(),
  /** outcome = handled; same count as completedCalls */
  successfulCalls: Type.Number(),
  completedCalls: Type.Number(),
  handoffCalls: Type.Number(),
  droppedCalls: Type.Number(),
  failedCalls: Type.Number(),
  /** 0–100 integers for dashboard headline KPIs */
  completionRate: Type.Number(),
  handoffRate: Type.Number(),
  dropRate: Type.Number(),
  failureRate: Type.Number(),
  averageDurationMs: Type.Number(),
  /** 0–1; prefer completionRate for display */
  successRate: Type.Number(),
  activeNow: Type.Number(),
  toolInvocations: Type.Number(),
  /** Average ms from call start to first agent_spoke; null when no samples */
  avgTimeToAgentSpeechMs: Type.Union([Type.Number(), Type.Null()]),
  /** When false, UI must not show 0ms as a measured value */
  avgTimeToAgentSpeechHasData: Type.Boolean(),
});

export const AnalyticsSummaryEnvelopeSchema = Type.Object({
  data: AnalyticsSummarySchema,
});

export const BillingQuotaOkSchema = Type.Object({
  allowed: Type.Boolean(),
  active: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
});

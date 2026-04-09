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
  successfulCalls: Type.Number(),
  failedCalls: Type.Number(),
  averageDurationMs: Type.Number(),
  successRate: Type.Number(),
  activeNow: Type.Number(),
  toolInvocations: Type.Number(),
});

export const AnalyticsSummaryEnvelopeSchema = Type.Object({
  data: AnalyticsSummarySchema,
});

export const BillingQuotaOkSchema = Type.Object({
  allowed: Type.Boolean(),
  active: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
});

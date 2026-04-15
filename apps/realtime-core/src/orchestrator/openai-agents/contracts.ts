import { z } from "zod";

export const TurnIntentSchema = z.enum([
  "create_booking",
  "modify_booking",
  "cancel_booking",
  "complaint",
  "info_request",
  "sales_inquiry",
  "human_transfer",
  "end_call",
  "other",
]);

export type TurnIntent = z.infer<typeof TurnIntentSchema>;

export const SpecialistRouteSchema = z.enum(["booking", "support", "sales", "general"]);
export type SpecialistRoute = z.infer<typeof SpecialistRouteSchema>;

export const DecisionModeSchema = z.enum([
  "direct_response",
  "slot_collection",
  "confirm_then_execute",
  "execute_read_only",
  "execute_confirmed",
  "transfer",
  "end",
  "recovery",
  "guardrail_transfer",
]);

export type DecisionMode = z.infer<typeof DecisionModeSchema>;

const SlotValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ToolExecutionRequestSchema = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.any()).default({}),
  isStateChanging: z.boolean().default(false),
  requiresConfirmation: z.boolean().default(false),
});

export type ToolExecutionRequest = z.infer<typeof ToolExecutionRequestSchema>;

export const TurnInterpretationSchema = z.object({
  intent: TurnIntentSchema.default("other"),
  confidence: z.number().min(0).max(1).default(0.5),
  specialist: SpecialistRouteSchema.default("general"),
  userGoal: z.string().default("general_help"),
  userConfirmation: z.enum(["yes", "no", "unclear"]).default("unclear"),
  endCall: z.boolean().default(false),
  escalateToHuman: z.boolean().default(false),
  extractedSlots: z.record(z.string(), SlotValueSchema).default({}),
  missingSlotsHint: z.array(z.string()).default([]),
  requestedTool: z
    .object({
      name: z.string().min(1),
      args: z.record(z.string(), z.any()).default({}),
      stateChanging: z.boolean().optional(),
      rationale: z.string().optional(),
    })
    .nullable()
    .default(null),
  responseTone: z.enum(["normal", "clarify", "recovery"]).default("normal"),
});

export type TurnInterpretation = z.infer<typeof TurnInterpretationSchema>;

export const TurnDecisionSchema = z.object({
  action: z.enum(["speak", "transfer", "end"]),
  decisionMode: DecisionModeSchema,
  reason: z.string().min(1),
  intent: TurnIntentSchema,
  confidence: z.number().min(0).max(1),
  pendingAction: ToolExecutionRequestSchema.nullable().default(null),
  toolExecution: ToolExecutionRequestSchema.nullable().default(null),
});

export type TurnDecision = z.infer<typeof TurnDecisionSchema>;

export const AssistantTurnOutputSchema = z.object({
  action: z.enum(["speak", "transfer", "end"]),
  text: z.string().min(1),
  agentName: z.string().min(1),
  intent: TurnIntentSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  slots: z.record(z.string(), z.any()).default({}),
  diagnostics: z.object({
    intent: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    decisionMode: DecisionModeSchema,
    pendingAction: z.string().nullable(),
    modelProfile: z.string(),
    retryReason: z.string().optional(),
    turnLatencyMs: z.number().nonnegative(),
    specialist: SpecialistRouteSchema,
    history_len: z.number().int().nonnegative().optional(),
    active_agent: z.string().optional(),
    tool_calls: z.array(z.string()).optional(),
    approval_gate_state: z
      .enum(["none", "awaiting_confirmation", "approved_for_turn", "rejected"])
      .optional(),
    ttft_ms: z.number().nonnegative().optional(),
    llm_total_ms: z.number().nonnegative().optional(),
    ingress_to_transcript_ms: z.number().nonnegative().optional(),
    transcript_to_first_text_delta_ms: z.number().nonnegative().optional(),
    first_text_delta_to_first_tts_ms: z.number().nonnegative().optional(),
    turn_total_ms: z.number().nonnegative().optional(),
    empty_passes: z.number().int().nonnegative().optional(),
    chunks_synthesized: z.number().int().nonnegative().optional(),
    queue_wait_p95_ms: z.number().nonnegative().optional(),
    rag_fallback_used: z.boolean().optional(),
    timeline_ms: z
      .object({
        transcript: z.number().nonnegative().optional(),
        response_requested: z.number().nonnegative().optional(),
        first_text_delta: z.number().nonnegative().optional(),
        first_tts: z.number().nonnegative().optional(),
        finalized: z.number().nonnegative().optional(),
      })
      .optional(),
  }),
});

export type AssistantTurnOutput = z.infer<typeof AssistantTurnOutputSchema>;

export type TurnDiagnostics = AssistantTurnOutput["diagnostics"];

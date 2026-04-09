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
  args: z.record(z.any()).default({}),
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
  extractedSlots: z.record(SlotValueSchema).default({}),
  missingSlotsHint: z.array(z.string()).default([]),
  requestedTool: z
    .object({
      name: z.string().min(1),
      args: z.record(z.any()).default({}),
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
  slots: z.record(z.any()).default({}),
  diagnostics: z.object({
    intent: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    decisionMode: DecisionModeSchema,
    pendingAction: z.string().nullable(),
    modelProfile: z.string(),
    retryReason: z.string().optional(),
    turnLatencyMs: z.number().nonnegative(),
    specialist: SpecialistRouteSchema,
  }),
});

export type AssistantTurnOutput = z.infer<typeof AssistantTurnOutputSchema>;

export type TurnDiagnostics = AssistantTurnOutput["diagnostics"];

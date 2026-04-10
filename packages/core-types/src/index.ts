export type RouteType = "ai" | "queue" | "voicemail";

export type EventType =
  | "CallStarted"
  | "CallEnded"
  | "UsageReported"
  | "ConfigChanged"
  | "DocIngestRequested"
  | "AppointmentUpdated"
  | "ToolUsed"
  | "VoicemailReferenceCreated";

export type EventEnvelope<T> = {
  event_id: string;
  event_type: EventType;
  org_id: string;
  call_id?: string;
  timestamp: string;
  payload: T;
};

export type PhoneNumberConfig = {
  did: string;
  orgId: string;
  businessId: string;
  routeType: RouteType;
  agentConfigId?: string;
  queueExtension?: string;
};

export type AgentPersona = "receptionist" | "scheduler" | "support";

export type OpeningHours = Record<string, Array<{ open: string; close: string }>>;

export type EscalationRules = {
  escalateOnExplicitRequest?: boolean;
  escalateOnPolicyHit?: boolean;
  retryLimit?: number;
  fallbackQueueExtension?: string;
};

export type BookingProvider = "calendly" | "opentable" | "none";

export type CalendlyIntegration = {
  accessToken: string;
  refreshToken?: string;
  eventTypeUri: string;
  organizationUri?: string;
  timezone: string;
};

export type OpenTableIntegration = {
  restaurantId: string;
};

export type AgentConfigSnapshot = {
  id: string;
  version: number;
  orgId: string;
  businessId: string;
  basePrompt: string;
  persona: AgentPersona;
  openingHours: OpeningHours;
  languagePrefs: string[];
  llmProfileId: string;
  toolAccess: string[];
  kbNamespace: string;
  maxCallDurationSec: number;
  escalationRules: EscalationRules;
  bookingProvider?: BookingProvider;
  calendly?: CalendlyIntegration;
  opentable?: OpenTableIntegration;
};

export type PlanSnapshot = {
  orgId: string;
  planId: string;
  maxConcurrentCalls: number | null;
};

export type CallStage =
  | "greeting"
  | "intake"
  | "qualification"
  | "booking"
  | "handoff"
  | "message"
  | "closing";

export type CallTranscriptEntry = {
  from: "user" | "agent";
  text: string;
  timestamp: string;
};

export type CallSessionContext = {
  callId: string;
  orgId: string;
  businessId: string;
  phoneNumberConfig: PhoneNumberConfig;
  agentConfig: AgentConfigSnapshot;
  stage: CallStage;
  slots: {
    callerName?: string;
    callbackNumber?: string;
    reason?: string;
    desiredTime?: string;
  };
  transcript: CallTranscriptEntry[];
  kbContext?: string;
  startedAt: Date;
};

export type CallEndReason = "caller_hangup" | "agent_end" | "transfer" | "timeout" | "error";

export type UsageBreakdown = {
  callDurationSec: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  sttSeconds?: number;
  ttsSeconds?: number;
  ttsCharacters?: number;
};

export type CallStartedPayload = {
  did: string;
  businessId: string;
  routeType: RouteType;
  agentConfigId?: string;
  agentConfigVersion?: number;
  startedAt: string;
};

export type CallEndedPayload = {
  did: string;
  businessId: string;
  routeType: RouteType;
  agentConfigId?: string;
  agentConfigVersion?: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  endReason: CallEndReason;
  outcome?: "handled" | "transferred" | "voicemail" | "abandoned" | "failed";
  usage?: UsageBreakdown;
};

export type UsageReportedPayload = {
  usage: UsageBreakdown;
  callStartedAt: string;
  callEndedAt: string;
  metadata?: Record<string, unknown>;
};

export type ConfigChangedPayload = {
  entity: "PhoneNumber" | "AgentConfig" | "Plan" | "Business";
  entity_id: string;
  version: number;
  lob?: string;
  status?: "draft" | "published";
};

export type DocIngestRequestedPayload = {
  doc_id: string;
  namespace: string;
};

export type AppointmentUpdatedPayload = {
  externalId: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  metadata?: Record<string, unknown>;
};

export type ToolUsedPayload = {
  toolName: string;
  idempotencyKey: string;
  args: Record<string, unknown>;
  provider?: string;
  result?: unknown;
};

export type VoicemailReferenceCreatedPayload = {
  voicemailId: string;
  recordingUrl: string;
  did: string;
  businessId: string;
  receivedAt: string;
};

export type EventPayloadByType = {
  CallStarted: CallStartedPayload;
  CallEnded: CallEndedPayload;
  UsageReported: UsageReportedPayload;
  ConfigChanged: ConfigChangedPayload;
  DocIngestRequested: DocIngestRequestedPayload;
  AppointmentUpdated: AppointmentUpdatedPayload;
  ToolUsed: ToolUsedPayload;
  VoicemailReferenceCreated: VoicemailReferenceCreatedPayload;
};

export type TypedEventEnvelope<E extends EventType> = EventEnvelope<EventPayloadByType[E]>;


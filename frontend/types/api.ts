// ============================================================================
// Domain Types (used in stores + components)
// ============================================================================

// ─── Call / History ─────────────────────────────────────────────────────────

export interface CallRecord {
  callId: string
  startedAt: string
  endedAt?: string
  callerNumber: string
  callerName?: string
  phoneLineId: string
  phoneLineNumber: string
  agentId: string
  agentName: string
  intent?: "Billing" | "Support" | "Sales" | "Booking" | "Unknown"
  direction: "inbound" | "outbound"
  durationMs: number
  result: "completed" | "handoff" | "dropped" | "systemFailed"
  endReason?: string
  turnCount?: number
  toolsUsed: { name: string; success: boolean }[]
  toolErrors?: number
  failureType?: string
}

// ─── Call Detail (timeline, transcript, tools) ──────────────────────────────

export type TimelineEventType =
  | "call_started"
  | "agent_spoke"
  | "caller_spoke"
  | "tool_called"
  | "call_ended"
  | "transfer"
  | "error"

export interface TimelineEvent {
  id: string
  type: TimelineEventType
  timestamp: string
  description: string
  details?: string
}

export interface TranscriptLine {
  id: string
  role: "agent" | "caller"
  text: string
  timestamp: string
}

export interface ToolActivity {
  id: string
  name: string
  status: "pending" | "success" | "failed"
  latency?: number
  timestamp?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  error?: string
}

// ─── Live Calls ─────────────────────────────────────────────────────────────

export type TranscriptStatus = "processing" | "available" | "unavailable" | "not_started"

export interface LiveCall {
  callId: string
  callerNumber: string
  agentName: string
  agentVersion: string
  intent?: "Billing" | "Support" | "Booking" | "Sales" | "Unknown"
  state: "ringing" | "active" | "at_risk" | "handoff_requested" | "error"
  direction: "inbound" | "outbound"
  startedAt: string
  durationSeconds: number
  lastEvent: string
  riskFlags: string[]
  riskTrigger?: { type: string; detail: string }
  timeline: TimelineEvent[]
  transcript: TranscriptLine[]
  tools: ToolActivity[]
  tags: string[]
  transcriptStatus?: TranscriptStatus
}

// ─── Agents ─────────────────────────────────────────────────────────────────

export interface Agent {
  id: string
  name: string
  description: string
  status: "active" | "paused" | "draft"
  type: "support" | "sales" | "scheduling" | "general"
  version: string
  phoneLines: string[]
  knowledgeBase: string[]
  tools: string[]
  metrics: {
    totalCalls: number
    handledRate: number
    escalationRate: number
    failureRate: number
    avgDuration: number
  }
  createdAt: string
  updatedAt: string
  needsAttention?: boolean
  attentionReason?: string
}

// ─── Knowledge Base ─────────────────────────────────────────────────────────

export interface KBDocument {
  id: string
  name: string
  type: "pdf" | "txt" | "html" | "md" | "docx"
  size: number
  status: "ready" | "processing" | "failed" | "uploading"
  progress?: number
  collection: string
  chunks: number
  usedByAgents: string[]
  createdAt: string
  updatedAt: string
  error?: string
}

export interface KBCollection {
  id: string
  name: string
  description: string
  documentCount: number
  createdAt: string
}

// ─── Integrations ───────────────────────────────────────────────────────────

export interface Integration {
  id: string
  name: string
  type: "telephony" | "crm" | "calendar" | "payment" | "analytics" | "notification"
  status: "connected" | "disconnected" | "degraded" | "error"
  icon: string
  description: string
  lastSync?: string
  config?: Record<string, string>
}

// ─── Notifications ──────────────────────────────────────────────────────────

export interface Notification {
  id: string
  type: "info" | "success" | "warning" | "error"
  title: string
  message: string
  read: boolean
  timestamp: string
  actionUrl?: string
}

// ─── Saved Views ────────────────────────────────────────────────────────────

export interface SavedView {
  id: string
  name: string
  page: string
  filters: Record<string, unknown>
  createdAt: string
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface UserSettings {
  workspace: {
    name: string
    timezone: string
    businessHours: { start: string; end: string }
    autoRefresh: boolean
    refreshInterval: number
  }
  notifications: {
    emailRecipients: string[]
    slackEnabled: boolean
    slackWebhook: string
    alertRules: {
      highVolume: boolean
      escalations: boolean
      failures: boolean
      degradedIntegrations: boolean
    }
    quietHours: { enabled: boolean; start: string; end: string }
  }
  security: {
    mfaEnabled: boolean
    allowedDomains: string[]
  }
  dataPrivacy: {
    recordCalls: boolean
    transcriptRetention: number
    piiRedaction: boolean
  }
  developer: {
    apiKeys: { id: string; name: string; key: string; createdAt: string; lastUsed?: string }[]
    webhooks: { url: string; events: string[]; secret: string; enabled: boolean }
  }
}

// ─── Team ───────────────────────────────────────────────────────────────────

export interface TeamMember {
  id: string
  name: string
  email: string
  role: "admin" | "editor" | "viewer"
  status: "active" | "invited"
  lastActive: string
}

// ─── Developer ──────────────────────────────────────────────────────────────

export interface DeveloperApiKey {
  id: string
  name: string
  prefix: string
  created: string
  lastUsed: string
  status: "active" | "revoked"
}

// ─── Actions / Follow-ups ───────────────────────────────────────────────────

export interface Contact {
  id: string
  name?: string
  phone: string
  email?: string
  tags: string[]
  smsOptOut: boolean
  lastContactedAt?: string
}

export type CallTranscriptStatus = "processing" | "available" | "unavailable"

export interface Call {
  id: string
  contactId: string
  time: string
  agentId: string
  lineId: string
  direction: "inbound" | "outbound"
  outcome: "handled" | "missed" | "abandoned" | "failed" | "escalated"
  endReason?: string
  durationSec: number
  summary?: string
  intent?: string
  sentiment?: "positive" | "neutral" | "negative"
  extractedFields: Record<string, string>
  transcriptStatus?: CallTranscriptStatus
}

export type FollowUpStatus =
  | "open"
  | "in_progress"
  | "waiting_on_customer"
  | "scheduled"
  | "snoozed"
  | "done"
  | "failed"
  | "canceled"

export type FollowUpType =
  | "missed_call"
  | "booking"
  | "estimate_approval"
  | "ready_pickup"
  | "payment_pending"
  | "large_party"
  | "catering"
  | "complaint"
  | "reservation"
  | "order_issue"
  | "general"

export type Severity = "low" | "medium" | "high" | "critical"

export type Channel = "sms" | "ai_call" | "email" | "manual"

export interface Attempt {
  id: string
  type: Channel
  time: string
  result: "sent" | "delivered" | "no_answer" | "replied" | "failed" | "completed"
  note?: string
}

export interface ScheduledStep {
  id: string
  runAt: string
  actionKey: string
  channel: Channel
  templateId?: string
  status: "scheduled" | "ran" | "skipped"
  reason?: string
}

export interface FollowUp {
  id: string
  contactId: string
  callId?: string
  type: FollowUpType
  status: FollowUpStatus
  priority: number
  severity: Severity
  ownerId?: string
  dueAt: string
  createdAt: string
  recommendedNextStep?: string
  channelPlan: {
    primary: Channel
    fallbacks: Channel[]
  }
  attempts: Attempt[]
  scheduledSteps: ScheduledStep[]
  metadata: Record<string, string>
  vertical: "AutoShop" | "Restaurant" | "Common"
  notes?: string
  tags: string[]
}

export interface WorkflowStep {
  id: string
  actionKey: string
  delayMinutes: number
  channel: Channel
  templateId?: string
  onlyIfWithinHours?: boolean
  stopIf?: string[]
}

export interface EscalationRule {
  id: string
  condition: string
  action: string
  assignTo?: string
}

export interface Workflow {
  id: string
  vertical: "AutoShop" | "Restaurant" | "Common"
  name: string
  enabled: boolean
  triggerKey: string
  conditions: Record<string, unknown>
  steps: WorkflowStep[]
  attemptBudget: {
    smsMax: number
    aiCallMax: number
    totalMax: number
  }
  escalationRules: EscalationRule[]
  slaMinutes: number
  defaultOwnerStrategy: "unassigned" | "manager" | "round_robin"
  isBuiltIn: boolean
  lastSimulatedAt?: string
}

export interface Template {
  id: string
  vertical: "AutoShop" | "Restaurant" | "Common"
  type: FollowUpType
  title: string
  smsTemplate: string
  emailTemplate?: string
  quickReplies?: string[]
  tokens: string[]
  checklist: string[]
  defaultNextSteps: string[]
  links: {
    bookingLink?: string
    paymentLink?: string
    formLink?: string
    estimateLink?: string
  }
}

export interface BusinessHours {
  enabled: boolean
  timezone: string
  schedule: {
    [key: string]: { open: string; close: string; enabled: boolean }
  }
  defaultWindow: { start: string; end: string }
}

// ============================================================================
// API Wire Types (shapes returned by platform-api)
// ============================================================================
// Only add these when the wire shape differs from the domain shape.
// When the API returns a different shape (e.g. snake_case fields),
// define the wire type here and add a mapper function alongside it.
//
// Example:
//   export interface ApiCallRecord { call_record_id: string; caller_name: string; ... }
//   export function toCallRecord(wire: ApiCallRecord): CallRecord { ... }

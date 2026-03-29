"use client"

import type React from "react"
import { createContext, useContext, useReducer, useEffect, type ReactNode } from "react"
import type {
  Contact,
  CallTranscriptStatus,
  Call,
  FollowUpStatus,
  FollowUpType,
  Severity,
  Channel,
  Attempt,
  ScheduledStep,
  FollowUp,
  WorkflowStep,
  EscalationRule,
  Workflow,
  Template,
  BusinessHours,
} from "@/types/api"
export type {
  Contact,
  CallTranscriptStatus,
  Call,
  FollowUpStatus,
  FollowUpType,
  Severity,
  Channel,
  Attempt,
  ScheduledStep,
  FollowUp,
  WorkflowStep,
  EscalationRule,
  Workflow,
  Template,
  BusinessHours,
}

// ============================================================================
// STATE
// ============================================================================

interface ActionsState {
  contacts: Contact[]
  calls: Call[]
  followUps: FollowUp[]
  workflows: Workflow[]
  templates: Template[]
  businessHours: BusinessHours
  automationRunning: boolean
}

type ActionsAction =
  | { type: "SET_CONTACTS"; contacts: Contact[] }
  | { type: "UPDATE_CONTACT"; id: string; updates: Partial<Contact> }
  | { type: "SET_CALLS"; calls: Call[] }
  | { type: "SET_FOLLOW_UPS"; followUps: FollowUp[] }
  | { type: "ADD_FOLLOW_UP"; followUp: FollowUp }
  | { type: "UPDATE_FOLLOW_UP"; id: string; updates: Partial<FollowUp> }
  | { type: "DELETE_FOLLOW_UP"; id: string }
  | { type: "ADD_ATTEMPT"; followUpId: string; attempt: Attempt }
  | { type: "ADD_SCHEDULED_STEP"; followUpId: string; step: ScheduledStep }
  | { type: "UPDATE_SCHEDULED_STEP"; followUpId: string; stepId: string; updates: Partial<ScheduledStep> }
  | { type: "SET_WORKFLOWS"; workflows: Workflow[] }
  | { type: "ADD_WORKFLOW"; workflow: Workflow }
  | { type: "UPDATE_WORKFLOW"; id: string; updates: Partial<Workflow> }
  | { type: "DELETE_WORKFLOW"; id: string }
  | { type: "SET_TEMPLATES"; templates: Template[] }
  | { type: "ADD_TEMPLATE"; template: Template }
  | { type: "UPDATE_TEMPLATE"; id: string; updates: Partial<Template> }
  | { type: "DELETE_TEMPLATE"; id: string }
  | { type: "SET_BUSINESS_HOURS"; hours: BusinessHours }
  | { type: "SET_AUTOMATION_RUNNING"; running: boolean }

// ============================================================================
// INITIAL DATA
// ============================================================================

const defaultBusinessHours: BusinessHours = {
  enabled: false,
  timezone: "America/New_York",
  schedule: {
    monday: { open: "09:00", close: "18:00", enabled: true },
    tuesday: { open: "09:00", close: "18:00", enabled: true },
    wednesday: { open: "09:00", close: "18:00", enabled: true },
    thursday: { open: "09:00", close: "18:00", enabled: true },
    friday: { open: "09:00", close: "18:00", enabled: true },
    saturday: { open: "10:00", close: "16:00", enabled: false },
    sunday: { open: "00:00", close: "00:00", enabled: false },
  },
  defaultWindow: { start: "09:00", end: "20:00" },
}

export const generateContacts = (): Contact[] => [
  {
    id: "c1",
    name: "John Smith",
    phone: "+1 (555) 123-4567",
    email: "john@example.com",
    tags: ["vip"],
    smsOptOut: false,
    lastContactedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "c2",
    name: "Sarah Johnson",
    phone: "+1 (555) 234-5678",
    email: "sarah@example.com",
    tags: [],
    smsOptOut: false,
  },
  { id: "c3", name: "Mike Davis", phone: "+1 (555) 345-6789", tags: ["returning"], smsOptOut: false },
  {
    id: "c4",
    name: "Emily Brown",
    phone: "+1 (555) 456-7890",
    email: "emily@example.com",
    tags: ["high-value"],
    smsOptOut: false,
  },
  {
    id: "c5",
    name: "David Wilson",
    phone: "+1 (555) 567-8901",
    tags: [],
    smsOptOut: true,
    lastContactedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "c6",
    name: "Lisa Garcia",
    phone: "+1 (555) 678-9012",
    email: "lisa@example.com",
    tags: ["catering"],
    smsOptOut: false,
  },
  { id: "c7", name: "James Martinez", phone: "+1 (555) 789-0123", tags: [], smsOptOut: false },
  {
    id: "c8",
    name: "Jennifer Lee",
    phone: "+1 (555) 890-1234",
    email: "jennifer@example.com",
    tags: ["fleet"],
    smsOptOut: false,
  },
  { id: "c9", name: "Robert Taylor", phone: "+1 (555) 901-2345", tags: ["complaint"], smsOptOut: false },
  {
    id: "c10",
    name: "Michelle Anderson",
    phone: "+1 (555) 012-3456",
    email: "michelle@example.com",
    tags: [],
    smsOptOut: false,
  },
  { id: "c11", phone: "+1 (555) 111-2222", tags: [], smsOptOut: false },
  { id: "c12", name: "Carlos Rodriguez", phone: "+1 (555) 222-3333", tags: ["large-party"], smsOptOut: false },
]

export const generateCalls = (): Call[] => {
  const contacts = generateContacts()
  return [
    {
      id: "call1",
      contactId: "c1",
      time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "missed",
      durationSec: 0,
      summary: "Caller hung up before agent connected",
      intent: "booking",
      sentiment: "neutral",
      extractedFields: { vehicle: "2019 Honda Accord" },
    },
    {
      id: "call2",
      contactId: "c2",
      time: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "handled",
      durationSec: 180,
      summary: "Customer inquired about reservation for 6 people",
      intent: "reservation",
      sentiment: "positive",
      extractedFields: { partySize: "6", date: "Saturday" },
      transcriptStatus: "available",
    },
    {
      id: "call3",
      contactId: "c3",
      time: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 420,
      summary: "Quote requested for brake replacement",
      intent: "quote",
      sentiment: "neutral",
      extractedFields: { service: "brake replacement", vehicle: "2020 Toyota Camry" },
      transcriptStatus: "processing",
    },
    {
      id: "call4",
      contactId: "c4",
      time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "missed",
      durationSec: 0,
      summary: "Missed call - no voicemail",
      extractedFields: {},
      transcriptStatus: "unavailable",
    },
    {
      id: "call5",
      contactId: "c5",
      time: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "escalated",
      durationSec: 300,
      summary: "Customer complained about wrong order",
      intent: "complaint",
      sentiment: "negative",
      extractedFields: { issue: "wrong order", orderNumber: "12345" },
    },
    {
      id: "call6",
      contactId: "c6",
      time: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "handled",
      durationSec: 600,
      summary: "Catering inquiry for corporate event",
      intent: "catering",
      sentiment: "positive",
      extractedFields: { eventType: "corporate", headcount: "50", date: "March 15" },
    },
    {
      id: "call7",
      contactId: "c7",
      time: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "abandoned",
      durationSec: 15,
      summary: "Caller abandoned during hold",
      extractedFields: {},
    },
    {
      id: "call8",
      contactId: "c8",
      time: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 540,
      summary: "Fleet vehicle ready for pickup, payment pending",
      intent: "pickup",
      sentiment: "neutral",
      extractedFields: { vehicle: "2021 Ford F-150", invoice: "INV-789" },
    },
    {
      id: "call9",
      contactId: "c9",
      time: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "escalated",
      durationSec: 240,
      summary: "Customer upset about wait time",
      intent: "complaint",
      sentiment: "negative",
      extractedFields: { issue: "long wait", waitTime: "45 minutes" },
    },
    {
      id: "call10",
      contactId: "c10",
      time: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 360,
      summary: "Estimate approved, scheduling service",
      intent: "booking",
      sentiment: "positive",
      extractedFields: { service: "oil change + tire rotation", vehicle: "2018 Nissan Altima" },
    },
    {
      id: "call11",
      contactId: "c11",
      time: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "missed",
      durationSec: 0,
      extractedFields: {},
    },
    {
      id: "call12",
      contactId: "c12",
      time: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "handled",
      durationSec: 480,
      summary: "Large party reservation for 15 people",
      intent: "large_party",
      sentiment: "positive",
      extractedFields: { partySize: "15", date: "Next Friday", time: "7:00 PM" },
    },
    {
      id: "call13",
      contactId: "c1",
      time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 300,
      summary: "Requested estimate for transmission service",
      intent: "quote",
      sentiment: "neutral",
      extractedFields: { service: "transmission", vehicle: "2019 Honda Accord" },
    },
    {
      id: "call14",
      contactId: "c2",
      time: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "abandoned",
      durationSec: 8,
      extractedFields: {},
    },
    {
      id: "call15",
      contactId: "c3",
      time: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 240,
      summary: "Vehicle ready, payment collected",
      intent: "pickup",
      sentiment: "positive",
      extractedFields: { vehicle: "2020 Toyota Camry", paid: "true" },
    },
    {
      id: "call16",
      contactId: "c4",
      time: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 180,
      summary: "Booking confirmed for next week",
      intent: "booking",
      sentiment: "positive",
      extractedFields: { date: "Next Tuesday", time: "10:00 AM" },
    },
    {
      id: "call17",
      contactId: "c6",
      time: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      agentId: "agent2",
      lineId: "line2",
      direction: "inbound",
      outcome: "handled",
      durationSec: 420,
      summary: "Follow-up on catering menu options",
      intent: "catering",
      sentiment: "positive",
      extractedFields: { menu: "premium package" },
    },
    {
      id: "call18",
      contactId: "c7",
      time: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "missed",
      durationSec: 0,
      extractedFields: {},
    },
    {
      id: "call19",
      contactId: "c8",
      time: new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "outbound",
      outcome: "handled",
      durationSec: 120,
      summary: "Reminder call for scheduled service",
      extractedFields: {},
    },
    {
      id: "call20",
      contactId: "c10",
      time: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      agentId: "agent1",
      lineId: "line1",
      direction: "inbound",
      outcome: "handled",
      durationSec: 300,
      summary: "New customer inquiry about services",
      intent: "general",
      sentiment: "positive",
      extractedFields: {},
    },
  ]
}

// Generate mock follow-ups
export const generateFollowUps = (): FollowUp[] => [
  {
    id: "fu1",
    contactId: "c1",
    callId: "call1",
    type: "missed_call",
    status: "open",
    priority: 1,
    severity: "high",
    dueAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send SMS with callback link",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [],
    scheduledSteps: [
      {
        id: "ss1",
        runAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        actionKey: "send_sms",
        channel: "sms",
        templateId: "t1",
        status: "scheduled",
      },
    ],
    metadata: { vehicle: "2019 Honda Accord" },
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu2",
    contactId: "c2",
    callId: "call2",
    type: "reservation",
    status: "waiting_on_customer",
    priority: 2,
    severity: "medium",
    dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    recommendedNextStep: "Wait for booking confirmation",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      {
        id: "a1",
        type: "sms",
        time: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
        result: "delivered",
        note: "Booking link sent",
      },
    ],
    scheduledSteps: [],
    metadata: { partySize: "6" },
    vertical: "Restaurant",
    tags: [],
  },
  {
    id: "fu3",
    contactId: "c3",
    callId: "call3",
    type: "estimate_approval",
    status: "open",
    priority: 1,
    severity: "high",
    dueAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send estimate approval request",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [],
    scheduledSteps: [
      {
        id: "ss2",
        runAt: new Date().toISOString(),
        actionKey: "send_estimate",
        channel: "sms",
        templateId: "t3",
        status: "scheduled",
      },
    ],
    metadata: { service: "brake replacement", estimateAmount: "$450" },
    vertical: "AutoShop",
    tags: ["high-value"],
  },
  {
    id: "fu4",
    contactId: "c4",
    callId: "call4",
    type: "missed_call",
    status: "in_progress",
    priority: 1,
    severity: "medium",
    dueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "AI call follow-up",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [
      { id: "a2", type: "sms", time: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(), result: "delivered" },
    ],
    scheduledSteps: [
      {
        id: "ss3",
        runAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        actionKey: "ai_call",
        channel: "ai_call",
        status: "scheduled",
      },
    ],
    metadata: {},
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu5",
    contactId: "c5",
    callId: "call5",
    type: "complaint",
    status: "open",
    priority: 1,
    severity: "critical",
    ownerId: "manager",
    dueAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Manager review required",
    channelPlan: { primary: "manual", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: { issue: "wrong order" },
    vertical: "Restaurant",
    tags: ["escalated"],
  },
  {
    id: "fu6",
    contactId: "c6",
    callId: "call6",
    type: "catering",
    status: "waiting_on_customer",
    priority: 2,
    severity: "medium",
    ownerId: "manager",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Wait for form submission",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [
      {
        id: "a3",
        type: "sms",
        time: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString(),
        result: "delivered",
        note: "Intake form sent",
      },
    ],
    scheduledSteps: [
      {
        id: "ss4",
        runAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        actionKey: "reminder_sms",
        channel: "sms",
        templateId: "t6",
        status: "scheduled",
      },
    ],
    metadata: { headcount: "50", eventType: "corporate" },
    vertical: "Restaurant",
    tags: ["high-value"],
  },
  {
    id: "fu7",
    contactId: "c7",
    callId: "call7",
    type: "missed_call",
    status: "open",
    priority: 2,
    severity: "medium",
    dueAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send SMS triage",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: {},
    vertical: "Restaurant",
    tags: [],
  },
  {
    id: "fu8",
    contactId: "c8",
    callId: "call8",
    type: "ready_pickup",
    status: "in_progress",
    priority: 1,
    severity: "medium",
    dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send payment link reminder",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      { id: "a4", type: "sms", time: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), result: "delivered" },
    ],
    scheduledSteps: [],
    metadata: { vehicle: "2021 Ford F-150", invoice: "INV-789" },
    vertical: "AutoShop",
    tags: ["fleet"],
  },
  {
    id: "fu9",
    contactId: "c9",
    callId: "call9",
    type: "complaint",
    status: "open",
    priority: 1,
    severity: "high",
    ownerId: "manager",
    dueAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send apology and info form",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: { issue: "long wait" },
    vertical: "Restaurant",
    tags: ["escalated"],
  },
  {
    id: "fu10",
    contactId: "c10",
    callId: "call10",
    type: "booking",
    status: "done",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      { id: "a5", type: "sms", time: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), result: "completed" },
    ],
    scheduledSteps: [],
    metadata: {},
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu11",
    contactId: "c11",
    callId: "call11",
    type: "missed_call",
    status: "snoozed",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Follow up tomorrow",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      { id: "a6", type: "sms", time: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(), result: "sent" },
    ],
    scheduledSteps: [],
    metadata: {},
    vertical: "Common",
    tags: [],
  },
  {
    id: "fu12",
    contactId: "c12",
    callId: "call12",
    type: "large_party",
    status: "waiting_on_customer",
    priority: 1,
    severity: "medium",
    ownerId: "manager",
    dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Wait for confirmation",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [
      { id: "a7", type: "sms", time: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(), result: "delivered" },
    ],
    scheduledSteps: [],
    metadata: { partySize: "15" },
    vertical: "Restaurant",
    tags: ["high-value"],
  },
  {
    id: "fu13",
    contactId: "c1",
    callId: "call13",
    type: "estimate_approval",
    status: "scheduled",
    priority: 2,
    severity: "medium",
    dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Waiting for 24h reminder",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [
      { id: "a8", type: "sms", time: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(), result: "delivered" },
    ],
    scheduledSteps: [
      {
        id: "ss5",
        runAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
        actionKey: "reminder_sms",
        channel: "sms",
        status: "scheduled",
      },
    ],
    metadata: { service: "transmission" },
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu14",
    contactId: "c2",
    callId: "call14",
    type: "missed_call",
    status: "failed",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      {
        id: "a9",
        type: "sms",
        time: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        result: "failed",
        note: "Invalid number",
      },
    ],
    scheduledSteps: [],
    metadata: {},
    vertical: "Restaurant",
    tags: [],
  },
  {
    id: "fu15",
    contactId: "c3",
    callId: "call15",
    type: "ready_pickup",
    status: "done",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      { id: "a10", type: "sms", time: new Date(Date.now() - 29 * 60 * 60 * 1000).toISOString(), result: "completed" },
    ],
    scheduledSteps: [],
    metadata: { paid: "true" },
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu16",
    contactId: "c4",
    callId: "call16",
    type: "booking",
    status: "done",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() - 34 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(),
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      { id: "a11", type: "sms", time: new Date(Date.now() - 35 * 60 * 60 * 1000).toISOString(), result: "completed" },
    ],
    scheduledSteps: [],
    metadata: {},
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu17",
    contactId: "c6",
    type: "catering",
    status: "in_progress",
    priority: 2,
    severity: "medium",
    ownerId: "manager",
    dueAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Confirm menu selection",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [
      {
        id: "a12",
        type: "sms",
        time: new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString(),
        result: "replied",
        note: "Customer replied with questions",
      },
    ],
    scheduledSteps: [],
    metadata: { menu: "premium package" },
    vertical: "Restaurant",
    notes: "Customer interested in premium package",
    tags: [],
  },
  {
    id: "fu18",
    contactId: "c7",
    callId: "call18",
    type: "missed_call",
    status: "canceled",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(),
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: {},
    vertical: "AutoShop",
    tags: [],
  },
  {
    id: "fu19",
    contactId: "c8",
    type: "payment_pending",
    status: "open",
    priority: 1,
    severity: "high",
    dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send payment reminder",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: { invoice: "INV-789", amount: "$1,250" },
    vertical: "AutoShop",
    tags: ["fleet"],
  },
  {
    id: "fu20",
    contactId: "c10",
    type: "booking",
    status: "open",
    priority: 2,
    severity: "medium",
    dueAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send booking confirmation",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: {},
    vertical: "AutoShop",
    tags: ["new-customer"],
  },
  {
    id: "fu21",
    contactId: "c1",
    type: "general",
    status: "open",
    priority: 3,
    severity: "low",
    dueAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send follow-up message",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: {},
    vertical: "Common",
    tags: [],
  },
  {
    id: "fu22",
    contactId: "c12",
    type: "order_issue",
    status: "open",
    priority: 1,
    severity: "high",
    ownerId: "manager",
    dueAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Request issue details",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [],
    scheduledSteps: [],
    metadata: {},
    vertical: "Restaurant",
    tags: [],
  },
  {
    id: "fu23",
    contactId: "c4",
    type: "missed_call",
    status: "open",
    priority: 2,
    severity: "medium",
    dueAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    recommendedNextStep: "Send callback SMS",
    channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
    attempts: [],
    scheduledSteps: [],
    metadata: {},
    vertical: "Common",
    tags: [],
  },
  {
    id: "fu24",
    contactId: "c7",
    type: "reservation",
    status: "waiting_on_customer",
    priority: 2,
    severity: "medium",
    dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Await booking link click",
    channelPlan: { primary: "sms", fallbacks: [] },
    attempts: [
      { id: "a13", type: "sms", time: new Date(Date.now() - 55 * 60 * 1000).toISOString(), result: "delivered" },
    ],
    scheduledSteps: [],
    metadata: {},
    vertical: "Restaurant",
    tags: [],
  },
  {
    id: "fu25",
    contactId: "c9",
    type: "complaint",
    status: "in_progress",
    priority: 1,
    severity: "critical",
    ownerId: "manager",
    dueAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    recommendedNextStep: "Manager callback required",
    channelPlan: { primary: "manual", fallbacks: [] },
    attempts: [
      {
        id: "a14",
        type: "sms",
        time: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        result: "delivered",
        note: "Apology sent",
      },
    ],
    scheduledSteps: [],
    metadata: { issue: "food quality" },
    vertical: "Restaurant",
    notes: "Customer very upset, needs personal attention",
    tags: ["escalated", "urgent"],
  },
]

// Generate built-in workflows
export const generateWorkflows = (): Workflow[] => [
  // Common: Missed Call Recovery
  {
    id: "wf1",
    vertical: "Common",
    name: "Missed Call Recovery",
    enabled: true,
    triggerKey: "missed_call",
    conditions: { outcomes: ["missed", "abandoned", "failed"] },
    steps: [
      { id: "s1", actionKey: "send_sms", delayMinutes: 1, channel: "sms", templateId: "t1" },
      {
        id: "s2",
        actionKey: "ai_call",
        delayMinutes: 20,
        channel: "ai_call",
        onlyIfWithinHours: true,
        stopIf: ["replied", "opted_out", "booking_created"],
      },
      {
        id: "s3",
        actionKey: "final_sms",
        delayMinutes: 120,
        channel: "sms",
        templateId: "t2",
        stopIf: ["replied", "opted_out"],
      },
    ],
    attemptBudget: { smsMax: 2, aiCallMax: 1, totalMax: 3 },
    escalationRules: [{ id: "e1", condition: "repeated_caller_24h", action: "elevate_severity" }],
    slaMinutes: 30,
    defaultOwnerStrategy: "unassigned",
    isBuiltIn: true,
  },
  // AutoShop: Booking Conversion
  {
    id: "wf2",
    vertical: "AutoShop",
    name: "Booking Conversion",
    enabled: true,
    triggerKey: "booking_request",
    conditions: { intents: ["booking", "schedule", "appointment"] },
    steps: [
      { id: "s1", actionKey: "collect_info_sms", delayMinutes: 0, channel: "sms", templateId: "t3" },
      {
        id: "s2",
        actionKey: "reminder_sms",
        delayMinutes: 120,
        channel: "sms",
        templateId: "t4",
        stopIf: ["replied", "booking_created"],
      },
      {
        id: "s3",
        actionKey: "ai_call",
        delayMinutes: 240,
        channel: "ai_call",
        onlyIfWithinHours: true,
        stopIf: ["replied", "booking_created", "opted_out"],
      },
    ],
    attemptBudget: { smsMax: 2, aiCallMax: 1, totalMax: 3 },
    escalationRules: [],
    slaMinutes: 60,
    defaultOwnerStrategy: "unassigned",
    isBuiltIn: true,
  },
  // AutoShop: Estimate Approval
  {
    id: "wf3",
    vertical: "AutoShop",
    name: "Estimate Approval",
    enabled: true,
    triggerKey: "estimate_request",
    conditions: { intents: ["quote", "estimate", "price"] },
    steps: [
      { id: "s1", actionKey: "send_estimate_sms", delayMinutes: 0, channel: "sms", templateId: "t5" },
      {
        id: "s2",
        actionKey: "reminder_sms",
        delayMinutes: 1440,
        channel: "sms",
        templateId: "t6",
        stopIf: ["replied", "approved", "declined"],
      },
      {
        id: "s3",
        actionKey: "ai_call",
        delayMinutes: 1500,
        channel: "ai_call",
        onlyIfWithinHours: true,
        stopIf: ["replied", "approved", "declined", "opted_out"],
      },
    ],
    attemptBudget: { smsMax: 2, aiCallMax: 1, totalMax: 3 },
    escalationRules: [
      { id: "e1", condition: "customer_question", action: "assign_human" },
      { id: "e2", condition: "high_value_tag", action: "prioritize" },
    ],
    slaMinutes: 1440,
    defaultOwnerStrategy: "unassigned",
    isBuiltIn: true,
  },
  // AutoShop: Ready for Pickup
  {
    id: "wf4",
    vertical: "AutoShop",
    name: "Ready for Pickup + Payment",
    enabled: true,
    triggerKey: "ready_pickup",
    conditions: { events: ["vehicle_ready"] },
    steps: [
      { id: "s1", actionKey: "pickup_sms", delayMinutes: 0, channel: "sms", templateId: "t7" },
      {
        id: "s2",
        actionKey: "morning_reminder",
        delayMinutes: 960,
        channel: "sms",
        templateId: "t8",
        stopIf: ["paid", "picked_up"],
      },
      {
        id: "s3",
        actionKey: "ai_call",
        delayMinutes: 2880,
        channel: "ai_call",
        onlyIfWithinHours: true,
        stopIf: ["paid", "picked_up", "opted_out"],
      },
    ],
    attemptBudget: { smsMax: 2, aiCallMax: 1, totalMax: 3 },
    escalationRules: [],
    slaMinutes: 480,
    defaultOwnerStrategy: "unassigned",
    isBuiltIn: true,
  },
  // Restaurant: Missed Call Triage
  {
    id: "wf5",
    vertical: "Restaurant",
    name: "Missed Call Triage",
    enabled: true,
    triggerKey: "missed_call",
    conditions: { outcomes: ["missed", "abandoned"] },
    steps: [{ id: "s1", actionKey: "triage_sms", delayMinutes: 0, channel: "sms", templateId: "t9" }],
    attemptBudget: { smsMax: 1, aiCallMax: 0, totalMax: 1 },
    escalationRules: [
      { id: "e1", condition: "reply_catering", action: "create_catering_followup", assignTo: "manager" },
      { id: "e2", condition: "reply_order_issue", action: "create_order_issue_followup" },
      { id: "e3", condition: "reply_reservation", action: "create_reservation_followup" },
    ],
    slaMinutes: 15,
    defaultOwnerStrategy: "unassigned",
    isBuiltIn: true,
  },
  // Restaurant: Catering / Large Party
  {
    id: "wf6",
    vertical: "Restaurant",
    name: "Catering / Large Party Conversion",
    enabled: true,
    triggerKey: "catering_inquiry",
    conditions: { intents: ["catering", "large_party", "event"] },
    steps: [
      { id: "s1", actionKey: "intake_form_sms", delayMinutes: 0, channel: "sms", templateId: "t10" },
      {
        id: "s2",
        actionKey: "reminder_sms",
        delayMinutes: 120,
        channel: "sms",
        templateId: "t11",
        stopIf: ["form_submitted", "booking_confirmed"],
      },
      {
        id: "s3",
        actionKey: "ai_call",
        delayMinutes: 240,
        channel: "ai_call",
        onlyIfWithinHours: true,
        stopIf: ["form_submitted", "booking_confirmed", "opted_out"],
      },
    ],
    attemptBudget: { smsMax: 2, aiCallMax: 1, totalMax: 3 },
    escalationRules: [],
    slaMinutes: 120,
    defaultOwnerStrategy: "manager",
    isBuiltIn: true,
  },
  // Restaurant: Complaint Recovery
  {
    id: "wf7",
    vertical: "Restaurant",
    name: "Complaint / Order Issue Recovery",
    enabled: true,
    triggerKey: "complaint",
    conditions: { sentiments: ["negative"], keywords: ["refund", "wrong", "late", "complaint"] },
    steps: [{ id: "s1", actionKey: "apology_sms", delayMinutes: 0, channel: "sms", templateId: "t12" }],
    attemptBudget: { smsMax: 1, aiCallMax: 0, totalMax: 1 },
    escalationRules: [],
    slaMinutes: 30,
    defaultOwnerStrategy: "manager",
    isBuiltIn: true,
  },
]

// Generate templates
export const generateTemplates = (): Template[] => [
  // AutoShop Templates
  {
    id: "t1",
    vertical: "AutoShop",
    type: "missed_call",
    title: "Missed Call - Initial",
    smsTemplate:
      "Hi {name}, we missed your call at {shopName}! Reply or click here to schedule: {bookingLink}. Questions? Just text back!",
    tokens: ["name", "shopName", "bookingLink"],
    checklist: ["Confirm callback number", "Check for voicemail"],
    defaultNextSteps: ["Send booking link", "Schedule AI callback"],
    links: { bookingLink: "https://book.example.com/autoshop" },
  },
  {
    id: "t2",
    vertical: "AutoShop",
    type: "missed_call",
    title: "Missed Call - Final Reminder",
    smsTemplate:
      "Hi {name}, this is {shopName} following up. We'd love to help with your {vehicle}. Book online anytime: {bookingLink}",
    tokens: ["name", "shopName", "vehicle", "bookingLink"],
    checklist: [],
    defaultNextSteps: [],
    links: { bookingLink: "https://book.example.com/autoshop" },
  },
  {
    id: "t3",
    vertical: "AutoShop",
    type: "booking",
    title: "Booking - Collect Info",
    smsTemplate:
      "Thanks for reaching out to {shopName}! To schedule your appointment, please provide your vehicle info and preferred time: {bookingLink}",
    tokens: ["shopName", "bookingLink"],
    checklist: ["Confirm vehicle make/model/year", "Confirm preferred date/time"],
    defaultNextSteps: ["Send confirmation", "Add to calendar"],
    links: { bookingLink: "https://book.example.com/autoshop/schedule" },
  },
  {
    id: "t4",
    vertical: "AutoShop",
    type: "booking",
    title: "Booking - Reminder",
    smsTemplate:
      "Hi {name}, just a reminder to complete your booking at {shopName}. Click here to schedule: {bookingLink}",
    tokens: ["name", "shopName", "bookingLink"],
    checklist: [],
    defaultNextSteps: [],
    links: { bookingLink: "https://book.example.com/autoshop/schedule" },
  },
  {
    id: "t5",
    vertical: "AutoShop",
    type: "estimate_approval",
    title: "Estimate - Initial",
    smsTemplate:
      "Hi {name}, your estimate for {vehicle} is ready: {estimateLink}\n\nReply:\n1️⃣ APPROVE\n2️⃣ QUESTION\n3️⃣ NO THANKS",
    quickReplies: ["APPROVE", "QUESTION", "NO THANKS"],
    tokens: ["name", "vehicle", "estimateLink"],
    checklist: ["Review estimate details", "Confirm parts availability"],
    defaultNextSteps: ["Schedule service", "Answer questions"],
    links: { estimateLink: "https://estimates.example.com/view" },
  },
  {
    id: "t6",
    vertical: "AutoShop",
    type: "estimate_approval",
    title: "Estimate - Reminder",
    smsTemplate:
      "Hi {name}, just following up on your estimate for {vehicle}. View and approve here: {estimateLink} or reply with questions!",
    tokens: ["name", "vehicle", "estimateLink"],
    checklist: [],
    defaultNextSteps: [],
    links: { estimateLink: "https://estimates.example.com/view" },
  },
  {
    id: "t7",
    vertical: "AutoShop",
    type: "ready_pickup",
    title: "Ready for Pickup",
    smsTemplate:
      "Great news {name}! Your {vehicle} is ready for pickup at {shopName}.\n\nHours: {hours}\nPay now: {paymentLink}",
    tokens: ["name", "vehicle", "shopName", "hours", "paymentLink"],
    checklist: ["Confirm payment received", "Prepare paperwork", "Clean vehicle"],
    defaultNextSteps: ["Process payment", "Schedule pickup time"],
    links: { paymentLink: "https://pay.example.com/invoice" },
  },
  {
    id: "t8",
    vertical: "AutoShop",
    type: "ready_pickup",
    title: "Pickup Reminder",
    smsTemplate:
      "Hi {name}, reminder that your {vehicle} is waiting at {shopName}. We're open {hours}. Pay online to save time: {paymentLink}",
    tokens: ["name", "vehicle", "shopName", "hours", "paymentLink"],
    checklist: [],
    defaultNextSteps: [],
    links: { paymentLink: "https://pay.example.com/invoice" },
  },
  // Restaurant Templates
  {
    id: "t9",
    vertical: "Restaurant",
    type: "missed_call",
    title: "Missed Call - Triage",
    smsTemplate:
      "Hi from {restaurantName}! We missed your call. How can we help?\n\n1️⃣ Reservation\n2️⃣ Catering/Large Party\n3️⃣ Order Issue\n\nReply with 1, 2, or 3!",
    quickReplies: ["1", "2", "3"],
    tokens: ["restaurantName"],
    checklist: ["Check for voicemail", "Review caller history"],
    defaultNextSteps: ["Route based on reply"],
    links: {},
  },
  {
    id: "t10",
    vertical: "Restaurant",
    type: "catering",
    title: "Catering - Intake Form",
    smsTemplate:
      "Thanks for your interest in catering at {restaurantName}! Please fill out our event form: {formLink}\n\nDeposit link: {paymentLink}",
    tokens: ["restaurantName", "formLink", "paymentLink"],
    checklist: ["Review event details", "Check availability", "Prepare menu options"],
    defaultNextSteps: ["Send menu options", "Confirm deposit"],
    links: { formLink: "https://forms.example.com/catering", paymentLink: "https://pay.example.com/deposit" },
  },
  {
    id: "t11",
    vertical: "Restaurant",
    type: "catering",
    title: "Catering - Reminder",
    smsTemplate:
      "Hi {name}, just following up on your event inquiry at {restaurantName}. Complete your details here: {formLink}",
    tokens: ["name", "restaurantName", "formLink"],
    checklist: [],
    defaultNextSteps: [],
    links: { formLink: "https://forms.example.com/catering" },
  },
  {
    id: "t12",
    vertical: "Restaurant",
    type: "complaint",
    title: "Complaint - Apology",
    smsTemplate:
      "We're so sorry to hear about your experience at {restaurantName}. Your feedback matters to us. Please share details: {formLink}\n\nWe'll make it right!",
    tokens: ["restaurantName", "formLink"],
    checklist: ["Review complaint details", "Prepare resolution offer", "Log for quality tracking"],
    defaultNextSteps: ["Offer compensation", "Schedule manager callback"],
    links: { formLink: "https://forms.example.com/feedback" },
  },
  {
    id: "t13",
    vertical: "Restaurant",
    type: "reservation",
    title: "Reservation - Booking Link",
    smsTemplate:
      "Thanks for choosing {restaurantName}! Book your table here: {bookingLink}\n\nFor parties of 8+, please call us directly.",
    tokens: ["restaurantName", "bookingLink"],
    checklist: ["Check table availability"],
    defaultNextSteps: ["Confirm reservation", "Send reminder"],
    links: { bookingLink: "https://book.example.com/restaurant" },
  },
  {
    id: "t14",
    vertical: "Restaurant",
    type: "large_party",
    title: "Large Party - Inquiry",
    smsTemplate:
      "Thanks for your interest in hosting your party at {restaurantName}! For groups of {partySize}+, we have special menus. Details: {formLink}",
    tokens: ["restaurantName", "partySize", "formLink"],
    checklist: ["Confirm party size", "Check private room availability"],
    defaultNextSteps: ["Send menu options", "Schedule call"],
    links: { formLink: "https://forms.example.com/large-party" },
  },
  // Common Templates
  {
    id: "t15",
    vertical: "Common",
    type: "general",
    title: "General Follow-up",
    smsTemplate:
      "Hi {name}, thanks for contacting us! How can we help you today? Reply to this message or call us at {phone}.",
    tokens: ["name", "phone"],
    checklist: ["Review call notes", "Check customer history"],
    defaultNextSteps: ["Respond to inquiry", "Schedule callback"],
    links: {},
  },
]

const initialState: ActionsState = {
  contacts: [],
  calls: [],
  followUps: [],
  workflows: [],
  templates: [],
  businessHours: defaultBusinessHours,
  automationRunning: false,
}

// ============================================================================
// REDUCER
// ============================================================================

function reducer(state: ActionsState, action: ActionsAction): ActionsState {
  switch (action.type) {
    case "SET_CONTACTS":
      return { ...state, contacts: action.contacts }
    case "UPDATE_CONTACT":
      return { ...state, contacts: state.contacts.map((c) => (c.id === action.id ? { ...c, ...action.updates } : c)) }
    case "SET_CALLS":
      return { ...state, calls: action.calls }
    case "SET_FOLLOW_UPS":
      return { ...state, followUps: action.followUps }
    case "ADD_FOLLOW_UP":
      return { ...state, followUps: [action.followUp, ...state.followUps] }
    case "UPDATE_FOLLOW_UP":
      return { ...state, followUps: state.followUps.map((f) => (f.id === action.id ? { ...f, ...action.updates } : f)) }
    case "DELETE_FOLLOW_UP":
      return { ...state, followUps: state.followUps.filter((f) => f.id !== action.id) }
    case "ADD_ATTEMPT":
      return {
        ...state,
        followUps: state.followUps.map((f) =>
          f.id === action.followUpId ? { ...f, attempts: [...f.attempts, action.attempt] } : f,
        ),
      }
    case "ADD_SCHEDULED_STEP":
      return {
        ...state,
        followUps: state.followUps.map((f) =>
          f.id === action.followUpId ? { ...f, scheduledSteps: [...f.scheduledSteps, action.step] } : f,
        ),
      }
    case "UPDATE_SCHEDULED_STEP":
      return {
        ...state,
        followUps: state.followUps.map((f) =>
          f.id === action.followUpId
            ? {
                ...f,
                scheduledSteps: f.scheduledSteps.map((s) => (s.id === action.stepId ? { ...s, ...action.updates } : s)),
              }
            : f,
        ),
      }
    case "SET_WORKFLOWS":
      return { ...state, workflows: action.workflows }
    case "ADD_WORKFLOW":
      return { ...state, workflows: [action.workflow, ...state.workflows] }
    case "UPDATE_WORKFLOW":
      return { ...state, workflows: state.workflows.map((w) => (w.id === action.id ? { ...w, ...action.updates } : w)) }
    case "DELETE_WORKFLOW":
      return { ...state, workflows: state.workflows.filter((w) => w.id !== action.id) }
    case "SET_TEMPLATES":
      return { ...state, templates: action.templates }
    case "ADD_TEMPLATE":
      return { ...state, templates: [action.template, ...state.templates] }
    case "UPDATE_TEMPLATE":
      return { ...state, templates: state.templates.map((t) => (t.id === action.id ? { ...t, ...action.updates } : t)) }
    case "DELETE_TEMPLATE":
      return { ...state, templates: state.templates.filter((t) => t.id !== action.id) }
    case "SET_BUSINESS_HOURS":
      return { ...state, businessHours: action.hours }
    case "SET_AUTOMATION_RUNNING":
      return { ...state, automationRunning: action.running }
    default:
      return state
  }
}

// ============================================================================
// CONTEXT
// ============================================================================

interface ActionsContextValue {
  state: ActionsState
  dispatch: React.Dispatch<ActionsAction>
  getContact: (id: string) => Contact | undefined
  getCall: (id: string) => Call | undefined
  getTemplate: (id: string) => Template | undefined
  getWorkflow: (id: string) => Workflow | undefined
  isWithinBusinessHours: () => boolean
}

const ActionsContext = createContext<ActionsContextValue | null>(null)

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    let cancelled = false

    import("@/lib/data/actions").then(({ getContacts, getCalls, getFollowUps, getWorkflows, getTemplates }) =>
      Promise.all([getContacts(), getCalls(), getFollowUps(), getWorkflows(), getTemplates()])
        .then(([contacts, calls, followUps, workflows, templates]) => {
          if (cancelled) return
          dispatch({ type: "SET_CONTACTS", contacts })
          dispatch({ type: "SET_CALLS", calls })
          dispatch({ type: "SET_FOLLOW_UPS", followUps })
          dispatch({ type: "SET_WORKFLOWS", workflows })
          dispatch({ type: "SET_TEMPLATES", templates })
        })
    ).catch((err) => {
      if (!cancelled) console.error("Failed to load actions data:", err)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Persist workflows, templates, and business hours to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("rezovo_actions_data")
      if (stored) {
        try {
          const data = JSON.parse(stored)
          if (data.workflows) dispatch({ type: "SET_WORKFLOWS", workflows: data.workflows })
          if (data.templates) dispatch({ type: "SET_TEMPLATES", templates: data.templates })
          if (data.businessHours) dispatch({ type: "SET_BUSINESS_HOURS", hours: data.businessHours })
        } catch (e) {
          console.error("Failed to parse stored actions data:", e)
        }
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(
        "rezovo_actions_data",
        JSON.stringify({
          workflows: state.workflows,
          templates: state.templates,
          businessHours: state.businessHours,
        }),
      )
    }
  }, [state.workflows, state.templates, state.businessHours])

  const getContact = (id: string) => state.contacts.find((c) => c.id === id)
  const getCall = (id: string) => state.calls.find((c) => c.id === id)
  const getTemplate = (id: string) => state.templates.find((t) => t.id === id)
  const getWorkflow = (id: string) => state.workflows.find((w) => w.id === id)

  const isWithinBusinessHours = () => {
    const now = new Date()
    const hours = now.getHours()
    const minutes = now.getMinutes()
    const currentTime = hours * 60 + minutes

    if (state.businessHours.enabled) {
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
      const today = days[now.getDay()]
      const schedule = state.businessHours.schedule[today]

      if (!schedule?.enabled) return false

      const [openH, openM] = schedule.open.split(":").map(Number)
      const [closeH, closeM] = schedule.close.split(":").map(Number)
      const openTime = openH * 60 + openM
      const closeTime = closeH * 60 + closeM

      return currentTime >= openTime && currentTime <= closeTime
    } else {
      // Use default window
      const [startH, startM] = state.businessHours.defaultWindow.start.split(":").map(Number)
      const [endH, endM] = state.businessHours.defaultWindow.end.split(":").map(Number)
      const startTime = startH * 60 + startM
      const endTime = endH * 60 + endM

      return currentTime >= startTime && currentTime <= endTime
    }
  }

  return (
    <ActionsContext.Provider
      value={{ state, dispatch, getContact, getCall, getTemplate, getWorkflow, isWithinBusinessHours }}
    >
      {children}
    </ActionsContext.Provider>
  )
}

export function useActionsState() {
  const context = useContext(ActionsContext)
  if (!context) {
    throw new Error("useActionsState must be used within ActionsProvider")
  }
  return context
}

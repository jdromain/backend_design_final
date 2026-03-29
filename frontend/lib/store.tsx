"use client"

import type React from "react"
import { createContext, useContext, useReducer, useCallback, useEffect, type ReactNode } from "react"
import type {
  CallRecord,
  Agent,
  KBDocument,
  KBCollection,
  Integration,
  Notification,
  SavedView,
  UserSettings,
  TeamMember,
} from "@/types/api"
import { getCallHistory } from "@/lib/data/call-history"
import { getNotifications } from "@/lib/data/notifications"
import { getTeamMembers } from "@/lib/data/settings"

export type { CallRecord, Agent, KBDocument, KBCollection, Integration, Notification, SavedView, UserSettings, TeamMember }

// ============================================================================
// STATE
// ============================================================================

interface AppState {
  // Data
  calls: CallRecord[]
  liveCalls: CallRecord[]
  agents: Agent[]
  documents: KBDocument[]
  collections: KBCollection[]
  integrations: Integration[]
  notifications: Notification[]
  savedViews: SavedView[]
  teamMembers: TeamMember[]
  settings: UserSettings

  // UI State
  isLoading: Record<string, boolean>
  errors: Record<string, string | null>
  selectedItems: Record<string, string[]>
  viewMode: Record<string, "table" | "cards">
}

type Action =
  | { type: "SET_LOADING"; key: string; value: boolean }
  | { type: "SET_ERROR"; key: string; value: string | null }
  | { type: "SET_CALLS"; calls: CallRecord[] }
  | { type: "SET_LIVE_CALLS"; calls: CallRecord[] }
  | { type: "ADD_CALL"; call: CallRecord }
  | { type: "UPDATE_CALL"; id: string; updates: Partial<CallRecord> }
  | { type: "SET_AGENTS"; agents: Agent[] }
  | { type: "ADD_AGENT"; agent: Agent }
  | { type: "UPDATE_AGENT"; id: string; updates: Partial<Agent> }
  | { type: "DELETE_AGENT"; id: string }
  | { type: "SET_DOCUMENTS"; documents: KBDocument[] }
  | { type: "ADD_DOCUMENT"; document: KBDocument }
  | { type: "UPDATE_DOCUMENT"; id: string; updates: Partial<KBDocument> }
  | { type: "DELETE_DOCUMENT"; id: string }
  | { type: "SET_COLLECTIONS"; collections: KBCollection[] }
  | { type: "ADD_COLLECTION"; collection: KBCollection }
  | { type: "DELETE_COLLECTION"; id: string }
  | { type: "SET_INTEGRATIONS"; integrations: Integration[] }
  | { type: "UPDATE_INTEGRATION"; id: string; updates: Partial<Integration> }
  | { type: "SET_NOTIFICATIONS"; notifications: Notification[] }
  | { type: "ADD_NOTIFICATION"; notification: Notification }
  | { type: "MARK_NOTIFICATION_READ"; id: string }
  | { type: "MARK_ALL_NOTIFICATIONS_READ" }
  | { type: "SET_SAVED_VIEWS"; views: SavedView[] }
  | { type: "ADD_SAVED_VIEW"; view: SavedView }
  | { type: "DELETE_SAVED_VIEW"; id: string }
  | { type: "SET_TEAM_MEMBERS"; members: TeamMember[] }
  | { type: "ADD_TEAM_MEMBER"; member: TeamMember }
  | { type: "UPDATE_TEAM_MEMBER"; id: string; updates: Partial<TeamMember> }
  | { type: "REMOVE_TEAM_MEMBER"; id: string }
  | { type: "UPDATE_SETTINGS"; updates: Partial<UserSettings> }
  | { type: "SET_SELECTED_ITEMS"; key: string; items: string[] }
  | { type: "SET_VIEW_MODE"; key: string; mode: "table" | "cards" }

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialSettings: UserSettings = {
  workspace: {
    name: "Rezovo Demo",
    timezone: "America/New_York",
    businessHours: { start: "09:00", end: "18:00" },
    autoRefresh: true,
    refreshInterval: 30,
  },
  notifications: {
    emailRecipients: ["admin@rezovo.ai"],
    slackEnabled: false,
    slackWebhook: "",
    alertRules: {
      highVolume: true,
      escalations: true,
      failures: true,
      degradedIntegrations: true,
    },
    quietHours: { enabled: false, start: "22:00", end: "08:00" },
  },
  security: {
    mfaEnabled: false,
    allowedDomains: ["rezovo.ai"],
  },
  dataPrivacy: {
    recordCalls: true,
    transcriptRetention: 90,
    piiRedaction: true,
  },
  developer: {
    apiKeys: [
      {
        id: "key-1",
        name: "Production API Key",
        key: "rz_live_***********************",
        createdAt: "2024-01-15T10:00:00Z",
        lastUsed: "2024-01-20T14:30:00Z",
      },
    ],
    webhooks: { url: "", events: [], secret: "", enabled: false },
  },
}

const initialState: AppState = {
  calls: [],
  liveCalls: [],
  agents: [],
  documents: [],
  collections: [],
  integrations: [],
  notifications: [],
  savedViews: [],
  teamMembers: [],
  settings: initialSettings,
  isLoading: {},
  errors: {},
  selectedItems: {},
  viewMode: {},
}

// ============================================================================
// REDUCER
// ============================================================================

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, isLoading: { ...state.isLoading, [action.key]: action.value } }
    case "SET_ERROR":
      return { ...state, errors: { ...state.errors, [action.key]: action.value } }
    case "SET_CALLS":
      return { ...state, calls: action.calls }
    case "SET_LIVE_CALLS":
      return { ...state, liveCalls: action.calls }
    case "ADD_CALL":
      return { ...state, calls: [action.call, ...state.calls] }
    case "UPDATE_CALL":
      return { ...state, calls: state.calls.map((c) => (c.callId === action.id ? { ...c, ...action.updates } : c)) }
    case "SET_AGENTS":
      return { ...state, agents: action.agents }
    case "ADD_AGENT":
      return { ...state, agents: [action.agent, ...state.agents] }
    case "UPDATE_AGENT":
      return { ...state, agents: state.agents.map((a) => (a.id === action.id ? { ...a, ...action.updates } : a)) }
    case "DELETE_AGENT":
      return { ...state, agents: state.agents.filter((a) => a.id !== action.id) }
    case "SET_DOCUMENTS":
      return { ...state, documents: action.documents }
    case "ADD_DOCUMENT":
      return { ...state, documents: [action.document, ...state.documents] }
    case "UPDATE_DOCUMENT":
      return { ...state, documents: state.documents.map((d) => (d.id === action.id ? { ...d, ...action.updates } : d)) }
    case "DELETE_DOCUMENT":
      return { ...state, documents: state.documents.filter((d) => d.id !== action.id) }
    case "SET_COLLECTIONS":
      return { ...state, collections: action.collections }
    case "ADD_COLLECTION":
      return { ...state, collections: [action.collection, ...state.collections] }
    case "DELETE_COLLECTION":
      return { ...state, collections: state.collections.filter((c) => c.id !== action.id) }
    case "SET_INTEGRATIONS":
      return { ...state, integrations: action.integrations }
    case "UPDATE_INTEGRATION":
      return {
        ...state,
        integrations: state.integrations.map((i) => (i.id === action.id ? { ...i, ...action.updates } : i)),
      }
    case "SET_NOTIFICATIONS":
      return { ...state, notifications: action.notifications }
    case "ADD_NOTIFICATION":
      return { ...state, notifications: [action.notification, ...state.notifications] }
    case "MARK_NOTIFICATION_READ":
      return {
        ...state,
        notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, read: true } : n)),
      }
    case "MARK_ALL_NOTIFICATIONS_READ":
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) }
    case "SET_SAVED_VIEWS":
      return { ...state, savedViews: action.views }
    case "ADD_SAVED_VIEW":
      return { ...state, savedViews: [action.view, ...state.savedViews] }
    case "DELETE_SAVED_VIEW":
      return { ...state, savedViews: state.savedViews.filter((v) => v.id !== action.id) }
    case "SET_TEAM_MEMBERS":
      return { ...state, teamMembers: action.members }
    case "ADD_TEAM_MEMBER":
      return { ...state, teamMembers: [action.member, ...state.teamMembers] }
    case "UPDATE_TEAM_MEMBER":
      return {
        ...state,
        teamMembers: state.teamMembers.map((m) => (m.id === action.id ? { ...m, ...action.updates } : m)),
      }
    case "REMOVE_TEAM_MEMBER":
      return { ...state, teamMembers: state.teamMembers.filter((m) => m.id !== action.id) }
    case "UPDATE_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.updates } }
    case "SET_SELECTED_ITEMS":
      return { ...state, selectedItems: { ...state.selectedItems, [action.key]: action.items } }
    case "SET_VIEW_MODE":
      return { ...state, viewMode: { ...state.viewMode, [action.key]: action.mode } }
    default:
      return state
  }
}

// ============================================================================
// CONTEXT
// ============================================================================

interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
  // Helper functions
  setLoading: (key: string, value: boolean) => void
  setError: (key: string, value: string | null) => void
  withLoading: <T>(key: string, fn: () => Promise<T>) => Promise<T>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const setLoading = useCallback((key: string, value: boolean) => {
    dispatch({ type: "SET_LOADING", key, value })
  }, [])

  const setError = useCallback((key: string, value: string | null) => {
    dispatch({ type: "SET_ERROR", key, value })
  }, [])

  const withLoading = useCallback(
    async <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
      setLoading(key, true)
      setError(key, null)
      try {
        const result = await fn()
        return result
      } catch (err) {
        setError(key, err instanceof Error ? err.message : "An error occurred")
        throw err
      } finally {
        setLoading(key, false)
      }
    },
    [setLoading, setError],
  )

  useEffect(() => {
    let cancelled = false
    setLoading("init", true)
    setError("init", null)

    Promise.all([getCallHistory(), getNotifications(), getTeamMembers()])
      .then(([calls, notifications, teamMembers]) => {
        if (cancelled) return
        dispatch({ type: "SET_CALLS", calls })
        dispatch({ type: "SET_NOTIFICATIONS", notifications })
        dispatch({ type: "SET_TEAM_MEMBERS", members: teamMembers })
      })
      .catch((err) => {
        if (cancelled) return
        setError("init", err instanceof Error ? err.message : "Failed to load initial data")
      })
      .finally(() => {
        if (!cancelled) setLoading("init", false)
      })

    return () => {
      cancelled = true
    }
  }, [setLoading, setError])

  return (
    <AppContext.Provider value={{ state, dispatch, setLoading, setError, withLoading }}>{children}</AppContext.Provider>
  )
}

export function useAppState() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error("useAppState must be used within AppProvider")
  }
  return context
}

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

export function generateMockCalls(count: number): CallRecord[] {
  const results: CallRecord["result"][] = ["completed", "handoff", "dropped", "systemFailed"]
  const directions: CallRecord["direction"][] = ["inbound", "outbound"]
  const agents = [
    { id: "agent-1", name: "Support Agent" },
    { id: "agent-2", name: "Sales Agent" },
    { id: "agent-3", name: "Scheduling Agent" },
  ]
  const phoneLines = [
    { id: "line-1", number: "+1 (800) 555-0100" },
    { id: "line-2", number: "+1 (800) 555-0200" },
    { id: "line-3", number: "+1 (800) 555-0300" },
  ]
  const tools = ["CRM Lookup", "Calendar Check", "Payment Process", "Knowledge Search", "Email Send"]

  return Array.from({ length: count }, (_, i) => {
    const agent = agents[Math.floor(Math.random() * agents.length)]
    const line = phoneLines[Math.floor(Math.random() * phoneLines.length)]
    const durationMs = (Math.floor(Math.random() * 600) + 30) * 1000
    const startedAt = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    const toolCount = Math.floor(Math.random() * 4)
    const toolsUsed = Array.from({ length: toolCount }, () => ({
      name: tools[Math.floor(Math.random() * tools.length)],
      success: Math.random() > 0.1,
    }))

    return {
      callId: `call_${String(i + 1).padStart(3, "0")}`,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
      callerNumber: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
      callerName: `Caller ${i + 1}`,
      phoneLineId: line.id,
      phoneLineNumber: line.number,
      agentId: agent.id,
      agentName: agent.name,
      direction: directions[Math.floor(Math.random() * directions.length)],
      durationMs,
      result: results[Math.floor(Math.random() * results.length)],
      endReason: "Goal achieved",
      turnCount: Math.floor(Math.random() * 15) + 2,
      toolsUsed,
    }
  })
}

export function generateMockAgents(): Agent[] {
  return [
    {
      id: "agent-1",
      name: "Customer Support Agent",
      description: "Handles general customer inquiries and support tickets",
      status: "active",
      type: "support",
      version: "v2.3.1",
      phoneLines: ["line-1", "line-3"],
      knowledgeBase: ["kb-support", "kb-faq"],
      tools: ["crm-lookup", "ticket-create", "email-send"],
      metrics: { totalCalls: 1523, handledRate: 94.2, escalationRate: 5.8, failureRate: 1.2, avgDuration: 245 },
      createdAt: "2024-01-10T10:00:00Z",
      updatedAt: "2024-01-20T14:30:00Z",
    },
    {
      id: "agent-2",
      name: "Sales Assistant",
      description: "Qualifies leads and schedules demos",
      status: "active",
      type: "sales",
      version: "v1.8.0",
      phoneLines: ["line-2"],
      knowledgeBase: ["kb-products", "kb-pricing"],
      tools: ["crm-lookup", "calendar-book", "email-send"],
      metrics: { totalCalls: 892, handledRate: 88.5, escalationRate: 11.5, failureRate: 2.3, avgDuration: 312 },
      createdAt: "2024-01-05T09:00:00Z",
      updatedAt: "2024-01-19T11:00:00Z",
      needsAttention: true,
      attentionReason: "High escalation rate",
    },
    {
      id: "agent-3",
      name: "Appointment Scheduler",
      description: "Books and manages appointments",
      status: "paused",
      type: "scheduling",
      version: "v1.2.0",
      phoneLines: ["line-3"],
      knowledgeBase: ["kb-scheduling"],
      tools: ["calendar-check", "calendar-book", "sms-send"],
      metrics: { totalCalls: 456, handledRate: 96.1, escalationRate: 3.9, failureRate: 0.8, avgDuration: 180 },
      createdAt: "2024-01-12T08:00:00Z",
      updatedAt: "2024-01-18T16:00:00Z",
    },
    {
      id: "agent-4",
      name: "Billing Support",
      description: "Handles billing inquiries and payment issues",
      status: "draft",
      type: "support",
      version: "v0.9.0",
      phoneLines: [],
      knowledgeBase: ["kb-billing"],
      tools: ["payment-lookup", "refund-process"],
      metrics: { totalCalls: 0, handledRate: 0, escalationRate: 0, failureRate: 0, avgDuration: 0 },
      createdAt: "2024-01-20T10:00:00Z",
      updatedAt: "2024-01-20T10:00:00Z",
    },
  ]
}

export function generateMockDocuments(): KBDocument[] {
  return [
    {
      id: "doc-1",
      name: "Product FAQ.pdf",
      type: "pdf",
      size: 2456789,
      status: "ready",
      collection: "Support",
      chunks: 45,
      usedByAgents: ["agent-1"],
      createdAt: "2024-01-15T10:00:00Z",
      updatedAt: "2024-01-15T10:00:00Z",
    },
    {
      id: "doc-2",
      name: "Pricing Guide.docx",
      type: "docx",
      size: 1234567,
      status: "ready",
      collection: "Sales",
      chunks: 23,
      usedByAgents: ["agent-2"],
      createdAt: "2024-01-14T09:00:00Z",
      updatedAt: "2024-01-14T09:00:00Z",
    },
    {
      id: "doc-3",
      name: "Troubleshooting Guide.md",
      type: "md",
      size: 567890,
      status: "processing",
      progress: 65,
      collection: "Support",
      chunks: 0,
      usedByAgents: [],
      createdAt: "2024-01-20T14:00:00Z",
      updatedAt: "2024-01-20T14:00:00Z",
    },
    {
      id: "doc-4",
      name: "API Documentation.html",
      type: "html",
      size: 890123,
      status: "failed",
      collection: "Developer",
      chunks: 0,
      usedByAgents: [],
      createdAt: "2024-01-19T11:00:00Z",
      updatedAt: "2024-01-19T11:00:00Z",
      error: "Failed to parse HTML structure",
    },
    {
      id: "doc-5",
      name: "Company Policies.txt",
      type: "txt",
      size: 345678,
      status: "ready",
      collection: "HR",
      chunks: 12,
      usedByAgents: ["agent-1", "agent-3"],
      createdAt: "2024-01-10T08:00:00Z",
      updatedAt: "2024-01-10T08:00:00Z",
    },
  ]
}

export function generateMockCollections(): KBCollection[] {
  return [
    {
      id: "col-1",
      name: "Support",
      description: "Customer support documentation",
      documentCount: 12,
      createdAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "col-2",
      name: "Sales",
      description: "Sales and pricing materials",
      documentCount: 8,
      createdAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "col-3",
      name: "Developer",
      description: "Technical documentation",
      documentCount: 5,
      createdAt: "2024-01-05T00:00:00Z",
    },
    {
      id: "col-4",
      name: "HR",
      description: "HR policies and procedures",
      documentCount: 3,
      createdAt: "2024-01-10T00:00:00Z",
    },
  ]
}

export function generateMockIntegrations(): Integration[] {
  return [
    {
      id: "int-1",
      name: "Twilio",
      type: "telephony",
      status: "connected",
      icon: "Phone",
      description: "Voice and SMS communications",
      lastSync: "2024-01-20T14:30:00Z",
    },
    {
      id: "int-2",
      name: "Salesforce",
      type: "crm",
      status: "connected",
      icon: "Database",
      description: "CRM and customer data",
      lastSync: "2024-01-20T14:00:00Z",
    },
    {
      id: "int-3",
      name: "Google Calendar",
      type: "calendar",
      status: "connected",
      icon: "Calendar",
      description: "Scheduling and appointments",
      lastSync: "2024-01-20T13:45:00Z",
    },
    {
      id: "int-4",
      name: "Stripe",
      type: "payment",
      status: "degraded",
      icon: "CreditCard",
      description: "Payment processing",
      lastSync: "2024-01-20T12:00:00Z",
    },
    {
      id: "int-5",
      name: "Slack",
      type: "notification",
      status: "disconnected",
      icon: "MessageSquare",
      description: "Team notifications",
      lastSync: undefined,
    },
    {
      id: "int-6",
      name: "Segment",
      type: "analytics",
      status: "error",
      icon: "BarChart",
      description: "Analytics and tracking",
      lastSync: "2024-01-19T10:00:00Z",
    },
  ]
}

export function generateMockNotifications(): Notification[] {
  return [
    {
      id: "notif-1",
      type: "warning",
      title: "High Call Volume",
      message: "Call volume is 150% above normal for this time",
      read: false,
      timestamp: "2024-01-20T14:30:00Z",
      actionUrl: "/dashboard",
    },
    {
      id: "notif-2",
      type: "error",
      title: "Integration Error",
      message: "Segment integration failed to sync",
      read: false,
      timestamp: "2024-01-20T14:00:00Z",
      actionUrl: "/integrations",
    },
    {
      id: "notif-3",
      type: "success",
      title: "Agent Deployed",
      message: "Sales Assistant v1.8.0 deployed successfully",
      read: true,
      timestamp: "2024-01-20T11:00:00Z",
    },
    {
      id: "notif-4",
      type: "info",
      title: "Scheduled Maintenance",
      message: "System maintenance scheduled for Jan 25, 2AM-4AM EST",
      read: true,
      timestamp: "2024-01-19T09:00:00Z",
    },
  ]
}

export function generateMockTeamMembers(): TeamMember[] {
  return [
    {
      id: "member-1",
      name: "John Admin",
      email: "john@rezovo.ai",
      role: "admin",
      status: "active",
      lastActive: "2 hours ago",
    },
    {
      id: "member-2",
      name: "Sarah Manager",
      email: "sarah@rezovo.ai",
      role: "admin",
      status: "active",
      lastActive: "1 day ago",
    },
    {
      id: "member-3",
      name: "Mike Developer",
      email: "mike@rezovo.ai",
      role: "editor",
      status: "active",
      lastActive: "3 days ago",
    },
    {
      id: "member-4",
      name: "Lisa Viewer",
      email: "lisa@rezovo.ai",
      role: "viewer",
      status: "invited",
      lastActive: "Never",
    },
  ]
}

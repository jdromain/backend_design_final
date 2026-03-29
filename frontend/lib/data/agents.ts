import type { Agent } from "@/components/agents/agents-table"
import { assertMockSafety } from "./_env-check"
import { get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export type AgentDetailApi = {
  id: string
  name: string
  description: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  voice: string
  silenceTimeout: number
  interruptionSensitivity: number
  version: number
  persona: string
  toolAccess: string[]
  phoneNumbers: { number: string; businessId: string }[]
  kbNamespace: string
  status: "active" | "paused" | "draft"
  agentType: "booking" | "support" | "sales" | "custom"
}

type ApiAgentListRow = {
  id: string
  name: string
  description?: string
  status?: string
  type?: string
  version?: string
  phoneLines?: string[]
  knowledgeBase?: string[]
  tools?: string[]
  metrics?: {
    totalCalls: number
    handledRate: number
    escalationRate: number
    failureRate: number
    avgDuration?: number
  }
}

function toPercent(rate: number): number {
  const pct = rate <= 1 && rate >= 0 ? rate * 100 : rate
  return Math.round(pct * 10) / 10
}

function mapAgentType(t: string | undefined): Agent["agentType"] {
  if (t === "booking" || t === "support" || t === "sales" || t === "custom") return t
  return "custom"
}

function mapListStatus(s: string | undefined): Agent["status"] {
  if (s === "active" || s === "paused" || s === "draft") return s
  return "draft"
}

function mapApiRowToAgent(row: ApiAgentListRow): Agent {
  const m = row.metrics ?? {
    totalCalls: 0,
    handledRate: 0,
    escalationRate: 0,
    failureRate: 0,
  }
  const kb = row.knowledgeBase ?? []
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    version: Number.parseInt(String(row.version ?? "1"), 10) || 1,
    status: mapListStatus(row.status),
    agentType: mapAgentType(row.type),
    callsToday: m.totalCalls,
    handledRate: toPercent(m.handledRate),
    escalationRate: toPercent(m.escalationRate),
    failureRate: toPercent(m.failureRate),
    toolErrorRate: 0,
    phoneLines: row.phoneLines ?? [],
    knowledgeBase:
      kb.length > 0 ? { status: "connected", name: kb[0] } : { status: "missing" },
    integrations: [],
    updatedAt: "",
    createdAt: "",
  }
}

const MOCK_AGENTS_FALLBACK: Agent[] = [
  {
    id: "agent_001",
    name: "Customer Support Agent",
    description: "Handles customer inquiries and technical support",
    version: 1,
    status: "active",
    agentType: "support",
    callsToday: 234,
    handledRate: 87.5,
    escalationRate: 12.5,
    failureRate: 3.2,
    toolErrorRate: 1.8,
    phoneLines: ["+1 (555) 123-4567"],
    knowledgeBase: { status: "connected", name: "Support Docs" },
    integrations: [
      { name: "Twilio", status: "healthy" },
      { name: "Zendesk", status: "healthy" },
    ],
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
  },
]

export async function listAgents(): Promise<Agent[]> {
  if (useMocks) {
    return MOCK_AGENTS_FALLBACK
  }
  const rows = await get<ApiAgentListRow[]>("/agents")
  if (!Array.isArray(rows)) return []
  return rows.map(mapApiRowToAgent)
}

export async function getAgentDetail(agentId: string): Promise<AgentDetailApi> {
  if (useMocks) {
    return {
      id: agentId,
      name: "Customer Support Agent",
      description: "Handles general customer inquiries",
      systemPrompt: "You are a helpful assistant.",
      temperature: 0.7,
      maxTokens: 1024,
      voice: "alloy",
      silenceTimeout: 5,
      interruptionSensitivity: 0.5,
      version: 1,
      persona: "support",
      toolAccess: ["lookup_customer", "create_ticket"],
      phoneNumbers: [{ number: "+1 (555) 123-4567", businessId: "biz-1" }],
      kbNamespace: "default",
      status: "active",
      agentType: "support",
    }
  }
  return get<AgentDetailApi>(`/agents/${encodeURIComponent(agentId)}`)
}

import { assertMockSafety } from "./_env-check"
import {
  mockUsageByPeriod,
  mockBreakdownByPeriod,
  mockAgentUsage,
  mockToolUsage,
  mockInvoices,
} from "@/data/mock/billing"
import { appendOrgQuery, get } from "@/lib/api-client"
import type { Invoice } from "@/components/billing/billing-history-table"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

/** Rolling windows supported by platform-api `/billing/*`. */
export type BillingApiPeriod = "7d" | "30d" | "90d"

export function normalizeBillingPeriod(period: string): BillingApiPeriod {
  if (period === "7d" || period === "30d" || period === "90d") return period
  return "30d"
}

type UsageMetersState = {
  callMinutes: { used: number; limit: number; trend: number }
  agents: { used: number; limit: number; trend: number }
  storage: { used: number; limit: number; trend: number }
  tokens: { used: number; limit: number; trend: number }
}

type BreakdownRow = {
  category: string
  usage: number
  usageUnit: string
  cost: number
  color: string
}

type ApiBillingUsage = {
  totalMinutes: number
  totalCalls: number
  totalTokens: number
  agentCount: number
  kbDocuments: number
  kbChunks: number
  plan: null | {
    minutesIncluded: number
    costPerMinute: number
    concurrentCallsLimit: number
  }
}

function mapApiUsageToMeters(u: ApiBillingUsage): UsageMetersState {
  const minLimit = u.plan?.minutesIncluded ?? 0
  const agentLimit = u.plan?.concurrentCallsLimit ?? 0
  return {
    callMinutes: {
      used: u.totalMinutes,
      limit: minLimit > 0 ? minLimit : Math.max(u.totalMinutes, 1),
      trend: 0,
    },
    agents: {
      used: u.agentCount,
      limit: agentLimit > 0 ? agentLimit : Math.max(u.agentCount, 1),
      trend: 0,
    },
    storage: {
      used: u.kbDocuments,
      limit: Math.max(u.kbDocuments, 1),
      trend: 0,
    },
    tokens: {
      used: u.totalTokens,
      limit: Math.max(u.totalTokens, 1),
      trend: 0,
    },
  }
}

type ApiBreakdown = {
  telephony: { minutes: number; unitCost: number; total: number }
  llm: { tokensIn: number; tokensOut: number; unitCost: number; total: number }
  tts: { characters: number; unitCost: number; total: number }
  stt: { seconds: number; unitCost: number; total: number }
  tools: { invocations: number; unitCost: number; total: number }
}

function mapApiBreakdownToRows(b: ApiBreakdown): BreakdownRow[] {
  const tokenTotal = b.llm.tokensIn + b.llm.tokensOut
  return [
    {
      category: "Telephony",
      usage: b.telephony.minutes,
      usageUnit: "min",
      cost: b.telephony.total,
      color: "#3b82f6",
    },
    {
      category: "LLM Tokens",
      usage: tokenTotal,
      usageUnit: "tokens",
      cost: b.llm.total,
      color: "#10b981",
    },
    {
      category: "TTS",
      usage: b.tts.characters,
      usageUnit: "chars",
      cost: b.tts.total,
      color: "#f59e0b",
    },
    {
      category: "STT",
      usage: Math.round(b.stt.seconds),
      usageUnit: "sec",
      cost: b.stt.total,
      color: "#8b5cf6",
    },
    {
      category: "Tool invocations",
      usage: b.tools.invocations,
      usageUnit: "calls",
      cost: b.tools.total,
      color: "#ec4899",
    },
  ]
}

type ApiBillingAgentRow = {
  agentId: string
  totalCalls: number
  totalMinutes: number
  totalTokens: number
}

type AgentUsageState = {
  id: string
  name: string
  calls: number
  minutes: number
  tokens: number
  cost: number
}

function estimateAgentRowCost(row: ApiBillingAgentRow): number {
  return row.totalMinutes * 0.05 + row.totalTokens * 0.00003
}

type ApiToolRow = { name: string; invocations: number; cost: number }

type ToolUsageRow = { id: string; name: string; invocations: number; errorRate: number; cost: number }

type ApiUsageRollup = {
  id: string
  period: string
  calls: number
  minutes: number
  total: number
  kind?: "usage_month_rollup"
}

function mapApiRollupToInvoice(r: ApiUsageRollup): Invoice {
  const month = r.period.slice(0, 7)
  return {
    id: r.id,
    date: month,
    period: `Month ${month}`,
    status: "pending",
    amount: r.total,
    lineItems: [
      {
        description: `Usage rollup — ${r.calls} calls, ${r.minutes} min (metered, not a payment)`,
        amount: r.total,
      },
    ],
    paymentMethod: "—",
    recordKind: r.kind === "usage_month_rollup" ? "usage_month_rollup" : undefined,
  }
}

function mockPeriodKey(period: string): keyof typeof mockUsageByPeriod {
  if (period === "7d") return "7d"
  if (period === "90d" || period === "last-month") return "90d"
  if (period === "this-month" || period === "30d" || period === "custom") return "30d"
  return "30d"
}

export async function getBillingUsage(period: string) {
  const apiPeriod = normalizeBillingPeriod(period)
  if (useMocks) {
    const key = mockPeriodKey(period)
    return mockUsageByPeriod[key] ?? mockUsageByPeriod["30d"]
  }
  const raw = await get<ApiBillingUsage>(
    appendOrgQuery(`/billing/usage?period=${encodeURIComponent(apiPeriod)}`)
  )
  return mapApiUsageToMeters(raw)
}

export async function getBillingBreakdown(period: string) {
  const apiPeriod = normalizeBillingPeriod(period)
  if (useMocks) {
    const key = mockPeriodKey(period)
    return mockBreakdownByPeriod[key] ?? mockBreakdownByPeriod["30d"]
  }
  const raw = await get<ApiBreakdown>(
    appendOrgQuery(`/billing/breakdown?period=${encodeURIComponent(apiPeriod)}`)
  )
  return mapApiBreakdownToRows(raw)
}

export async function getAgentUsage(): Promise<AgentUsageState | null> {
  if (useMocks) return mockAgentUsage
  const rows = await get<ApiBillingAgentRow[]>(appendOrgQuery("/billing/agents"))
  if (!Array.isArray(rows) || rows.length === 0) return null
  const top = rows.reduce((a, b) => (a.totalCalls >= b.totalCalls ? a : b))
  return {
    id: top.agentId,
    name: top.agentId,
    calls: top.totalCalls,
    minutes: top.totalMinutes,
    tokens: top.totalTokens,
    cost: Math.round(estimateAgentRowCost(top) * 100) / 100,
  }
}

export async function getToolUsage(): Promise<ToolUsageRow[]> {
  if (useMocks) return mockToolUsage
  const rows = await get<ApiToolRow[]>(appendOrgQuery("/billing/tools"))
  if (!Array.isArray(rows)) return []
  return rows.map((r, i) => ({
    id: `${i}-${r.name}`,
    name: r.name,
    invocations: r.invocations,
    errorRate: 0,
    cost: r.cost,
  }))
}

export async function getInvoices(): Promise<Invoice[]> {
  if (useMocks) return mockInvoices
  const rows = await get<ApiUsageRollup[]>(appendOrgQuery("/billing/invoices"))
  if (!Array.isArray(rows)) return []
  return rows.map((r) => mapApiRollupToInvoice(r))
}

export { mockUsageByPeriod, mockBreakdownByPeriod, mockAgentUsage, mockToolUsage, mockInvoices }

import { assertMockSafety } from "./_env-check"
import { generateMockCalls, mockAgents, mockPhoneLines, availableTools } from "@/data/mock/call-history"
import type { CallRecord } from "@/types/api"
import { appendOrgQuery, get, post } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export type CallHistoryQuery = {
  from?: Date
  to?: Date
  result?: string[]
  intent?: string
  endReason?: string
  phoneLine?: string
  toolUsed?: string
  toolErrorsOnly?: boolean
  direction?: string
  search?: string
  page?: number
  limit?: number
}

export type CallHistoryFacets = {
  intents: string[]
  endReasons: string[]
  directions: string[]
  phoneLines: { id: string; number: string; name: string }[]
  tools: string[]
  results: string[]
}

function toQueryString(input: CallHistoryQuery): string {
  const qs = new URLSearchParams()
  if (input.from) qs.set("from", input.from.toISOString())
  if (input.to) qs.set("to", input.to.toISOString())
  if (input.result && input.result.length > 0) qs.set("result", input.result.join(","))
  if (input.intent && input.intent !== "all") qs.set("intent", input.intent)
  if (input.endReason && input.endReason !== "all") qs.set("endReason", input.endReason)
  if (input.phoneLine && input.phoneLine !== "all") qs.set("phoneLine", input.phoneLine)
  if (input.toolUsed && input.toolUsed !== "all") qs.set("toolUsed", input.toolUsed)
  if (input.toolErrorsOnly) qs.set("toolErrorsOnly", "true")
  if (input.direction && input.direction !== "all") qs.set("direction", input.direction)
  if (input.search && input.search.trim().length > 0) qs.set("search", input.search.trim())
  if (typeof input.page === "number" && input.page > 0) qs.set("page", String(input.page))
  if (typeof input.limit === "number" && input.limit > 0) qs.set("limit", String(input.limit))
  return qs.toString()
}

export async function getCallHistory(query: CallHistoryQuery = {}): Promise<CallRecord[]> {
  if (useMocks) return generateMockCalls() as CallRecord[]
  const qs = toQueryString(query)
  const path = qs ? `/calls?${qs}` : "/calls"
  return get<CallRecord[]>(appendOrgQuery(path))
}

export async function getCallHistoryFacets(params: {
  from?: Date
  to?: Date
} = {}): Promise<CallHistoryFacets> {
  if (useMocks) {
    return {
      intents: ["Billing", "Support", "Sales", "Booking", "Unknown"],
      endReasons: ["Normal completion", "Caller hung up", "Customer requested human", "Tool timeout", "API error"],
      directions: ["inbound", "outbound"],
      phoneLines: mockPhoneLines,
      tools: availableTools,
      results: ["completed", "handoff", "dropped", "systemFailed", "pending"],
    }
  }
  const qs = new URLSearchParams()
  if (params.from) qs.set("from", params.from.toISOString())
  if (params.to) qs.set("to", params.to.toISOString())
  const path = qs.size > 0 ? `/calls/facets?${qs.toString()}` : "/calls/facets"
  return get<CallHistoryFacets>(appendOrgQuery(path))
}

export async function getAgents(): Promise<{ id: string; name: string }[]> {
  if (useMocks) return mockAgents
  return get<{ id: string; name: string }[]>(appendOrgQuery("/agents"))
}

export async function getPhoneLines(): Promise<{ id: string; number: string; name: string }[]> {
  if (useMocks) return mockPhoneLines
  return get<{ id: string; number: string; name: string }[]>(appendOrgQuery("/phone-lines"))
}

export async function getTools(): Promise<string[]> {
  if (useMocks) return availableTools
  return get<string[]>(appendOrgQuery("/tools"))
}

export async function bulkDeleteCalls(callIds: string[]): Promise<{ deletedCount: number }> {
  if (useMocks) return { deletedCount: callIds.length }
  return post<{ deletedCount: number }>(appendOrgQuery("/calls/bulk-delete"), { callIds })
}

export async function bulkTagCalls(callIds: string[], tag: string): Promise<{ taggedCount: number }> {
  if (useMocks) return { taggedCount: callIds.length }
  return post<{ taggedCount: number }>(appendOrgQuery("/calls/bulk-tag"), { callIds, tag })
}

export async function createFollowUpFromCall(input: {
  callId: string
  contactId?: string
  type: string
  priority: number
  dueAt: string
  notes: string
  ownerId?: string
}): Promise<{ ok: boolean; id: string }> {
  if (useMocks) return { ok: true, id: `mock-${Date.now()}` }
  return post<{ ok: boolean; id: string }>(appendOrgQuery("/follow-ups"), input)
}

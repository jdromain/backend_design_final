import { assertMockSafety } from "./_env-check"
import {
  mockPages,
  mockCalls,
  mockAgents,
  mockKbDocs,
  mockIntegrations,
  mockSettingsSections,
  mockContacts,
  mockFollowUps,
  mockWorkflows,
  quickFilters,
  suggestedActions,
} from "@/data/mock/search"
import { appendTenantQuery, get } from "@/lib/api-client"

export {
  mockPages,
  mockCalls,
  mockAgents,
  mockKbDocs,
  mockIntegrations,
  mockSettingsSections,
  mockContacts,
  mockFollowUps,
  mockWorkflows,
  quickFilters,
  suggestedActions,
}

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

/** When true with mocks off, global search also scans the static demo corpus (calls, agents, …). */
export const includeMockSearchCorpus =
  process.env.NEXT_PUBLIC_SEARCH_INCLUDE_MOCK_RESULTS === "true"

type SearchData = {
  pages: typeof mockPages
  calls: typeof mockCalls
  agents: typeof mockAgents
  kbDocs: typeof mockKbDocs
  integrations: typeof mockIntegrations
  settingsSections: typeof mockSettingsSections
  contacts: typeof mockContacts
  followUps: typeof mockFollowUps
  workflows: typeof mockWorkflows
  quickFilters: typeof quickFilters
  suggestedActions: typeof suggestedActions
}

export type LiveSearchApiResponse = {
  calls: Array<{
    call_id: string
    caller_number: string
    classified_intent: string | null
    started_at: string
  }>
  contacts: Array<{ id: string; name: string | null; phone: string | null; email: string | null }>
  followUps: Array<{ id: string; type: string; status: string; notes: string | null }>
  workflows: Array<{ id: string; name: string; trigger_key: string | null }>
  kbDocs: Array<{ id: string; doc_id: string; namespace: string | null }>
  users: Array<{ id: string; name: string | null; email: string | null }>
  agents: Array<{ id: string; name: string }>
  integrations: Array<{ id: string; name: string; status: string }>
}

export async function fetchLiveSearch(q: string): Promise<LiveSearchApiResponse | null> {
  const trimmed = q.trim()
  if (!trimmed) return null
  return get<LiveSearchApiResponse>(
    appendTenantQuery(`/search?q=${encodeURIComponent(trimmed)}`)
  )
}

export async function getSearchData(): Promise<SearchData> {
  if (useMocks) {
    return {
      pages: mockPages,
      calls: mockCalls,
      agents: mockAgents,
      kbDocs: mockKbDocs,
      integrations: mockIntegrations,
      settingsSections: mockSettingsSections,
      contacts: mockContacts,
      followUps: mockFollowUps,
      workflows: mockWorkflows,
      quickFilters,
      suggestedActions,
    }
  }
  return {
    pages: mockPages,
    calls: [],
    agents: [],
    kbDocs: [],
    integrations: [],
    settingsSections: mockSettingsSections,
    contacts: [],
    followUps: [],
    workflows: [],
    quickFilters,
    suggestedActions: includeMockSearchCorpus ? suggestedActions : [],
  }
}

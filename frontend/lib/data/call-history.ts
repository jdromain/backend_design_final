import { assertMockSafety } from "./_env-check"
import { generateMockCalls, mockAgents, mockPhoneLines, availableTools } from "@/data/mock/call-history"
import type { CallRecord } from "@/types/api"
import { appendTenantQuery, get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getCallHistory(): Promise<CallRecord[]> {
  if (useMocks) return generateMockCalls() as CallRecord[]
  return get<CallRecord[]>(appendTenantQuery("/calls"))
}

export async function getAgents(): Promise<{ id: string; name: string }[]> {
  if (useMocks) return mockAgents
  return get<{ id: string; name: string }[]>(appendTenantQuery("/agents"))
}

export async function getPhoneLines(): Promise<{ id: string; number: string; name: string }[]> {
  if (useMocks) return mockPhoneLines
  return get<{ id: string; number: string; name: string }[]>(appendTenantQuery("/phone-lines"))
}

export async function getTools(): Promise<string[]> {
  if (useMocks) return availableTools
  return get<string[]>(appendTenantQuery("/tools"))
}

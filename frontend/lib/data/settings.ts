import { assertMockSafety } from "./_env-check"
import { mockTeamMembers, mockApiKeys } from "@/data/mock/settings"
import type { TeamMember, DeveloperApiKey } from "@/types/api"
import { appendOrgQuery, get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getTeamMembers() {
  if (useMocks) return mockTeamMembers
  return get<TeamMember[]>(appendOrgQuery("/team"))
}

export async function getApiKeys() {
  if (useMocks) return mockApiKeys
  return get<DeveloperApiKey[]>(appendOrgQuery("/developer/api-keys"))
}

export { mockTeamMembers, mockApiKeys }

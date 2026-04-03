import { assertMockSafety } from "./_env-check"
import { getMockActivities } from "@/data/mock/activities"
import { appendTenantQuery, get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getActivities() {
  if (useMocks) return getMockActivities()
  return get<ReturnType<typeof getMockActivities>>(appendTenantQuery("/activity"))
}

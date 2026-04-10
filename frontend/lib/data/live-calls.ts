import { assertMockSafety } from "./_env-check"
import { generateMockLiveCalls } from "@/data/mock/live-calls"
import type { LiveCall } from "@/types/api"
import { appendOrgQuery, get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getLiveCalls(): Promise<LiveCall[]> {
  if (useMocks) return generateMockLiveCalls() as LiveCall[]
  return get<LiveCall[]>(appendOrgQuery("/calls/live"))
}

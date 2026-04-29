import { assertMockSafety } from "./_env-check"
import { generateMockLiveCalls } from "@/data/mock/live-calls"
import type { LiveCall } from "@/types/api"
import { appendOrgQuery, get, post } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getLiveCalls(params?: {
  includeStale?: boolean
  staleAfterMinutes?: number
}): Promise<LiveCall[]> {
  if (useMocks) return generateMockLiveCalls() as LiveCall[]
  const staleAfterMinutes = typeof params?.staleAfterMinutes === "number" && params.staleAfterMinutes > 0
    ? params.staleAfterMinutes
    : 15
  const includeStale = params?.includeStale === true
  const qs = new URLSearchParams()
  qs.set("includeStale", String(includeStale))
  qs.set("excludeStale", String(!includeStale))
  qs.set("staleAfterMinutes", String(staleAfterMinutes))
  const path = qs.size > 0 ? `/calls/live?${qs.toString()}` : "/calls/live"
  const calls = await get<LiveCall[]>(appendOrgQuery(path))
  if (includeStale) return calls

  const cutoff = Date.now() - staleAfterMinutes * 60 * 1000
  return calls.filter((call) => {
    const startMs = new Date(call.startedAt).getTime()
    if (!Number.isFinite(startMs)) return false
    return startMs >= cutoff
  })
}

export async function endLiveCall(callId: string): Promise<{ ok: boolean }> {
  if (useMocks) return { ok: true }
  return post<{ ok: boolean }>(appendOrgQuery(`/calls/${encodeURIComponent(callId)}/end`))
}

export async function handoffLiveCall(
  callId: string,
  payload: { target?: string; createFollowUp?: boolean },
): Promise<{ ok: boolean }> {
  if (useMocks) return { ok: true }
  return post<{ ok: boolean }>(
    appendOrgQuery(`/calls/${encodeURIComponent(callId)}/handoff`),
    payload,
  )
}

export async function flagLiveCall(callId: string, reason?: string): Promise<{ ok: boolean }> {
  if (useMocks) return { ok: true }
  return post<{ ok: boolean }>(
    appendOrgQuery(`/calls/${encodeURIComponent(callId)}/flag`),
    { reason: reason ?? "manual_review" },
  )
}

export async function saveLiveCallNote(callId: string, note: string): Promise<{ ok: boolean }> {
  if (useMocks) return { ok: true }
  return post<{ ok: boolean }>(
    appendOrgQuery(`/calls/${encodeURIComponent(callId)}/notes`),
    { note },
  )
}

export async function saveLiveCallTags(callId: string, tags: string[]): Promise<{ ok: boolean; tags?: string[] }> {
  if (useMocks) return { ok: true, tags }
  return post<{ ok: boolean; tags?: string[] }>(
    appendOrgQuery(`/calls/${encodeURIComponent(callId)}/tags`),
    { tags },
  )
}

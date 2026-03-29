import type { TimelineEvent, TranscriptLine, ToolActivity } from "@/types/api"
import { assertMockSafety } from "./_env-check"
import { getMockTimelineForCall, getMockTranscriptLines, getMockToolActivities } from "@/data/mock/call-details"
import { get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

export async function getTimelineForCall(call: { callId?: string; id?: string } | unknown): Promise<TimelineEvent[]> {
  if (useMocks) return getMockTimelineForCall()
  const id = (call as { callId?: string; id?: string })?.callId ?? (call as { id?: string })?.id ?? "unknown"
  return get<TimelineEvent[]>(`/calls/${id}/timeline`)
}

export async function getTranscriptLines(callId: string): Promise<TranscriptLine[]> {
  if (useMocks) return getMockTranscriptLines()
  return get<TranscriptLine[]>(`/calls/${callId}/transcript`)
}

export async function getToolActivities(callId: string): Promise<ToolActivity[]> {
  if (useMocks) return getMockToolActivities()
  return get<ToolActivity[]>(`/calls/${callId}/tools`)
}

import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecentActivityFeed } from "@/components/dashboard/recent-activity-feed"
import { CallDetailDrawer } from "@/components/dashboard/call-detail-drawer"
import type { CallRecord } from "@/types/api"

vi.mock("@/lib/data/call-details", () => ({
  getTimelineForCall: vi.fn(async () => [
    {
      id: "evt-1",
      type: "carrier_voice",
      timestamp: "2026-04-08T03:02:50.081Z",
      description: "carrier voice",
      details: "raw event: carrier_voice",
    },
  ]),
}))

describe("Dashboard runtime guards", () => {
  it("RecentActivityFeed accepts ISO string timestamps without crashing", () => {
    render(
      <RecentActivityFeed
        activities={[
          {
            id: "a1",
            severity: "info",
            type: "call",
            message: "Call completed",
            timestamp: "2026-04-08T03:02:50.081Z",
          },
        ]}
      />
    )

    expect(screen.getByText("Call completed")).toBeInTheDocument()
  })

  it("CallDetailDrawer renders unknown timeline event types with fallback icon path", async () => {
    const call: CallRecord = {
      callId: "call-1",
      startedAt: "2026-04-08T03:02:20.435Z",
      callerNumber: "+19054319840",
      phoneLineId: "+18737101393",
      phoneLineNumber: "+18737101393",
      agentId: "agent-1",
      agentName: "Agent",
      direction: "inbound",
      durationMs: 1000,
      result: "completed",
      toolsUsed: [],
    }

    render(<CallDetailDrawer call={call} open onOpenChange={() => {}} />)

    expect(await screen.findByText("carrier voice")).toBeInTheDocument()
  })
})

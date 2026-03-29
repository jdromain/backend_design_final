// Mock data for live calls feature
// DO NOT import this file directly from components. Use lib/data/live-calls.ts instead.

export const generateMockLiveCalls = () => {
  const agents = ["Customer Support Agent", "Sales Agent", "Billing Agent", "Onboarding Agent"]
  const intents = ["Billing", "Support", "Booking", "Sales", "Unknown"] as const
  const states = ["ringing", "active", "active", "active", "at_risk", "handoff_requested"] as const
  const intents2: typeof intents[number][] = ["Billing", "Support", "Booking", "Sales", "Unknown"]

  return Array.from({ length: 12 }, (_, i) => {
    const state = states[Math.floor(Math.random() * states.length)]
    const agentName = agents[Math.floor(Math.random() * agents.length)]
    const intent = intents2[Math.floor(Math.random() * intents2.length)]
    const durationSeconds = Math.floor(Math.random() * 600) + 30

    const startedAt = new Date(Date.now() - durationSeconds * 1000)
    return {
      callId: `live_${String(i + 1).padStart(3, "0")}`,
      callerNumber: `+1 (555) ${String(Math.floor(Math.random() * 900) + 100).padStart(3, "0")}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      agentName,
      agentVersion: "v1.0",
      intent,
      state,
      direction: Math.random() > 0.3 ? ("inbound" as const) : ("outbound" as const),
      startedAt: startedAt.toISOString(),
      durationSeconds,
      lastEvent: state === "at_risk" ? "Caller expressed frustration" : state === "handoff_requested" ? "Transfer requested" : "Agent speaking",
      riskFlags: state === "at_risk" ? ["sentiment_negative", "long_silence"] : [],
      riskTrigger: state === "at_risk" ? { type: "sentiment", detail: "Negative sentiment detected" } : undefined,
      timeline: [
        { id: "t1", type: "call_started" as const, timestamp: new Date(Date.now() - durationSeconds * 1000).toISOString(), description: "Call started" },
        { id: "t2", type: "agent_spoke" as const, timestamp: new Date(Date.now() - (durationSeconds - 5) * 1000).toISOString(), description: "Agent greeted caller" },
      ],
      transcript: [
        { id: "tr1", role: "agent" as const, text: "Thank you for calling. How can I help you today?", timestamp: new Date(Date.now() - (durationSeconds - 5) * 1000).toISOString() },
        { id: "tr2", role: "caller" as const, text: "Hi, I need some help with my account.", timestamp: new Date(Date.now() - (durationSeconds - 10) * 1000).toISOString() },
      ],
      tools: [],
      tags: [],
      transcriptStatus: "available" as const,
    }
  })
}

// Mock data extracted from app/page.tsx
// DO NOT import this file directly from components. Use lib/data/dashboard.ts instead.

export const generateOutcomesData = () => {
  return Array.from({ length: 24 }, (_, i) => {
    const hour = new Date()
    hour.setHours(hour.getHours() - (23 - i))
    return {
      time: hour.getHours().toString().padStart(2, "00") + ":00",
      completed: Math.floor(Math.random() * 15) + 10,
      handoff: Math.floor(Math.random() * 5) + 1,
      dropped: Math.floor(Math.random() * 2),
      systemFailed: Math.floor(Math.random() * 3),
    }
  })
}

export const generateCallsData = () => {
  const reasons = ["Goal achieved", "Customer requested human", "Caller hung up", "API timeout", "Transfer completed", "No response"]
  const tools = ["calendar_check", "send_email", "lookup_customer", "update_order", "create_ticket", "hubspot_sync"]
  const failureTypes = ["API Timeout", "Tool Execution Error", "LLM Context Overflow", "Rate Limit Exceeded"]
  const results = ["completed", "completed", "completed", "handoff", "systemFailed", "dropped"] as const
  const agents = [{ id: "agent-001", name: "Customer Support Agent" }, { id: "agent-002", name: "Sales Agent" }, { id: "agent-003", name: "Billing Agent" }]
  const phoneLines = [{ id: "line-001", number: "+1 (800) 555-0100" }, { id: "line-002", number: "+1 (800) 555-0200" }, { id: "line-003", number: "+1 (800) 555-0300" }]
  const intents = ["Billing", "Support", "Booking", "Sales", "Unknown"] as const

  return Array.from({ length: 25 }, (_, i) => {
    const result = results[Math.floor(Math.random() * results.length)]
    const agent = agents[Math.floor(Math.random() * agents.length)]
    const phoneLine = phoneLines[Math.floor(Math.random() * phoneLines.length)]
    const toolCount = Math.floor(Math.random() * 4)
    const toolsUsed = Array.from({ length: toolCount }, () => ({
      name: tools[Math.floor(Math.random() * tools.length)],
      success: Math.random() > 0.85 ? false : true,
    }))
    const toolErrors = toolsUsed.filter((t) => !t.success).length
    const startedAt = new Date(Date.now() - 1000 * 60 * (i * 5 + Math.random() * 10))
    const durationMs = Math.floor(Math.random() * 300000) + 15000

    return {
      callId: `call_${String(i + 1).padStart(3, "0")}`,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
      callerNumber: `+1 (555) ${String(Math.floor(Math.random() * 900) + 100).padStart(3, "0")}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      callerName: ["John Smith", "Sarah Johnson", "Mike Davis", "Emily Brown"][i % 4],
      phoneLineId: phoneLine.id,
      phoneLineNumber: phoneLine.number,
      agentId: agent.id,
      agentName: agent.name,
      intent: intents[i % 5],
      direction: Math.random() > 0.3 ? ("inbound" as const) : ("outbound" as const),
      durationMs,
      result,
      endReason: reasons[Math.floor(Math.random() * reasons.length)],
      turnCount: Math.floor(Math.random() * 15) + 2,
      toolsUsed,
      ...(toolErrors > 0 && { toolErrors }),
      ...(result === "systemFailed" && { failureType: failureTypes[Math.floor(Math.random() * failureTypes.length)] }),
    }
  })
}

export const generateActivityData = () => {
  const activities = [
    { severity: "error" as const, type: "tool", message: "HubSpot API connection timeout" },
    { severity: "warning" as const, type: "escalation", message: "Call handed off to human" },
    { severity: "info" as const, type: "call", message: "Call completed successfully" },
    { severity: "error" as const, type: "tool", message: "Calendar sync failed" },
    { severity: "info" as const, type: "config", message: "Agent configuration updated" },
    { severity: "warning" as const, type: "escalation", message: "Multiple handoffs in 10m" },
    { severity: "info" as const, type: "call", message: "New incoming call completed" },
    { severity: "error" as const, type: "tool", message: "Email delivery failed" },
  ]

  return activities.map((activity, i) => ({
    ...activity,
    id: String(i + 1),
    timestamp: new Date(Date.now() - 1000 * 60 * (i * 3 + Math.random() * 5)),
    count: activity.severity === "error" ? Math.floor(Math.random() * 5) + 1 : 1,
  }))
}

export const sparklineData = {
  calls: [12, 19, 15, 22, 18, 25, 20, 28, 24, 31, 27, 35],
  active: [2, 3, 1, 4, 2, 3, 5, 2, 3, 4, 2, 3],
  completed: [88, 92, 90, 94, 91, 93, 95, 92, 94, 93, 95, 94],
  failed: [5, 3, 4, 2, 3, 2, 1, 3, 2, 3, 2, 1],
  handoff: [8, 6, 7, 5, 6, 5, 4, 5, 4, 4, 3, 5],
  dropped: [2, 3, 2, 4, 3, 2, 3, 4, 3, 2, 3, 3],
  latency: [220, 235, 228, 245, 232, 248, 240, 255, 245, 250, 242, 245],
}

export const systemHealth = {
  overall: "operational" as const,
  telephony: [
    { name: "Twilio", status: "operational" as const, latency: 45 },
    { name: "SIP Trunk", status: "operational" as const, latency: 32 },
  ],
  stt: [
    { name: "Deepgram", status: "operational" as const, latency: 120 },
    { name: "Whisper", status: "operational" as const, latency: 280 },
  ],
  tts: [
    { name: "ElevenLabs", status: "operational" as const, latency: 95 },
    { name: "PlayHT", status: "operational" as const, latency: 110 },
  ],
  llm: [
    { name: "GPT-4", status: "operational" as const, latency: 450 },
    { name: "Claude", status: "operational" as const, latency: 380 },
  ],
  tools: [
    { name: "CRM Lookup", status: "degraded" as const, message: "Elevated latency" },
    { name: "Calendar", status: "operational" as const, latency: 85 },
  ],
  integrations: [
    { name: "HubSpot", status: "degraded" as const, message: "Elevated latency" },
    { name: "Salesforce", status: "operational" as const, latency: 120 },
    { name: "Slack", status: "operational" as const, latency: 65 },
  ],
}

export const incidents = [
  {
    id: "1",
    severity: "high" as const,
    icon: "escalation" as const,
    title: "3 escalations waiting",
    description: "Human handoff requests need attention",
    since: "since 12:41 PM",
    action: { label: "Open Actions Inbox", page: "actions" },
  },
  {
    id: "2",
    severity: "high" as const,
    icon: "tool" as const,
    title: "Tool timeouts spiking: CRM Lookup",
    description: "15 timeouts in the last hour",
    since: "since 11:23 AM",
    action: { label: "View Calls", page: "history", params: { filter: "failed" } },
  },
  {
    id: "3",
    severity: "high" as const,
    icon: "integration" as const,
    title: "Integration disconnected: HubSpot",
    description: "Re-authentication required",
    since: "since 10:15 AM",
    action: { label: "Fix Integration", page: "integrations" },
  },
  {
    id: "4",
    severity: "medium" as const,
    icon: "drop" as const,
    title: "Drop rate elevated today",
    description: "8% drop rate vs 3% average",
    since: "since 9:00 AM",
    action: { label: "View Calls", page: "history", params: { filter: "dropped" } },
  },
]

export const topIntents = [
  { id: "1", label: "Check appointment status", count: 156, trend: "up" as const, change: 12 },
  { id: "2", label: "Schedule new appointment", count: 134, trend: "up" as const, change: 8 },
  { id: "3", label: "Cancel/reschedule", count: 89, trend: "down" as const, change: 5 },
  { id: "4", label: "Billing inquiry", count: 67, trend: "flat" as const },
  { id: "5", label: "Technical support", count: 45, trend: "up" as const, change: 15 },
]

export const topHandoffReasons = [
  { id: "1", label: "Customer requested human", count: 23, trend: "up" as const, change: 8 },
  { id: "2", label: "Complex billing issue", count: 18, trend: "flat" as const },
  { id: "3", label: "Complaint escalation", count: 12, trend: "down" as const, change: 3 },
  { id: "4", label: "Out of scope request", count: 9, trend: "up" as const, change: 12 },
  { id: "5", label: "Authentication failed", count: 7, trend: "down" as const, change: 20 },
]

export const topFailureReasons = [
  { id: "1", label: "API Timeout", count: 15, trend: "up" as const, change: 25 },
  { id: "2", label: "Tool execution error", count: 8, trend: "up" as const, change: 10 },
  { id: "3", label: "LLM context overflow", count: 5, trend: "flat" as const },
  { id: "4", label: "Invalid caller input", count: 4, trend: "down" as const, change: 15 },
  { id: "5", label: "Rate limit exceeded", count: 3, trend: "down" as const, change: 40 },
]

export const onboardingSteps = [
  { id: "1", title: "Connect phone line", description: "Set up your Twilio or SIP connection", icon: "phone", completed: true, action: { label: "Configure", page: "integrations" } },
  { id: "2", title: "Set business hours", description: "Define when your AI agent should answer", icon: "clock", completed: true, action: { label: "Set Hours", page: "settings" } },
  { id: "3", title: "Upload documents", description: "Add your knowledge base content", icon: "docs", completed: false, action: { label: "Upload", page: "knowledge" } },
  { id: "4", title: "Connect integration", description: "Link your CRM or calendar", icon: "integration", completed: false, optional: true, action: { label: "Connect", page: "integrations" } },
  { id: "5", title: "Run test call", description: "Make sure everything works", icon: "test", completed: false, action: { label: "Test", page: "dashboard" } },
  { id: "6", title: "Go live", description: "Start handling real calls", icon: "live", completed: false, action: { label: "Go Live", page: "agents" } },
]

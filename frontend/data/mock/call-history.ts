// Mock data for call history feature
// DO NOT import this file directly from components. Use lib/data/call-history.ts instead.

export const mockAgents = [
  { id: "agent-001", name: "Customer Support Agent" },
  { id: "agent-002", name: "Sales Agent" },
  { id: "agent-003", name: "Billing Agent" },
]

export const mockPhoneLines = [
  { id: "line-001", number: "+1 (800) 555-0100", name: "Support Line" },
  { id: "line-002", number: "+1 (800) 555-0200", name: "Sales Line" },
  { id: "line-003", number: "+1 (800) 555-0300", name: "Billing Line" },
]

export const availableTools = [
  "calendar_check",
  "send_email",
  "lookup_customer",
  "update_order",
  "create_ticket",
  "hubspot_sync",
  "transfer_call",
  "send_sms",
]

export const generateMockCalls = () => {
  const results = ["completed", "completed", "completed", "handoff", "systemFailed", "dropped"] as const
  const intents = ["Billing", "Support", "Booking", "Sales", "Unknown"] as const
  const endReasons = ["Goal achieved", "Customer requested human", "Caller hung up", "API timeout", "Transfer completed", "No response"]
  const failureTypes = ["API Timeout", "Tool Execution Error", "LLM Context Overflow", "Rate Limit Exceeded"]
  const toolNames = ["calendar_check", "send_email", "lookup_customer", "update_order", "create_ticket"]

  return Array.from({ length: 50 }, (_, i) => {
    const result = results[Math.floor(Math.random() * results.length)]
    const agent = mockAgents[Math.floor(Math.random() * mockAgents.length)]
    const phoneLine = mockPhoneLines[Math.floor(Math.random() * mockPhoneLines.length)]
    const intent = intents[Math.floor(Math.random() * intents.length)]
    const startedAt = new Date(Date.now() - 1000 * 60 * (i * 8 + Math.random() * 15))
    const durationMs = Math.floor(Math.random() * 300000) + 15000
    const toolCount = Math.floor(Math.random() * 4)
    const toolsUsed = Array.from({ length: toolCount }, () => ({
      name: toolNames[Math.floor(Math.random() * toolNames.length)],
      success: Math.random() > 0.1,
    }))
    const toolErrors = toolsUsed.filter((t) => !t.success).length

    return {
      callId: `call_${String(i + 1).padStart(3, "0")}`,
      startedAt: startedAt.toISOString(),
      endedAt: new Date(startedAt.getTime() + durationMs).toISOString(),
      callerNumber: `+1 (555) ${String(Math.floor(Math.random() * 900) + 100).padStart(3, "0")}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      callerName: Math.random() > 0.5 ? ["John Smith", "Sarah Johnson", "Mike Davis", "Emily Brown"][Math.floor(Math.random() * 4)] : undefined,
      phoneLineId: phoneLine.id,
      phoneLineNumber: phoneLine.number,
      agentId: agent.id,
      agentName: agent.name,
      intent,
      direction: Math.random() > 0.3 ? ("inbound" as const) : ("outbound" as const),
      durationMs,
      result,
      endReason: endReasons[Math.floor(Math.random() * endReasons.length)],
      turnCount: Math.floor(Math.random() * 15) + 2,
      toolsUsed,
      ...(toolErrors > 0 && { toolErrors }),
      ...(result === "systemFailed" && {
        failureType: failureTypes[Math.floor(Math.random() * failureTypes.length)],
      }),
    }
  })
}

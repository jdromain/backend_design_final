// Mock data for call detail drawers
// DO NOT import this file directly from components. Use lib/data/call-details.ts instead.

export const getMockTimelineEvents = () => [
  { id: "tl-1", type: "call_started" as const, timestamp: "10:32:01 AM", description: "Inbound call connected" },
  { id: "tl-2", type: "agent_spoke" as const, timestamp: "10:32:03 AM", description: "Agent greeted caller", details: "Thank you for calling. How can I help?" },
  { id: "tl-3", type: "caller_spoke" as const, timestamp: "10:32:08 AM", description: "Caller stated intent", details: "I need to reschedule my appointment" },
  { id: "tl-4", type: "tool_called" as const, timestamp: "10:32:15 AM", description: "Tool invoked: calendar_check", details: "Fetching available slots" },
  { id: "tl-5", type: "agent_spoke" as const, timestamp: "10:32:20 AM", description: "Agent confirmed availability", details: "I have Tuesday at 2pm available" },
  { id: "tl-6", type: "caller_spoke" as const, timestamp: "10:32:30 AM", description: "Caller confirmed new time" },
  { id: "tl-7", type: "tool_called" as const, timestamp: "10:32:35 AM", description: "Tool invoked: update_booking", details: "Rescheduling appointment" },
  { id: "tl-8", type: "call_ended" as const, timestamp: "10:33:12 AM", description: "Call ended — goal achieved" },
]

export const getMockTranscriptLines = () => [
  { id: "tr-1", role: "agent" as const, text: "Thank you for calling Customer Support. How can I help you today?", timestamp: "10:32:03 AM" },
  { id: "tr-2", role: "caller" as const, text: "Hi, I need to reschedule my appointment from Monday to next Tuesday.", timestamp: "10:32:08 AM" },
  { id: "tr-3", role: "agent" as const, text: "I can help with that. Let me check the available slots for Tuesday.", timestamp: "10:32:15 AM" },
  { id: "tr-4", role: "agent" as const, text: "I have Tuesday at 2:00 PM and 4:30 PM available. Which works for you?", timestamp: "10:32:20 AM" },
  { id: "tr-5", role: "caller" as const, text: "2 PM works great, thank you!", timestamp: "10:32:30 AM" },
  { id: "tr-6", role: "agent" as const, text: "Perfect, I've rescheduled your appointment to Tuesday at 2:00 PM. You'll receive a confirmation shortly.", timestamp: "10:32:38 AM" },
  { id: "tr-7", role: "caller" as const, text: "Great, thanks for the help!", timestamp: "10:32:50 AM" },
  { id: "tr-8", role: "agent" as const, text: "My pleasure! Have a great day.", timestamp: "10:32:55 AM" },
]

export const getMockToolActivities = () => [
  {
    id: "tool-1",
    name: "calendar_check",
    status: "success" as const,
    latency: 145,
    timestamp: "10:32:15 AM",
    input: { date: "next Tuesday" },
    output: { slots: ["2:00 PM", "4:30 PM"] },
  },
  {
    id: "tool-2",
    name: "update_booking",
    status: "success" as const,
    latency: 210,
    timestamp: "10:32:35 AM",
    input: { newDate: "Tuesday 2:00 PM" },
    output: { confirmed: true, confirmationId: "CONF-4892" },
  },
]

export const getMockTimelineForCall = () => getMockTimelineEvents()

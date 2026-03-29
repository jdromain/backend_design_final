// Mock data for the recent activity feed
// DO NOT import this file directly from components. Use lib/data/activities.ts instead.

export const getMockActivities = () => [
  {
    id: "1",
    severity: "error" as const,
    type: "tool",
    message: "HubSpot API connection timeout",
    timestamp: new Date(Date.now() - 1000 * 60 * 2),
    count: 3,
  },
  {
    id: "2",
    severity: "warning" as const,
    type: "escalation",
    message: "Call handed off to human agent",
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    count: 1,
  },
  {
    id: "3",
    severity: "info" as const,
    type: "call",
    message: "Call completed successfully",
    timestamp: new Date(Date.now() - 1000 * 60 * 8),
    count: 1,
  },
  {
    id: "4",
    severity: "error" as const,
    type: "tool",
    message: "Calendar sync failed — retry scheduled",
    timestamp: new Date(Date.now() - 1000 * 60 * 12),
    count: 2,
  },
  {
    id: "5",
    severity: "info" as const,
    type: "config",
    message: "Agent configuration updated",
    timestamp: new Date(Date.now() - 1000 * 60 * 18),
    count: 1,
  },
  {
    id: "6",
    severity: "warning" as const,
    type: "escalation",
    message: "Multiple handoffs detected in 10 min",
    timestamp: new Date(Date.now() - 1000 * 60 * 22),
    count: 1,
  },
  {
    id: "7",
    severity: "info" as const,
    type: "call",
    message: "New incoming call completed",
    timestamp: new Date(Date.now() - 1000 * 60 * 25),
    count: 1,
  },
  {
    id: "8",
    severity: "error" as const,
    type: "tool",
    message: "Email delivery failed — contact unreachable",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    count: 1,
  },
]

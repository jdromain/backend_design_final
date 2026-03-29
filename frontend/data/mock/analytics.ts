// Mock data extracted from components/pages/analytics-page.tsx
// DO NOT import this file directly from components. Use lib/data/analytics.ts instead.

export const mockPhoneLines = ["+1 (555) 100-0001", "+1 (555) 100-0002", "+1 (555) 100-0003"]

export const mockToolsPerformance = [
  { name: "calendar_check", usageCount: 342, failureRate: 2.3, avgLatency: 145, lastFailure: "2h ago" },
  { name: "send_email", usageCount: 289, failureRate: 1.4, avgLatency: 234, lastFailure: "5h ago" },
  { name: "lookup_customer", usageCount: 267, failureRate: 4.1, avgLatency: 89, lastFailure: "1h ago" },
  { name: "update_order", usageCount: 198, failureRate: 8.2, avgLatency: 312, lastFailure: "30m ago" },
  { name: "transfer_call", usageCount: 145, failureRate: 0.5, avgLatency: 67, lastFailure: null },
]

export const mockAssistant = {
  name: "Customer Support Agent",
  version: "v1.0",
  totalCalls: 547,
  handledRate: 89.4,
  escalationRate: 4.8,
  failureRate: 5.8,
  avgDuration: 194,
  topIntents: [
    { name: "Booking/Scheduling", count: 156, percentage: 28.5 },
    { name: "Billing Questions", count: 134, percentage: 24.5 },
    { name: "Product Support", count: 98, percentage: 17.9 },
    { name: "General Inquiry", count: 87, percentage: 15.9 },
    { name: "Complaints", count: 72, percentage: 13.2 },
  ],
}

export const mockInsights = [
  {
    type: "regression" as const,
    title: "Escalation rate increased 12%",
    detail: "Compare to previous 7 days",
    severity: "high" as const,
  },
  {
    type: "spike" as const,
    title: "Peak at 2pm Tuesday",
    detail: "42 concurrent calls, 2x normal",
    severity: "medium" as const,
  },
  {
    type: "improvement" as const,
    title: "Handle rate up 3.2%",
    detail: "Calendar tool improvements helping",
    severity: "low" as const,
  },
]

// Mock data extracted from components/pages/billing-page.tsx
// DO NOT import this file directly from components. Use lib/data/billing.ts instead.

export const mockUsageByPeriod = {
  "7d": {
    callMinutes: { used: 2100, limit: 10000, trend: 4 },
    agents: { used: 1, limit: 1, trend: 0 },
    storage: { used: 2.1, limit: 5, trend: 3 },
    tokens: { used: 320000, limit: 2000000, trend: 6 },
  },
  "30d": {
    callMinutes: { used: 8542, limit: 10000, trend: 12 },
    agents: { used: 1, limit: 1, trend: 0 },
    storage: { used: 2.4, limit: 5, trend: 8 },
    tokens: { used: 1250000, limit: 2000000, trend: 15 },
  },
  "90d": {
    callMinutes: { used: 7623, limit: 10000, trend: -5 },
    agents: { used: 1, limit: 1, trend: 0 },
    storage: { used: 2.2, limit: 5, trend: 10 },
    tokens: { used: 1087000, limit: 2000000, trend: 8 },
  },
}

export const mockBreakdownByPeriod = {
  "7d": [
    { category: "Telephony", usage: 2100, usageUnit: "min", cost: 21.0, color: "#3b82f6" },
    { category: "LLM Tokens", usage: 320000, usageUnit: "tokens", cost: 9.6, color: "#10b981" },
    { category: "Tool Invocations", usage: 890, usageUnit: "calls", cost: 4.45, color: "#f59e0b" },
    { category: "Storage", usage: 2.1, usageUnit: "GB", cost: 4.2, color: "#8b5cf6" },
    { category: "Phone Numbers", usage: 3, usageUnit: "numbers", cost: 15.0, color: "#ec4899" },
  ],
  "30d": [
    { category: "Telephony", usage: 8542, usageUnit: "min", cost: 85.42, color: "#3b82f6" },
    { category: "LLM Tokens", usage: 1250000, usageUnit: "tokens", cost: 37.5, color: "#10b981" },
    { category: "Tool Invocations", usage: 4521, usageUnit: "calls", cost: 22.61, color: "#f59e0b" },
    { category: "Storage", usage: 2.4, usageUnit: "GB", cost: 4.8, color: "#8b5cf6" },
    { category: "Phone Numbers", usage: 3, usageUnit: "numbers", cost: 15.0, color: "#ec4899" },
  ],
  "90d": [
    { category: "Telephony", usage: 7623, usageUnit: "min", cost: 76.23, color: "#3b82f6" },
    { category: "LLM Tokens", usage: 1087000, usageUnit: "tokens", cost: 32.61, color: "#10b981" },
    { category: "Tool Invocations", usage: 3892, usageUnit: "calls", cost: 19.46, color: "#f59e0b" },
    { category: "Storage", usage: 2.2, usageUnit: "GB", cost: 4.4, color: "#8b5cf6" },
    { category: "Phone Numbers", usage: 3, usageUnit: "numbers", cost: 15.0, color: "#ec4899" },
  ],
}

export const mockAgentUsage = {
  id: "1",
  name: "Customer Support Agent",
  calls: 2341,
  minutes: 3456,
  tokens: 450000,
  cost: 52.3,
}

export const mockToolUsage = [
  { id: "1", name: "CRM Lookup", invocations: 2341, errorRate: 0.8, cost: 11.7 },
  { id: "2", name: "Calendar Check", invocations: 1892, errorRate: 1.2, cost: 9.46 },
  { id: "3", name: "Send Email", invocations: 987, errorRate: 2.5, cost: 4.94 },
  { id: "4", name: "Knowledge Search", invocations: 654, errorRate: 0.3, cost: 3.27 },
  { id: "5", name: "Payment Process", invocations: 432, errorRate: 5.2, cost: 2.16 },
]

export const mockInvoices = [
  {
    id: "INV-2024-012",
    date: "Dec 1, 2024",
    period: "Nov 1 - Nov 30, 2024",
    status: "paid" as const,
    amount: 165.33,
    lineItems: [
      { description: "Pro Plan - Monthly", amount: 149.0 },
      { description: "Overage: Call Minutes (623 min)", amount: 6.23 },
      { description: "Overage: LLM Tokens (87k)", amount: 2.61 },
      { description: "Additional Phone Number", amount: 5.0 },
      { description: "Tax", amount: 2.49 },
    ],
    paymentMethod: "Visa •••• 4242",
  },
  {
    id: "INV-2024-011",
    date: "Nov 1, 2024",
    period: "Oct 1 - Oct 31, 2024",
    status: "paid" as const,
    amount: 149.0,
    lineItems: [{ description: "Pro Plan - Monthly", amount: 149.0 }],
    paymentMethod: "Visa •••• 4242",
  },
  {
    id: "INV-2024-010",
    date: "Oct 1, 2024",
    period: "Sep 1 - Sep 30, 2024",
    status: "paid" as const,
    amount: 99.0,
    lineItems: [{ description: "Starter Plan - Monthly", amount: 99.0 }],
    paymentMethod: "Visa •••• 4242",
  },
]

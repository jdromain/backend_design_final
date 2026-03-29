// Mock data moved from lib/search-data.ts
// DO NOT import this file directly from components. Use lib/data/search.ts instead.

export const mockPages = [
  { id: "dashboard", label: "Dashboard", route: "dashboard", icon: "BarChart3" },
  { id: "live", label: "Live Calls", route: "live", icon: "Activity" },
  { id: "history", label: "Call History", route: "history", icon: "History" },
  { id: "actions", label: "Actions", route: "actions", icon: "Zap" },
  { id: "analytics", label: "Analytics", route: "analytics", icon: "TrendingUp" },
  { id: "agents", label: "AI Agents", route: "agents", icon: "Bot" },
  { id: "knowledge", label: "Knowledge Base", route: "knowledge", icon: "BookOpen" },
  { id: "integrations", label: "Integrations", route: "integrations", icon: "Puzzle" },
  { id: "billing", label: "Billing", route: "billing", icon: "CreditCard" },
  { id: "settings", label: "Settings", route: "settings", icon: "Settings" },
  { id: "help", label: "Help & Support", route: "help", icon: "HelpCircle" },
]

export const mockCalls = [
  { id: "call-001", time: "2 min ago", caller: "+1 (555) 123-4567", outcome: "resolved", duration: "4m 32s", agent: "Support Agent" },
  { id: "call-002", time: "5 min ago", caller: "+1 (555) 234-5678", outcome: "failed", duration: "1m 15s", agent: "Sales Agent" },
  { id: "call-003", time: "12 min ago", caller: "+1 (555) 345-6789", outcome: "escalated", duration: "8m 45s", agent: "Support Agent" },
  { id: "call-004", time: "18 min ago", caller: "+1 (555) 456-7890", outcome: "resolved", duration: "3m 22s", agent: "Billing Agent" },
  { id: "call-005", time: "25 min ago", caller: "+1 (555) 567-8901", outcome: "failed", duration: "0m 45s", agent: "Support Agent" },
  { id: "call-006", time: "32 min ago", caller: "+1 (555) 678-9012", outcome: "resolved", duration: "5m 10s", agent: "Sales Agent" },
  { id: "call-007", time: "45 min ago", caller: "+1 (555) 789-0123", outcome: "escalated", duration: "12m 30s", agent: "Support Agent" },
  { id: "call-008", time: "1 hr ago", caller: "+1 (555) 890-1234", outcome: "resolved", duration: "2m 55s", agent: "Billing Agent" },
]

export const mockAgents = [
  { id: "agent-001", name: "Support Agent", status: "active", handledRate: 94.2, failRate: 2.1, phoneLines: ["+1 (800) 555-0100"] },
  { id: "agent-002", name: "Sales Agent", status: "active", handledRate: 89.5, failRate: 4.3, phoneLines: ["+1 (800) 555-0200"] },
  { id: "agent-003", name: "Billing Agent", status: "active", handledRate: 96.8, failRate: 1.2, phoneLines: ["+1 (800) 555-0300"] },
  { id: "agent-004", name: "Onboarding Agent", status: "paused", handledRate: 91.0, failRate: 3.5, phoneLines: ["+1 (800) 555-0400"] },
  { id: "agent-005", name: "Retention Agent", status: "active", handledRate: 88.7, failRate: 5.1, phoneLines: ["+1 (800) 555-0500"] },
  { id: "agent-006", name: "Technical Support", status: "draft", handledRate: 0, failRate: 0, phoneLines: [] },
]

export const mockKbDocs = [
  { id: "kb-001", title: "Getting Started Guide", status: "ready", collection: "Onboarding", updatedAt: "2 days ago" },
  { id: "kb-002", title: "Billing FAQ", status: "ready", collection: "Billing", updatedAt: "1 week ago" },
  { id: "kb-003", title: "Troubleshooting Common Issues", status: "ready", collection: "Support", updatedAt: "3 days ago" },
  { id: "kb-004", title: "Product Features Overview", status: "processing", collection: "Sales", updatedAt: "1 hour ago" },
  { id: "kb-005", title: "Refund Policy", status: "ready", collection: "Billing", updatedAt: "2 weeks ago" },
  { id: "kb-006", title: "API Documentation", status: "ready", collection: "Developer", updatedAt: "5 days ago" },
  { id: "kb-007", title: "Security Best Practices", status: "failed", collection: "Security", updatedAt: "1 day ago" },
]

export const mockIntegrations = [
  { id: "int-001", name: "Salesforce", status: "ok" },
  { id: "int-002", name: "Zendesk", status: "ok" },
  { id: "int-003", name: "Slack", status: "degraded" },
  { id: "int-004", name: "HubSpot", status: "ok" },
  { id: "int-005", name: "Stripe", status: "ok" },
  { id: "int-006", name: "Twilio", status: "error" },
  { id: "int-007", name: "Intercom", status: "ok" },
]

export const mockSettingsSections = [
  { id: "workspace", label: "Workspace Settings" },
  { id: "team", label: "Team & Roles" },
  { id: "notifications", label: "Notification Settings" },
  { id: "security", label: "Security Settings" },
  { id: "data", label: "Data & Privacy" },
  { id: "developer", label: "Developer Settings" },
  { id: "danger", label: "Danger Zone" },
]

export const mockContacts = [
  { id: "c1", name: "John Smith", phone: "+1 (555) 123-4567", tags: ["vip"] },
  { id: "c2", name: "Sarah Johnson", phone: "+1 (555) 234-5678", tags: [] },
  { id: "c3", name: "Mike Davis", phone: "+1 (555) 345-6789", tags: ["returning"] },
  { id: "c4", name: "Emily Brown", phone: "+1 (555) 456-7890", tags: ["high-value"] },
  { id: "c5", name: "David Wilson", phone: "+1 (555) 567-8901", tags: [] },
  { id: "c6", name: "Lisa Garcia", phone: "+1 (555) 678-9012", tags: ["catering"] },
]

export const mockFollowUps = [
  { id: "fu1", contact: "John Smith", type: "missed_call", status: "open", dueAt: "30 min ago" },
  { id: "fu2", contact: "Sarah Johnson", type: "reservation", status: "waiting_on_customer", dueAt: "In 2 hours" },
  { id: "fu3", contact: "Mike Davis", type: "estimate_approval", status: "open", dueAt: "In 1 hour" },
  { id: "fu4", contact: "Emily Brown", type: "missed_call", status: "in_progress", dueAt: "In 30 min" },
  { id: "fu5", contact: "David Wilson", type: "complaint", status: "open", dueAt: "1 hour ago" },
]

export const mockWorkflows = [
  { id: "wf1", name: "Missed Call Recovery", vertical: "Common", enabled: true },
  { id: "wf2", name: "Booking Confirmation", vertical: "Restaurant", enabled: true },
  { id: "wf3", name: "Estimate Approval", vertical: "AutoShop", enabled: true },
  { id: "wf4", name: "Payment Collection", vertical: "Common", enabled: false },
  { id: "wf5", name: "Complaint Recovery", vertical: "Common", enabled: true },
]

export const quickFilters: {
  id: string
  label: string
  route: string
  queryParams: Record<string, string>
  icon: string
}[] = [
  { id: "failed-calls", label: "Failed calls", route: "history", queryParams: { outcome: "failed" }, icon: "PhoneOff" },
  { id: "escalated-calls", label: "Escalated calls", route: "history", queryParams: { outcome: "escalated" }, icon: "AlertTriangle" },
  { id: "active-agents", label: "Active agents", route: "agents", queryParams: { status: "active" }, icon: "Bot" },
  { id: "paused-agents", label: "Paused agents", route: "agents", queryParams: { status: "paused" }, icon: "Pause" },
  { id: "processing-docs", label: "Processing documents", route: "knowledge", queryParams: { status: "processing" }, icon: "Loader" },
  { id: "open-followups", label: "Open follow-ups", route: "actions", queryParams: { tab: "follow-ups" }, icon: "Clock" },
  { id: "active-workflows", label: "Active workflows", route: "actions", queryParams: { tab: "workflows" }, icon: "Zap" },
]

export const suggestedActions = [
  { id: "create-agent", label: "Create Agent", route: "agents", action: "create", icon: "Bot" },
  { id: "upload-doc", label: "Upload Document", route: "knowledge", action: "upload", icon: "Upload" },
  { id: "create-followup", label: "Create Follow-up", route: "actions", action: "create-followup", icon: "Plus" },
  { id: "create-workflow", label: "Create Workflow", route: "actions", action: "create-workflow", icon: "Zap" },
]

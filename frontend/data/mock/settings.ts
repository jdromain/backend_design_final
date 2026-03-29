// Mock data extracted from components/pages/settings-page.tsx
// DO NOT import this file directly from components. Use lib/data/settings.ts instead.

export const mockTeamMembers = [
  {
    id: "1",
    name: "John Smith",
    email: "john@acmecorp.com",
    role: "admin" as const,
    status: "active" as const,
    lastActive: "2 hours ago",
  },
  {
    id: "2",
    name: "Sarah Johnson",
    email: "sarah@acmecorp.com",
    role: "editor" as const,
    status: "active" as const,
    lastActive: "1 day ago",
  },
  {
    id: "3",
    name: "Mike Wilson",
    email: "mike@acmecorp.com",
    role: "viewer" as const,
    status: "active" as const,
    lastActive: "3 days ago",
  },
  {
    id: "4",
    name: "Pending User",
    email: "pending@acmecorp.com",
    role: "viewer" as const,
    status: "invited" as const,
    lastActive: "Never",
  },
]

export const mockApiKeys = [
  {
    id: "1",
    name: "Production API",
    prefix: "rz_live_",
    created: "Dec 1, 2024",
    lastUsed: "2 hours ago",
    status: "active" as const,
  },
  {
    id: "2",
    name: "Development",
    prefix: "rz_test_",
    created: "Nov 15, 2024",
    lastUsed: "5 days ago",
    status: "active" as const,
  },
  {
    id: "3",
    name: "Old Integration",
    prefix: "rz_live_",
    created: "Oct 1, 2024",
    lastUsed: "30 days ago",
    status: "revoked" as const,
  },
]

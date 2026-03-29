// Mock data for notification center
// DO NOT import this file directly from components. Use lib/data/notifications.ts instead.

export const getMockNotifications = () => [
  {
    id: "notif-1",
    type: "error" as const,
    title: "Integration Error",
    message: "HubSpot connection failed. Re-authentication required.",
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    read: false,
    actionUrl: "/integrations",
  },
  {
    id: "notif-2",
    type: "warning" as const,
    title: "High Escalation Rate",
    message: "Escalation rate is 12% above your weekly average.",
    timestamp: new Date(Date.now() - 1000 * 60 * 30),
    read: false,
    actionUrl: "/analytics",
  },
  {
    id: "notif-3",
    type: "success" as const,
    title: "Agent Updated",
    message: "Customer Support Agent v1.2 is now live.",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
    read: true,
  },
  {
    id: "notif-4",
    type: "info" as const,
    title: "New Invoice Available",
    message: "Your November invoice for $165.33 is ready.",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24),
    read: true,
    actionUrl: "/billing",
  },
  {
    id: "notif-5",
    type: "warning" as const,
    title: "Usage Alert",
    message: "You have used 85% of your monthly call minutes.",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48),
    read: true,
    actionUrl: "/billing",
  },
]

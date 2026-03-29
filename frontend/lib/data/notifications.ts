import { assertMockSafety } from "./_env-check"
import { getMockNotifications } from "@/data/mock/notifications"
import type { Notification } from "@/types/api"
import { get } from "@/lib/api-client"

assertMockSafety()

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true"

function normalizeNotification(n: {
  id: string
  type: Notification["type"]
  title: string
  message: string
  read: boolean
  timestamp: string | Date
  actionUrl?: string
}): Notification {
  const ts = n.timestamp
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    read: n.read,
    actionUrl: n.actionUrl,
    timestamp: ts instanceof Date ? ts.toISOString() : ts,
  }
}

export async function getNotifications(): Promise<Notification[]> {
  if (useMocks) return getMockNotifications().map(normalizeNotification)
  return get<Notification[]>("/notifications")
}

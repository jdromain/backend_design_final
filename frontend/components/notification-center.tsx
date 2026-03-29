"use client"

import { useState, useEffect } from "react"
import { Bell, Check, Clock, AlertTriangle, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { formatDistance } from "date-fns"
import { useToast } from "@/hooks/use-toast"

interface Notification {
  id: string
  type: "info" | "success" | "warning" | "error"
  title: string
  message: string
  timestamp: Date
  read: boolean
  actionUrl?: string
}

import { getNotifications } from "@/lib/data/notifications"

interface NotificationCenterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NotificationCenter({ open, onOpenChange }: NotificationCenterProps) {
  const { toast } = useToast()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [allNotificationsOpen, setAllNotificationsOpen] = useState(false)

  // Load notifications on mount
  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const data = await getNotifications()
        setNotifications(
          data.map((n) => ({
            ...n,
            timestamp: typeof n.timestamp === "string" ? new Date(n.timestamp) : n.timestamp,
          })),
        )
      } catch (error) {
        console.error("Failed to load notifications:", error)
      } finally {
        setLoading(false)
      }
    }
    loadNotifications()
  }, [])

  const unreadCount = notifications.filter((n) => !n.read).length

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    toast({
      title: "Notifications cleared",
      description: "All notifications marked as read",
    })
  }

  const markAsRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const handleNotificationClick = (notification: Notification) => {
    markAsRead(notification.id)
    if (notification.actionUrl) {
      toast({
        title: "Navigating",
        description: `Opening ${notification.actionUrl}...`,
      })
    }
  }

  const handleViewAll = () => {
    onOpenChange(false)
    setAllNotificationsOpen(true)
  }

  const handleClearAll = () => {
    setNotifications([])
    toast({
      title: "Notifications cleared",
      description: "All notifications have been removed",
    })
  }

  const getIcon = (type: Notification["type"]) => {
    switch (type) {
      case "success":
        return <Check className="h-4 w-4 text-emerald-500" />
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />
      case "error":
        return <AlertTriangle className="h-4 w-4 text-red-500" />
      default:
        return <Info className="h-4 w-4 text-sky-500" />
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs" variant="destructive">
                {unreadCount}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <div className="flex items-center justify-between p-4">
            <h4 className="font-semibold">Notifications</h4>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs" onClick={markAllAsRead}>
                Mark all as read
              </Button>
            )}
          </div>
          <Separator />
          <ScrollArea className="h-[300px]">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <Bell className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            ) : (
              <div className="divide-y">
                {notifications.map((notification) => (
                  <button
                    key={notification.id}
                    type="button"
                    className={`flex gap-3 p-4 transition-colors hover:bg-muted/50 w-full text-left ${
                      !notification.read ? "bg-muted/30" : ""
                    }`}
                    onClick={() => handleNotificationClick(notification)}
                  >
                    <div className="mt-0.5">{getIcon(notification.type)}</div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{notification.title}</p>
                      <p className="text-sm text-muted-foreground">{notification.message}</p>
                      <p className="flex items-center text-xs text-muted-foreground">
                        <Clock className="mr-1 h-3 w-3" />
                        {formatDistance(notification.timestamp, new Date(), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                    {!notification.read && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
          <Separator />
          <div className="p-2">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={handleViewAll}>
              View all notifications
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={allNotificationsOpen} onOpenChange={setAllNotificationsOpen}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>All Notifications</DialogTitle>
            <DialogDescription>
              {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 mb-4">
            <Button variant="outline" size="sm" onClick={markAllAsRead} disabled={unreadCount === 0}>
              Mark all read
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearAll} disabled={notifications.length === 0}>
              Clear all
            </Button>
          </div>
          <ScrollArea className="h-[400px] pr-4">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <Bell className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No notifications</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className={`flex gap-3 p-3 rounded-lg border transition-colors ${
                      !notification.read ? "bg-muted/30 border-primary/20" : ""
                    }`}
                  >
                    <div className="mt-0.5">{getIcon(notification.type)}</div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium leading-none">{notification.title}</p>
                        {!notification.read && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => markAsRead(notification.id)}
                          >
                            Mark read
                          </Button>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{notification.message}</p>
                      <p className="flex items-center text-xs text-muted-foreground">
                        <Clock className="mr-1 h-3 w-3" />
                        {formatDistance(notification.timestamp, new Date(), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}

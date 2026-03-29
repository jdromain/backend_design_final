"use client"

import type React from "react"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Phone,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Bot,
  Wrench,
  Clock,
  Settings,
  ChevronRight,
  Info,
} from "lucide-react"
import { formatDistance } from "date-fns"
import { cn } from "@/lib/utils"

export type ActivitySeverity = "info" | "warning" | "error"
export type ActivityFilter = "all" | "errors" | "escalations" | "config" | "tools"

interface ActivityItem {
  id: string
  severity: ActivitySeverity
  type: string
  message: string
  timestamp: Date
  agent?: string
  count?: number
  metadata?: Record<string, string>
}

interface RecentActivityFeedProps {
  activities: ActivityItem[]
  onActivityClick?: (activity: ActivityItem) => void
}

const severityConfig = {
  info: {
    icon: Info,
    color: "text-sky-600 dark:text-sky-400",
    bgColor: "bg-sky-500/10",
    badgeClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-500/10",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  error: {
    icon: XCircle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-500/10",
    badgeClass: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
}

const typeIcons: Record<string, React.ElementType> = {
  call: Phone,
  agent: Bot,
  tool: Wrench,
  config: Settings,
  escalation: AlertTriangle,
}

export function RecentActivityFeed({ activities, onActivityClick }: RecentActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityFilter>("all")

  const filteredActivities = activities.filter((activity) => {
    if (filter === "all") return true
    if (filter === "errors") return activity.severity === "error"
    if (filter === "escalations") return activity.type === "escalation"
    if (filter === "config") return activity.type === "config"
    if (filter === "tools") return activity.type === "tool"
    return true
  })

  // Group repeated issues
  const groupedActivities = filteredActivities.reduce((acc, activity) => {
    const lastItem = acc[acc.length - 1]
    if (
      lastItem &&
      lastItem.message === activity.message &&
      lastItem.severity === activity.severity &&
      Date.now() - activity.timestamp.getTime() < 10 * 60 * 1000 // within 10 minutes
    ) {
      lastItem.count = (lastItem.count || 1) + 1
      return acc
    }
    return [...acc, { ...activity, count: activity.count || 1 }]
  }, [] as ActivityItem[])

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Recent Activity</CardTitle>
          <Badge variant="outline" className="text-xs gap-1.5">
            Live
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </span>
          </Badge>
        </div>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as ActivityFilter)} className="mt-2">
          <TabsList className="h-8 w-full grid grid-cols-5">
            <TabsTrigger value="all" className="text-xs px-1">
              All
            </TabsTrigger>
            <TabsTrigger value="errors" className="text-xs px-1">
              Errors
            </TabsTrigger>
            <TabsTrigger value="escalations" className="text-xs px-1">
              Esc.
            </TabsTrigger>
            <TabsTrigger value="config" className="text-xs px-1">
              Config
            </TabsTrigger>
            <TabsTrigger value="tools" className="text-xs px-1">
              Tools
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <ScrollArea className="h-[400px] px-4 pb-4">
          {groupedActivities.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <CheckCircle className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No activity to show</p>
            </div>
          ) : (
            <div className="space-y-3">
              {groupedActivities.map((activity) => {
                const severityCfg = severityConfig[activity.severity]
                const SeverityIcon = severityCfg.icon
                const TypeIcon = typeIcons[activity.type] || Info

                return (
                  <div
                    key={activity.id}
                    className={cn(
                      "flex gap-3 p-3 rounded-lg border transition-colors",
                      "hover:bg-muted/50 cursor-pointer",
                      activity.severity === "error" && "border-red-500/20 bg-red-500/5",
                    )}
                    onClick={() => onActivityClick?.(activity)}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        severityCfg.bgColor,
                      )}
                    >
                      <SeverityIcon className={cn("h-4 w-4", severityCfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">{activity.message}</p>
                        {activity.count && activity.count > 1 && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            x{activity.count}
                          </Badge>
                        )}
                      </div>
                      {activity.agent && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Bot className="h-3 w-3" />
                          {activity.agent}
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <p className="flex items-center text-xs text-muted-foreground">
                          <Clock className="mr-1 h-3 w-3" />
                          {formatDistance(activity.timestamp, new Date(), { addSuffix: true })}
                        </p>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                          Open <ChevronRight className="ml-1 h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

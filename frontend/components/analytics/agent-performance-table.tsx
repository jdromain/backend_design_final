"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Bot, CheckCircle, Users, XCircle, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"

interface AssistantPerformance {
  name: string
  version?: string
  totalCalls: number
  handledRate: number
  escalationRate: number
  failureRate: number
  avgDuration: number
  topIntents?: { name: string; count: number; percentage: number }[]
}

interface AssistantPerformanceCardProps {
  assistant: AssistantPerformance
}

export function AssistantPerformanceCard({ assistant }: AssistantPerformanceCardProps) {
  const formatPercentage = (value: number) => `${value.toFixed(1)}%`
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
  }

  const metrics = [
    {
      label: "Handled Rate",
      value: assistant.handledRate,
      icon: CheckCircle,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      label: "Escalation Rate",
      value: assistant.escalationRate,
      icon: Users,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      label: "Failure Rate",
      value: assistant.failureRate,
      icon: XCircle,
      color: assistant.failureRate > 5 ? "text-red-500" : "text-muted-foreground",
      bgColor: assistant.failureRate > 5 ? "bg-red-500/10" : "bg-muted",
    },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Agent Performance</CardTitle>
        </div>
        {assistant.version && (
          <Badge variant="outline" className="text-xs font-mono">
            {assistant.version}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Assistant name & calls */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div>
            <p className="font-medium text-sm">{assistant.name}</p>
            <p className="text-xs text-muted-foreground">Avg duration: {formatDuration(assistant.avgDuration)}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums">{assistant.totalCalls.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">calls handled</p>
          </div>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-3">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <div key={metric.label} className="text-center">
                <div className={cn("inline-flex items-center justify-center rounded-lg p-2 mb-1.5", metric.bgColor)}>
                  <Icon className={cn("h-4 w-4", metric.color)} />
                </div>
                <p className="text-lg font-semibold tabular-nums">{formatPercentage(metric.value)}</p>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
              </div>
            )
          })}
        </div>

        {/* Top Intents */}
        {assistant.topIntents && assistant.topIntents.length > 0 && (
          <div className="pt-3 border-t border-border">
            <div className="flex items-center gap-1.5 mb-2">
              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground">Top Intents</p>
            </div>
            <div className="space-y-2">
              {assistant.topIntents.slice(0, 4).map((intent) => (
                <div key={intent.name} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium truncate">{intent.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums ml-2">{intent.count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary/60 rounded-full"
                        style={{ width: `${intent.percentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Keep backwards compat

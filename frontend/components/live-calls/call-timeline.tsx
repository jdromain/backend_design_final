"use client"

import { cn } from "@/lib/utils"
import { Phone, PhoneOff, Wrench, AlertTriangle, User, CheckCircle, XCircle, ArrowRight, Bot } from "lucide-react"
import type { TimelineEvent } from "@/types/api"

interface CallTimelineProps {
  events: TimelineEvent[]
}

export function CallTimeline({ events }: CallTimelineProps) {
  const getEventIcon = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "call_started":
        return <Phone className="h-3.5 w-3.5" />
      case "agent_spoke":
        return <Bot className="h-3.5 w-3.5" />
      case "caller_spoke":
        return <User className="h-3.5 w-3.5" />
      case "tool_called":
        return <Wrench className="h-3.5 w-3.5" />
      case "call_ended":
        return <PhoneOff className="h-3.5 w-3.5" />
      case "transfer":
        return <ArrowRight className="h-3.5 w-3.5" />
      case "error":
        return <XCircle className="h-3.5 w-3.5" />
      default:
        return <User className="h-3.5 w-3.5" />
    }
  }

  const getEventColor = (type: TimelineEvent["type"]) => {
    switch (type) {
      case "call_started":
        return "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
      case "agent_spoke":
        return "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
      case "caller_spoke":
        return "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
      case "tool_called":
        return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
      case "call_ended":
        return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
      case "transfer":
        return "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
      case "error":
        return "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
      default:
        return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
    }
  }

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  }

  return (
    <div className="space-y-1">
      {events.map((event, index) => (
        <div key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className={cn("flex h-6 w-6 items-center justify-center rounded-full", getEventColor(event.type))}>
              {getEventIcon(event.type)}
            </div>
            {index < events.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
          </div>
          <div className="flex-1 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{event.description}</span>
              <span className="text-xs text-muted-foreground">{formatTime(event.timestamp)}</span>
            </div>
            {event.details && <p className="text-xs text-muted-foreground mt-0.5">{event.details}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

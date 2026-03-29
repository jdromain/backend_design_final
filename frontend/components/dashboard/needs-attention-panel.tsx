"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  AlertTriangle,
  Zap,
  Unplug,
  TrendingDown,
  Clock,
  CheckCircle2,
  History,
  ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

export interface Incident {
  id: string
  severity: "high" | "medium" | "low"
  icon: "escalation" | "tool" | "integration" | "drop"
  title: string
  description: string
  since: string
  action: {
    label: string
    page: string
    params?: Record<string, string>
  }
}

interface NeedsAttentionPanelProps {
  incidents: Incident[]
  onAction: (page: string, params?: Record<string, string>) => void
  onViewActivity: () => void
}

const severityConfig = {
  high: {
    badge: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    border: "border-red-500/30 hover:border-red-500/50",
    glow: "shadow-red-500/5",
  },
  medium: {
    badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    border: "border-amber-500/30 hover:border-amber-500/50",
    glow: "shadow-amber-500/5",
  },
  low: {
    badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
    border: "border-sky-500/30 hover:border-sky-500/50",
    glow: "shadow-sky-500/5",
  },
}

const iconMap = {
  escalation: AlertTriangle,
  tool: Zap,
  integration: Unplug,
  drop: TrendingDown,
}

function IncidentCard({ incident, onAction }: { incident: Incident; onAction: NeedsAttentionPanelProps["onAction"] }) {
  const config = severityConfig[incident.severity]
  const Icon = iconMap[incident.icon]

  return (
    <Card className={cn("min-w-[280px] max-w-[320px] transition-all", config.border, config.glow)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-md", severityConfig[incident.severity].badge.split(" ")[0])}>
              <Icon className="h-4 w-4" />
            </div>
            <Badge variant="outline" className={config.badge}>
              {incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1)}
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {incident.since}
          </div>
        </div>
        <div className="space-y-1">
          <h4 className="font-semibold text-sm">{incident.title}</h4>
          <p className="text-xs text-muted-foreground line-clamp-1">{incident.description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-xs bg-transparent"
          onClick={() => onAction(incident.action.page, incident.action.params)}
        >
          {incident.action.label}
          <ArrowRight className="ml-1 h-3 w-3" />
        </Button>
      </CardContent>
    </Card>
  )
}

export function NeedsAttentionPanel({ incidents, onAction, onViewActivity }: NeedsAttentionPanelProps) {
  if (incidents.length === 0) {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">All clear</h3>
                <p className="text-xs text-muted-foreground">No incidents in the last 24 hours</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onViewActivity}>
              <History className="mr-1 h-3 w-3" />
              View recent activity
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-red-500/20 bg-gradient-to-r from-red-500/5 via-transparent to-transparent">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <h3 className="font-semibold text-sm">Needs Attention Now</h3>
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {incidents.length}
            </Badge>
          </div>
        </div>
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-2">
            {incidents.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} onAction={onAction} />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

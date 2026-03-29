"use client"

import { Bot, Phone, Database, Plug, AlertTriangle, Clock } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AgentActionsMenu } from "./agent-actions-menu"
import { formatDistanceToNow } from "date-fns"

export interface Agent {
  id: string
  name: string
  description: string
  version: number
  status: "active" | "paused" | "draft"
  agentType: "support" | "sales" | "booking" | "custom"
  callsToday: number
  handledRate: number
  escalationRate: number
  failureRate: number
  toolErrorRate: number
  phoneLines: string[]
  knowledgeBase: {
    status: "connected" | "missing" | "processing" | "error"
    name?: string
  }
  integrations: {
    name: string
    status: "healthy" | "warning" | "error"
  }[]
  updatedAt: string
  createdAt: string
}

interface AgentCardProps {
  agent: Agent
  onManage: (agent: Agent) => void
  onTest: (agent: Agent) => void
  onToggleStatus: (agent: Agent) => void
  onDuplicate: (agent: Agent) => void
  onViewAnalytics: (agent: Agent) => void
  onVersionHistory: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}

export function AgentCard({
  agent,
  onManage,
  onTest,
  onToggleStatus,
  onDuplicate,
  onViewAnalytics,
  onVersionHistory,
  onDelete,
}: AgentCardProps) {
  const hasWarnings = agent.failureRate > 10 || agent.escalationRate > 15 || agent.toolErrorRate > 5
  const hasIntegrationWarning = agent.integrations.some((i) => i.status !== "healthy")

  const getStatusBadge = () => {
    switch (agent.status) {
      case "active":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0">
            <span className="mr-1.5 relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </span>
            Live
          </Badge>
        )
      case "paused":
        return <Badge variant="secondary">Paused</Badge>
      case "draft":
        return <Badge variant="outline">Draft</Badge>
    }
  }

  const getKnowledgeBaseBadge = () => {
    const kb = agent.knowledgeBase
    switch (kb.status) {
      case "connected":
        return (
          <Badge variant="outline" className="text-xs gap-1">
            <Database className="h-3 w-3" />
            {kb.name || "Connected"}
          </Badge>
        )
      case "missing":
        return (
          <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/50">
            <Database className="h-3 w-3" />
            Missing
          </Badge>
        )
      case "processing":
        return (
          <Badge variant="outline" className="text-xs gap-1 text-blue-500 border-blue-500/50">
            <Database className="h-3 w-3" />
            Processing
          </Badge>
        )
      case "error":
        return (
          <Badge variant="outline" className="text-xs gap-1 text-red-500 border-red-500/50">
            <Database className="h-3 w-3" />
            Error
          </Badge>
        )
    }
  }

  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all hover:shadow-md hover:border-primary/50",
        hasWarnings && "border-amber-500/30",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                agent.status === "active" ? "bg-primary/10" : agent.status === "draft" ? "bg-muted" : "bg-muted",
              )}
            >
              <Bot className={cn("h-5 w-5", agent.status === "active" ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{agent.name}</h3>
                <span className="text-xs text-muted-foreground">v{agent.version}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-1">{agent.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {getStatusBadge()}
            <AgentActionsMenu
              agent={agent}
              onDuplicate={onDuplicate}
              onViewAnalytics={onViewAnalytics}
              onVersionHistory={onVersionHistory}
              onDelete={onDelete}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Metrics Row */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="rounded-md bg-muted/50 p-2">
            <p className="text-lg font-semibold">{agent.callsToday}</p>
            <p className="text-xs text-muted-foreground">Calls</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className={cn("text-lg font-semibold", agent.handledRate < 85 && "text-amber-500")}>
              {agent.handledRate}%
            </p>
            <p className="text-xs text-muted-foreground">Handled</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className={cn("text-lg font-semibold", agent.escalationRate > 15 && "text-amber-500")}>
              {agent.escalationRate}%
            </p>
            <p className="text-xs text-muted-foreground">Escalated</p>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <p className={cn("text-lg font-semibold", agent.failureRate > 10 && "text-red-500")}>
              {agent.failureRate}%
            </p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
        </div>

        {/* Dependencies Row */}
        <div className="flex flex-wrap items-center gap-2">
          {agent.phoneLines.length > 0 ? (
            agent.phoneLines.slice(0, 2).map((line) => (
              <Badge key={line} variant="outline" className="text-xs gap-1">
                <Phone className="h-3 w-3" />
                {line}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="text-xs gap-1 text-amber-500 border-amber-500/50">
              <Phone className="h-3 w-3" />
              Not assigned
            </Badge>
          )}
          {agent.phoneLines.length > 2 && (
            <Badge variant="outline" className="text-xs">
              +{agent.phoneLines.length - 2}
            </Badge>
          )}

          {getKnowledgeBaseBadge()}

          {agent.integrations.slice(0, 2).map((integration) => (
            <Badge
              key={integration.name}
              variant="outline"
              className={cn(
                "text-xs gap-1",
                integration.status === "warning" && "text-amber-500 border-amber-500/50",
                integration.status === "error" && "text-red-500 border-red-500/50",
              )}
            >
              <Plug className="h-3 w-3" />
              {integration.name}
              {integration.status !== "healthy" && <AlertTriangle className="h-3 w-3" />}
            </Badge>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Updated {formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs bg-transparent" onClick={() => onTest(agent)}>
              Test
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs bg-transparent"
              onClick={() => onToggleStatus(agent)}
            >
              {agent.status === "active" ? "Pause" : "Activate"}
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => onManage(agent)}>
              Manage
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

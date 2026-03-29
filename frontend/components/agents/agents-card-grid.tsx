"use client"

import { formatDistanceToNow } from "date-fns"
import {
  MoreHorizontal,
  Play,
  Pause,
  Copy,
  History,
  Trash2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { Agent } from "./agents-table"

interface AgentsCardGridProps {
  agents: Agent[]
  isLoading?: boolean
  onCardClick: (agent: Agent) => void
  onManage: (agent: Agent) => void
  onToggleStatus: (agent: Agent) => void
  onDuplicate: (agent: Agent) => void
  onVersionHistory: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}

export function AgentsCardGrid({
  agents,
  isLoading,
  onCardClick,
  onManage,
  onToggleStatus,
  onDuplicate,
  onVersionHistory,
  onDelete,
}: AgentsCardGridProps) {
  const getStatusBadge = (status: Agent["status"]) => {
    const variants: Record<string, "default" | "secondary" | "outline"> = {
      active: "default",
      paused: "secondary",
      draft: "outline",
    }
    return (
      <Badge variant={variants[status]} className="capitalize">
        {status}
      </Badge>
    )
  }

  const agentNeedsAttention = (agent: Agent) => {
    return (
      agent.knowledgeBase?.status === "missing" ||
      agent.knowledgeBase?.status === "processing" ||
      agent.integrations.some((i) => i.status !== "healthy") ||
      agent.phoneLines.length === 0 ||
      agent.failureRate > 5
    )
  }

  const getAttentionReason = (agent: Agent): string | null => {
    if (agent.phoneLines.length === 0) return "Missing phone routing"
    if (agent.knowledgeBase?.status === "missing") return "Knowledge base not configured"
    if (agent.knowledgeBase?.status === "processing") return "Knowledge base processing"
    if (agent.integrations.some((i) => i.status === "error")) return "Integration error"
    if (agent.failureRate > 5) return `High failure rate (${agent.failureRate}%)`
    return null
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[220px] w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (agents.length === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => {
          const needsAttention = agentNeedsAttention(agent)
          const attentionReason = getAttentionReason(agent)

          return (
            <Card
              key={agent.id}
              className={`cursor-pointer transition-all hover:shadow-md ${needsAttention ? "border-l-4 border-l-amber-500" : ""}`}
              onClick={() => onCardClick(agent)}
            >
              <CardContent className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{agent.name}</h3>
                    <Badge variant="outline" className="text-xs">
                      v{agent.version}
                    </Badge>
                  </div>
                  {getStatusBadge(agent.status)}
                </div>

                {/* Stats */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-xl font-semibold">{agent.callsToday}</p>
                    <p className="text-xs text-muted-foreground">Calls</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-semibold">{agent.handledRate}%</p>
                    <p className="text-xs text-muted-foreground">Handled</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-xl font-semibold ${agent.failureRate > 5 ? "text-red-500" : ""}`}>
                      {agent.failureRate}%
                    </p>
                    <p className="text-xs text-muted-foreground">Fail</p>
                  </div>
                </div>

                {/* Chips */}
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {agent.phoneLines.length > 0 ? (
                    <>
                      <Badge variant="outline" className="text-xs font-mono">
                        {agent.phoneLines[0].slice(-8)}
                      </Badge>
                      {agent.phoneLines.length > 1 && (
                        <Badge variant="outline" className="text-xs">
                          +{agent.phoneLines.length - 1}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      No phone
                    </Badge>
                  )}

                  {agent.knowledgeBase?.name && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="text-xs gap-1">
                          {agent.knowledgeBase.status === "connected" && (
                            <CheckCircle className="h-3 w-3 text-emerald-500" />
                          )}
                          {agent.knowledgeBase.status === "processing" && (
                            <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />
                          )}
                          KB
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{agent.knowledgeBase.name}</TooltipContent>
                    </Tooltip>
                  )}

                  {agent.integrations.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="text-xs gap-1">
                          {agent.integrations.some((i) => i.status === "error") ? (
                            <XCircle className="h-3 w-3 text-red-500" />
                          ) : agent.integrations.some((i) => i.status === "warning") ? (
                            <AlertTriangle className="h-3 w-3 text-amber-500" />
                          ) : (
                            <CheckCircle className="h-3 w-3 text-emerald-500" />
                          )}
                          {agent.integrations.length} tools
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>{agent.integrations.map((i) => i.name).join(", ")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {/* Attention Warning */}
                {needsAttention && attentionReason && (
                  <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {attentionReason}
                  </div>
                )}

                {/* Footer */}
                <div
                  className="mt-4 flex items-center justify-between border-t pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => onManage(agent)}>
                      Manage
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onDuplicate(agent)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onVersionHistory(agent)}>
                          <History className="mr-2 h-4 w-4" />
                          Version History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onToggleStatus(agent)}>
                          {agent.status === "active" ? (
                            <>
                              <Pause className="mr-2 h-4 w-4" />
                              Pause
                            </>
                          ) : (
                            <>
                              <Play className="mr-2 h-4 w-4" />
                              Activate
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => onDelete(agent)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

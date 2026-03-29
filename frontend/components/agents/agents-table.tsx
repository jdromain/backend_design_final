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
  BookOpen,
  Plug,
} from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

export interface Agent {
  id: string
  name: string
  description: string
  version: number
  status: "active" | "paused" | "draft"
  agentType: "booking" | "support" | "sales" | "custom"
  callsToday: number
  handledRate: number
  escalationRate: number
  failureRate: number
  toolErrorRate: number
  phoneLines: string[]
  knowledgeBase: { status: "connected" | "processing" | "missing" | "error"; name?: string }
  integrations: { name: string; status: "healthy" | "warning" | "error" }[]
  updatedAt: string
  createdAt: string
}

interface AgentsTableProps {
  agents: Agent[]
  isLoading?: boolean
  onRowClick: (agent: Agent) => void
  onManage: (agent: Agent) => void
  onTest: (agent: Agent) => void
  onToggleStatus: (agent: Agent) => void
  onDuplicate: (agent: Agent) => void
  onVersionHistory: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}

export function AgentsTable({
  agents,
  isLoading,
  onRowClick,
  onManage,
  onTest,
  onToggleStatus,
  onDuplicate,
  onVersionHistory,
  onDelete,
}: AgentsTableProps) {
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

  const getKbStatusIcon = (kb?: Agent["knowledgeBase"]) => {
    if (!kb) return <XCircle className="h-4 w-4 text-muted-foreground" />
    switch (kb.status) {
      case "connected":
        return <CheckCircle className="h-4 w-4 text-emerald-500" />
      case "processing":
        return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
      case "missing":
        return <XCircle className="h-4 w-4 text-red-500" />
    }
  }

  const hasIntegrationIssues = (integrations: Agent["integrations"]) => {
    return integrations.some((i) => i.status !== "healthy")
  }

  const getIntegrationsIcon = (integrations: Agent["integrations"]) => {
    if (integrations.length === 0) return <XCircle className="h-4 w-4 text-muted-foreground" />
    if (integrations.some((i) => i.status === "error")) {
      return <XCircle className="h-4 w-4 text-red-500" />
    }
    if (integrations.some((i) => i.status === "warning")) {
      return <AlertTriangle className="h-4 w-4 text-amber-500" />
    }
    return <CheckCircle className="h-4 w-4 text-emerald-500" />
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (agents.length === 0) {
    return null
  }

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[250px]">Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Phone Line(s)</TableHead>
              <TableHead>Dependencies</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="hidden xl:table-cell">Performance</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => {
              const needsAttention =
                agent.knowledgeBase?.status === "missing" ||
                agent.knowledgeBase?.status === "processing" ||
                hasIntegrationIssues(agent.integrations) ||
                agent.phoneLines.length === 0 ||
                agent.failureRate > 5

              return (
                <TableRow key={agent.id} className="cursor-pointer" onClick={() => onRowClick(agent)}>
                  {/* Agent Name + Version */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{agent.name}</span>
                          <Badge variant="outline" className="text-xs">
                            v{agent.version}
                          </Badge>
                          {agent.status === "draft" && (
                            <Badge variant="secondary" className="text-xs">
                              Draft
                            </Badge>
                          )}
                        </div>
                      </div>
                      {needsAttention && (
                        <Tooltip>
                          <TooltipTrigger>
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>Needs attention</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>

                  {/* Status */}
                  <TableCell>{getStatusBadge(agent.status)}</TableCell>

                  {/* Phone Lines */}
                  <TableCell>
                    {agent.phoneLines.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-sm">{agent.phoneLines[0]}</span>
                        {agent.phoneLines.length > 1 && (
                          <Badge variant="outline" className="text-xs">
                            +{agent.phoneLines.length - 1}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Not assigned</span>
                    )}
                  </TableCell>

                  {/* Dependencies */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1">
                          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                          {getKbStatusIcon(agent.knowledgeBase)}
                        </TooltipTrigger>
                        <TooltipContent>
                          KB: {agent.knowledgeBase?.name || agent.knowledgeBase?.status || "Not configured"}
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger className="flex items-center gap-1">
                          <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                          {getIntegrationsIcon(agent.integrations)}
                        </TooltipTrigger>
                        <TooltipContent>
                          {agent.integrations.length} integration{agent.integrations.length !== 1 ? "s" : ""}
                          {hasIntegrationIssues(agent.integrations) && " (issues detected)"}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>

                  {/* Updated */}
                  <TableCell className="text-sm text-muted-foreground">
                    {agent.updatedAt
                      ? formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })
                      : "—"}
                  </TableCell>

                  {/* Performance - Hidden on smaller screens */}
                  <TableCell className="hidden xl:table-cell">
                    <span className="text-sm text-muted-foreground">
                      Calls {agent.callsToday} · Handled {agent.handledRate}% · Esc {agent.escalationRate}% · Fail{" "}
                      <span className={agent.failureRate > 5 ? "text-red-500" : ""}>{agent.failureRate}%</span>
                    </span>
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
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
                          <DropdownMenuItem onClick={() => onTest(agent)}>
                            <Play className="mr-2 h-4 w-4" />
                            Test
                          </DropdownMenuItem>
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
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}

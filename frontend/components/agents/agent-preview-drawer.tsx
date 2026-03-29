"use client"

import { formatDistanceToNow } from "date-fns"
import {
  Phone,
  BookOpen,
  Plug,
  Play,
  Pause,
  Settings,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { Agent } from "./agents-table"

interface AgentPreviewDrawerProps {
  agent: Agent | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onManage: (agent: Agent) => void
  onTest: (agent: Agent) => void
  onToggleStatus: (agent: Agent) => void
}

export function AgentPreviewDrawer({
  agent,
  open,
  onOpenChange,
  onManage,
  onTest,
  onToggleStatus,
}: AgentPreviewDrawerProps) {
  if (!agent) return null

  const getKbStatusIcon = () => {
    switch (agent.knowledgeBase?.status) {
      case "connected":
        return <CheckCircle className="h-4 w-4 text-emerald-500" />
      case "processing":
        return <Loader2 className="h-4 w-4 text-amber-500 animate-spin" />
      case "missing":
        return <XCircle className="h-4 w-4 text-red-500" />
      default:
        return <XCircle className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getIntegrationStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
      case "warning":
        return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />
      default:
        return null
    }
  }

  const hasIssues =
    agent.knowledgeBase?.status === "missing" ||
    agent.knowledgeBase?.status === "processing" ||
    agent.integrations.some((i) => i.status !== "healthy") ||
    agent.phoneLines.length === 0 ||
    agent.failureRate > 5

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[450px]">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">{agent.name}</SheetTitle>
            <Badge variant="outline" className="text-xs">
              v{agent.version}
            </Badge>
            <Badge
              variant={agent.status === "active" ? "default" : agent.status === "paused" ? "secondary" : "outline"}
              className="capitalize"
            >
              {agent.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{agent.description}</p>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Quick Actions */}
          <div className="flex gap-2">
            <Button onClick={() => onManage(agent)} className="flex-1">
              <Settings className="mr-2 h-4 w-4" />
              Manage
            </Button>
            <Button variant="outline" onClick={() => onTest(agent)}>
              <Play className="mr-2 h-4 w-4" />
              Test
            </Button>
            <Button variant="outline" onClick={() => onToggleStatus(agent)}>
              {agent.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          </div>

          <Separator />

          {/* Performance Metrics */}
          <div>
            <h4 className="text-sm font-medium mb-3">Performance (Today)</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold">{agent.callsToday}</p>
                <p className="text-xs text-muted-foreground">Calls</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold">{agent.handledRate}%</p>
                <p className="text-xs text-muted-foreground">Handled Rate</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-2xl font-semibold">{agent.escalationRate}%</p>
                <p className="text-xs text-muted-foreground">Escalation Rate</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className={`text-2xl font-semibold ${agent.failureRate > 5 ? "text-red-500" : ""}`}>
                  {agent.failureRate}%
                </p>
                <p className="text-xs text-muted-foreground">Failure Rate</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Dependencies */}
          <div>
            <h4 className="text-sm font-medium mb-3">Dependencies</h4>
            <div className="space-y-3">
              {/* Phone Lines */}
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Phone Lines</p>
                  {agent.phoneLines.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {agent.phoneLines.map((line) => (
                        <Badge key={line} variant="outline" className="text-xs font-mono">
                          {line}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-amber-500 flex items-center gap-1 mt-1">
                      <AlertTriangle className="h-3 w-3" />
                      Not assigned
                    </p>
                  )}
                </div>
              </div>

              {/* Knowledge Base */}
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Knowledge Base</p>
                  <div className="flex items-center gap-2 mt-1">
                    {getKbStatusIcon()}
                    <span className="text-xs text-muted-foreground">
                      {agent.knowledgeBase?.name || agent.knowledgeBase?.status || "Not configured"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Integrations */}
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Plug className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Integrations</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {agent.integrations.map((integration) => (
                      <div key={integration.name} className="flex items-center gap-1.5 text-xs">
                        {getIntegrationStatusIcon(integration.status)}
                        <span>{integration.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {hasIssues && (
            <>
              <Separator />
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2 text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">Needs Attention</span>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {agent.phoneLines.length === 0 && <li>• No phone lines assigned</li>}
                  {agent.knowledgeBase?.status === "missing" && <li>• Knowledge base not configured</li>}
                  {agent.knowledgeBase?.status === "processing" && <li>• Knowledge base still processing</li>}
                  {agent.integrations.some((i) => i.status === "error") && <li>• Integration errors detected</li>}
                  {agent.failureRate > 5 && <li>• High failure rate ({agent.failureRate}%)</li>}
                </ul>
              </div>
            </>
          )}

          <Separator />

          {/* Metadata */}
          <div className="text-xs text-muted-foreground">
            <p>
              Updated{" "}
              {agent.updatedAt
                ? formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })
                : "—"}
            </p>
            <p>
              Created{" "}
              {agent.createdAt
                ? formatDistanceToNow(new Date(agent.createdAt), { addSuffix: true })
                : "—"}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

"use client"

import { useState, useEffect, useMemo } from "react"
import {
  ArrowLeft,
  Play,
  Pause,
  Settings,
  History,
  BookOpen,
  BarChart3,
  Activity,
  Save,
  X,
  Copy,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { KpiTile } from "@/components/dashboard/kpi-tile"
import { TableSkeleton, KpiRowSkeleton } from "@/components/loading-skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { toast } from "@/hooks/use-toast"
import { Phone, CheckCircle, Clock, Users } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { type AgentDetailApi, getAgentDetail, updateAgentDetail } from "@/lib/data/agents"
import { getAgentPerformance } from "@/lib/data/analytics"
import { getKnowledgeWorkspace } from "@/lib/data/knowledge"

interface AgentConfig {
  name: string
  description: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  voice: string
  silenceTimeout: number
  interruptionSensitivity: number
  kbNamespace: string
  version?: number
}

interface KBCollection {
  id: string
  name: string
  documentCount: number
  status: "connected" | "syncing" | "error"
}

interface ActivityLog {
  id: string
  action: string
  user: string
  timestamp: string
  details?: string
}

interface AgentDetailPageProps {
  agentId: string
  onBack: () => void
}

const emptyConfig = (): AgentConfig => ({
  name: "",
  description: "",
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: 1024,
  voice: "alloy",
  silenceTimeout: 5,
  interruptionSensitivity: 0.5,
  kbNamespace: "",
  version: 1,
})

export function AgentDetailPage({ agentId, onBack }: AgentDetailPageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [activeTab, setActiveTab] = useState("overview")
  const [config, setConfig] = useState<AgentConfig>(emptyConfig)
  const [originalConfig, setOriginalConfig] = useState<AgentConfig>(emptyConfig)
  const [toolAccess, setToolAccess] = useState<string[]>([])
  const [agentDetail, setAgentDetail] = useState<AgentDetailApi | null>(null)
  const [collections, setCollections] = useState<KBCollection[]>([])
  const [availableCollections, setAvailableCollections] = useState<KBCollection[]>([])
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([])
  const [recentCalls, setRecentCalls] = useState<
    { id: string; caller: string; duration: string; outcome: string; timestamp: string }[]
  >([])
  const [perf, setPerf] = useState<{
    totalCalls: number
    handledRate: number
    escalationRate: number
    avgDuration: number
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    Promise.all([getAgentDetail(agentId), getAgentPerformance().catch(() => null), getKnowledgeWorkspace().catch(() => null)])
      .then(([detail, performance, knowledge]) => {
        if (cancelled) return
        const next: AgentConfig = {
          name: detail.name,
          description: detail.description,
          systemPrompt: detail.systemPrompt,
          temperature: detail.temperature,
          maxTokens: detail.maxTokens,
          voice: detail.voice,
          silenceTimeout: detail.silenceTimeout,
          interruptionSensitivity: detail.interruptionSensitivity,
          kbNamespace: detail.kbNamespace ?? "",
          version: detail.version,
        }
        setConfig(next)
        setOriginalConfig(next)
        setToolAccess(detail.toolAccess)
        setAgentDetail(detail)
        const available = (knowledge?.collections ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          documentCount: c.docsCount,
          status: "connected" as const,
        }))
        setAvailableCollections(available)
        setCollections(
          detail.kbNamespace
            ? [{
                id: detail.kbNamespace,
                name: detail.kbNamespace,
                documentCount: available.find((c) => c.name === detail.kbNamespace)?.documentCount ?? 0,
                status: "connected" as const,
              }]
            : [],
        )
        setActivityLog([])
        setRecentCalls([])
        if (performance) {
          setPerf({
            totalCalls: performance.totalCalls,
            handledRate: performance.handledRate,
            escalationRate: performance.escalationRate,
            avgDuration: performance.avgDuration,
          })
        } else {
          setPerf(null)
        }
      })
      .catch(() => {
        toast({ title: "Failed to load agent", description: "Check your connection and try again." })
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [agentId])

  useEffect(() => {
    setHasUnsavedChanges(JSON.stringify(config) !== JSON.stringify(originalConfig))
  }, [config, originalConfig])

  const configurationJson = useMemo<AgentDetailApi>(
    () => ({
      id: agentDetail?.id ?? agentId,
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      voice: config.voice,
      silenceTimeout: config.silenceTimeout,
      interruptionSensitivity: config.interruptionSensitivity,
      version: config.version ?? 1,
      persona: agentDetail?.persona ?? "support",
      toolAccess,
      phoneNumbers: agentDetail?.phoneNumbers ?? [],
      kbNamespace: config.kbNamespace,
      status: agentDetail?.status ?? "draft",
      agentType: agentDetail?.agentType ?? "custom",
    }),
    [agentDetail, agentId, config, toolAccess],
  )

  const handleSave = async () => {
    try {
      const updated = await updateAgentDetail(agentId, {
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        voice: config.voice,
        silenceTimeout: config.silenceTimeout,
        interruptionSensitivity: config.interruptionSensitivity,
        kbNamespace: config.kbNamespace,
        toolAccess,
      })

      const next: AgentConfig = {
        name: updated.name,
        description: updated.description,
        systemPrompt: updated.systemPrompt,
        temperature: updated.temperature,
        maxTokens: updated.maxTokens,
        voice: updated.voice,
        silenceTimeout: updated.silenceTimeout,
        interruptionSensitivity: updated.interruptionSensitivity,
        kbNamespace: updated.kbNamespace ?? "",
        version: updated.version,
      }
      setConfig(next)
      setOriginalConfig(next)
      setToolAccess(updated.toolAccess)
      setAgentDetail(updated)
      setCollections(
        updated.kbNamespace
          ? [{
              id: updated.kbNamespace,
              name: updated.kbNamespace,
              documentCount: availableCollections.find((c) => c.name === updated.kbNamespace)?.documentCount ?? 0,
              status: "connected" as const,
            }]
          : [],
      )
      setHasUnsavedChanges(false)
      toast({ title: "Changes Saved", description: "Agent configuration has been updated" })
    } catch {
      toast({ title: "Save failed", description: "Could not update agent configuration." })
    }
  }

  const handleDiscard = () => {
    setConfig(originalConfig)
    setCollections(
      originalConfig.kbNamespace
        ? [{
            id: originalConfig.kbNamespace,
            name: originalConfig.kbNamespace,
            documentCount: availableCollections.find((c) => c.name === originalConfig.kbNamespace)?.documentCount ?? 0,
            status: "connected" as const,
          }]
        : [],
    )
    setHasUnsavedChanges(false)
    setDiscardConfirmOpen(false)
  }

  const handleToggleStatus = () => {
    setIsPaused(!isPaused)
    toast({
      title: isPaused ? "Agent Activated" : "Agent Paused",
      description: isPaused ? "Agent is now handling calls" : "Agent will not receive new calls",
    })
  }

  const outcomeColor = (outcome: string) => {
    switch (outcome) {
      case "resolved":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
      case "escalated":
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      case "failed":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <KpiRowSkeleton count={4} />
        <TableSkeleton rows={5} columns={4} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{config.name}</h1>
              <Badge variant="outline">v{config.version ?? 1}</Badge>
              <Badge className={isPaused ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}>
                {isPaused ? "Paused" : "Active"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleToggleStatus}>
            {isPaused ? <Play className="h-4 w-4 mr-2" /> : <Pause className="h-4 w-4 mr-2" />}
            {isPaused ? "Activate" : "Pause"}
          </Button>
        </div>
      </div>

      {/* Unsaved changes bar */}
      {hasUnsavedChanges && (
        <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm text-amber-700 dark:text-amber-400">You have unsaved changes</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDiscardConfirmOpen(true)}>
              <X className="h-4 w-4 mr-1" />
              Discard
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="h-4 w-4 mr-1" />
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <BarChart3 className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="configuration">
            <Settings className="h-4 w-4 mr-2" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <BookOpen className="h-4 w-4 mr-2" />
            Knowledge
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity className="h-4 w-4 mr-2" />
            Activity
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* KPIs */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile title="Calls Today" value={perf?.totalCalls ?? 0} change={0} icon={Phone} color="default" />
            <KpiTile
              title="Handled Rate"
              value={`${(perf?.handledRate ?? 0).toFixed(1)}%`}
              change={0}
              icon={CheckCircle}
              color="success"
            />
            <KpiTile
              title="Escalation Rate"
              value={`${(perf?.escalationRate ?? 0).toFixed(1)}%`}
              change={0}
              icon={Users}
              color="warning"
            />
            <KpiTile
              title="Avg Duration"
              value={`${(perf?.avgDuration ?? 0).toFixed(1)}s`}
              icon={Clock}
              color="info"
            />
          </div>

          {/* Recent Calls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Calls</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Caller</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentCalls.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No recent calls yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentCalls.map((call) => (
                      <TableRow key={call.id} className="cursor-pointer hover:bg-muted/50">
                        <TableCell className="font-mono">{call.caller}</TableCell>
                        <TableCell>{call.duration}</TableCell>
                        <TableCell>
                          <Badge className={outcomeColor(call.outcome)}>{call.outcome}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{call.timestamp}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="configuration" className="space-y-6 mt-6">
          {/* JSON Preview */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Configuration JSON</CardTitle>
                  <CardDescription>Reflects the current agent payload shape from `/agents/:id`.</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(configurationJson, null, 2))
                    toast({ title: "Copied", description: "Configuration copied to clipboard" })
                  }}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <pre className="p-4 bg-muted rounded-lg text-xs font-mono overflow-auto max-h-[200px]">
                {JSON.stringify(configurationJson, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Knowledge Tab */}
        <TabsContent value="knowledge" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Knowledge Base Collections</CardTitle>
              <CardDescription>Documents and data sources available to this agent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {collections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No knowledge collections configured yet.</p>
                ) : (
                  collections.map((collection) => (
                    <div key={collection.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <BookOpen className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{collection.name}</p>
                          <p className="text-sm text-muted-foreground">{collection.documentCount} documents</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            collection.status === "connected"
                              ? "secondary"
                              : collection.status === "syncing"
                                ? "outline"
                                : "destructive"
                          }
                        >
                          {collection.status}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setConfig({ ...config, kbNamespace: "" })
                            setCollections([])
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={config.kbNamespace}
                  onChange={(e) => {
                    const ns = e.target.value
                    setConfig({ ...config, kbNamespace: ns })
                    setCollections(
                      ns
                        ? [{
                            id: ns,
                            name: ns,
                            documentCount: availableCollections.find((c) => c.name === ns)?.documentCount ?? 0,
                            status: "connected" as const,
                          }]
                        : [],
                    )
                  }}
                >
                  <option value="">No collection</option>
                  {availableCollections.map((collection) => (
                    <option key={collection.id} value={collection.name}>
                      {collection.name} ({collection.documentCount} docs)
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>Recent changes and events for this agent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activityLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
                ) : (
                  activityLog.map((log) => (
                    <div key={log.id} className="flex items-start gap-4 pb-4 border-b last:border-0">
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                        <History className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{log.action}</p>
                        {log.details && <p className="text-sm text-muted-foreground">{log.details}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          {log.user} • {new Date(log.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title="Discard changes?"
        description="You have unsaved changes. Are you sure you want to discard them?"
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={handleDiscard}
      />
    </div>
  )
}

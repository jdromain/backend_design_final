"use client"

import { useState, useMemo, useEffect } from "react"
import { Plus, Bot } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AgentsToolbar, type TabValue, type SortValue, type ViewMode } from "@/components/agents/agents-toolbar"
import { AgentsTable, type Agent } from "@/components/agents/agents-table"
import { AgentPreviewDrawer } from "@/components/agents/agent-preview-drawer"
import { TestAgentModal } from "@/components/agents/test-agent-modal"
import { VersionHistoryDrawer } from "@/components/agents/version-history-drawer"
import { CreateAgentWizard } from "@/components/agents/create-agent-wizard"
import { useToast } from "@/hooks/use-toast"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { listAgents } from "@/lib/data/agents"

function agentNeedsAttention(agent: Agent): boolean {
  return (
    agent.knowledgeBase?.status === "missing" ||
    agent.knowledgeBase?.status === "processing" ||
    agent.integrations.some((i) => i.status !== "healthy") ||
    agent.phoneLines.length === 0 ||
    agent.failureRate > 5
  )
}

interface AgentsPageProps {
  onNavigateToAgent?: (agentId: string) => void
}

export function AgentsPage({ onNavigateToAgent }: AgentsPageProps) {
  const { toast } = useToast()
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows)
      })
      .catch(() => {
        if (!cancelled) setAgents([])
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Single agent MVP: Redirect to first agent's detail page immediately if only one agent
  const shouldRedirect = !agentsLoading && agents.length === 1 && onNavigateToAgent
  useEffect(() => {
    if (shouldRedirect) {
      onNavigateToAgent(agents[0].id)
    }
  }, [shouldRedirect, agents, onNavigateToAgent])
  // Single agent MVP: Simplified state - remove complex filters
  const [searchQuery, setSearchQuery] = useState("")
  const [tab, setTab] = useState<TabValue>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [phoneLineFilter, setPhoneLineFilter] = useState<string>("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false)
  const [sortBy, setSortBy] = useState<SortValue>("recently_updated")
  const [viewMode, setViewMode] = useState<ViewMode>("table")

  const [previewAgent, setPreviewAgent] = useState<Agent | null>(null)
  const [testModalAgent, setTestModalAgent] = useState<Agent | null>(null)
  const [versionHistoryAgent, setVersionHistoryAgent] = useState<Agent | null>(null)
  const [createWizardOpen, setCreateWizardOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null)

  const uniquePhoneLines = useMemo(
    () => Array.from(new Set(agents.flatMap((a) => a.phoneLines))),
    [agents],
  )

  const filteredAgents = useMemo(() => {
    let result = [...agents]

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(query) ||
          agent.description.toLowerCase().includes(query) ||
          agent.agentType.toLowerCase().includes(query) ||
          agent.phoneLines.some((line) => line.includes(query)),
      )
    }

    // Tab filter
    if (tab !== "all") {
      result = result.filter((a) => a.status === tab)
    }

    // Status filter
    if (statusFilter !== "all") {
      result = result.filter((a) => a.status === statusFilter)
    }

    // Phone line filter
    if (phoneLineFilter !== "all") {
      result = result.filter((a) => a.phoneLines.includes(phoneLineFilter))
    }

    // Type filter
    if (typeFilter !== "all") {
      result = result.filter((a) => a.agentType === typeFilter)
    }

    // Needs attention filter
    if (needsAttentionOnly) {
      result = result.filter(agentNeedsAttention)
    }

    // Sort
    switch (sortBy) {
      case "recently_updated":
        result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        break
      case "most_calls":
        result.sort((a, b) => b.callsToday - a.callsToday)
        break
      case "highest_failure":
        result.sort((a, b) => b.failureRate - a.failureRate)
        break
    }

    return result
  }, [agents, searchQuery, tab, statusFilter, phoneLineFilter, typeFilter, needsAttentionOnly, sortBy])

  const handleManage = (agent: Agent) => {
    if (onNavigateToAgent) {
      onNavigateToAgent(agent.id)
    } else {
      setPreviewAgent(agent)
    }
  }

  const handleTest = (agent: Agent) => {
    setTestModalAgent(agent)
  }

  const handleToggleStatus = (agent: Agent) => {
    setAgents((prev) =>
      prev.map((a) => (a.id === agent.id ? { ...a, status: a.status === "active" ? "paused" : "active" } : a)),
    )
    toast({
      title: agent.status === "active" ? "Agent paused" : "Agent activated",
      description: `${agent.name} has been ${agent.status === "active" ? "paused" : "activated"}.`,
    })
  }

  const handleDuplicate = (agent: Agent) => {
    const newAgent: Agent = {
      ...agent,
      id: `agent_${Date.now()}`,
      name: `${agent.name} (Copy)`,
      version: 1,
      status: "draft",
      callsToday: 0,
      phoneLines: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setAgents((prev) => [...prev, newAgent])
    toast({
      title: "Agent duplicated",
      description: `${newAgent.name} has been created as a draft.`,
    })
  }

  const handleVersionHistory = (agent: Agent) => {
    setVersionHistoryAgent(agent)
  }

  const handleDeleteClick = (agent: Agent) => {
    setAgentToDelete(agent)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = () => {
    if (!agentToDelete) return
    setAgents((prev) => prev.filter((a) => a.id !== agentToDelete.id))
    if (previewAgent?.id === agentToDelete.id) {
      setPreviewAgent(null)
    }
    toast({
      title: "Agent deleted",
      description: `${agentToDelete.name} has been deleted.`,
    })
    setDeleteDialogOpen(false)
    setAgentToDelete(null)
  }

  const handleCreateAgent = (agentData: Partial<Agent>) => {
    const newAgent = agentData as Agent
    setAgents((prev) => [newAgent, ...prev])
    toast({
      title: "Agent created",
      description: `${newAgent.name} has been created.`,
    })
    if (onNavigateToAgent) {
      onNavigateToAgent(newAgent.id)
    } else {
      setPreviewAgent(newAgent)
    }
  }

  const needsAttentionCount = agents.filter(agentNeedsAttention).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent</h1>
          <p className="text-sm text-muted-foreground">Manage and configure your voice AI agent</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => setCreateWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Agent
          </Button>
        </div>
      </div>

      {/* Toolbar - Simplified for single agent MVP */}
      {/* Hide complex filters for MVP, but keep structure for future expansion */}
      {agents.length > 1 && (
        <AgentsToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          tab={tab}
          onTabChange={setTab}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          phoneLineFilter={phoneLineFilter}
          onPhoneLineFilterChange={setPhoneLineFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          needsAttentionOnly={needsAttentionOnly}
          onNeedsAttentionChange={setNeedsAttentionOnly}
          needsAttentionCount={needsAttentionCount}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          phoneLines={uniquePhoneLines}
        />
      )}

      {/* Content: Table or Cards */}
      {agentsLoading ? (
        <AgentsTable
          agents={[]}
          isLoading
          onRowClick={() => undefined}
          onManage={() => undefined}
          onTest={() => undefined}
          onToggleStatus={() => undefined}
          onDuplicate={() => undefined}
          onVersionHistory={() => undefined}
          onDelete={() => undefined}
        />
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Bot className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 text-lg font-medium">No agent configured</h3>
          <p className="mt-1 text-sm text-muted-foreground">Create your AI agent to start handling calls</p>
          <Button className="mt-4" onClick={() => setCreateWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Agent
          </Button>
        </div>
      ) : filteredAgents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No agent found</p>
        </div>
      ) : (
        <AgentsTable
          agents={filteredAgents}
          isLoading={false}
          onRowClick={setPreviewAgent}
          onManage={handleManage}
          onTest={handleTest}
          onToggleStatus={handleToggleStatus}
          onDuplicate={handleDuplicate}
          onVersionHistory={handleVersionHistory}
          onDelete={handleDeleteClick}
        />
      )}

      {/* Agent Preview Drawer */}
      <AgentPreviewDrawer
        agent={previewAgent}
        open={!!previewAgent}
        onOpenChange={(open) => !open && setPreviewAgent(null)}
        onManage={handleManage}
        onTest={handleTest}
        onToggleStatus={handleToggleStatus}
      />

      {/* Test Agent Modal */}
      <TestAgentModal
        agent={testModalAgent}
        open={!!testModalAgent}
        onOpenChange={(open) => !open && setTestModalAgent(null)}
      />

      {/* Version History Drawer */}
      <VersionHistoryDrawer
        agent={versionHistoryAgent}
        open={!!versionHistoryAgent}
        onOpenChange={(open) => !open && setVersionHistoryAgent(null)}
      />

      {/* Create Agent Wizard */}
      <CreateAgentWizard
        open={createWizardOpen}
        onOpenChange={setCreateWizardOpen}
        existingAgents={agents}
        onCreateAgent={handleCreateAgent}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Agent"
        description={`Are you sure you want to delete "${agentToDelete?.name}"? This action cannot be undone and will stop all active calls using this agent.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}

"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { LayoutGrid, List, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LiveCallsHeader } from "@/components/live-calls/live-calls-header"
import { CapacityStrip, type SystemStatusType } from "@/components/live-calls/capacity-strip"
import { LiveCallsTabs, type LiveCallTab } from "@/components/live-calls/live-calls-tabs"
import { LiveCallsTable } from "@/components/live-calls/live-calls-table"
import { CallInspectorDrawer } from "@/components/live-calls/call-inspector-drawer"
import type { LiveCall } from "@/types/api"
import { HandoffModal } from "@/components/live-calls/handoff-modal"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { TableSkeleton } from "@/components/loading-skeleton"
import { toast } from "@/hooks/use-toast"
import { Card, CardContent } from "@/components/ui/card"
import { ErrorBoundary } from "@/components/error-boundary"
import { CreateFollowUpModal } from "@/components/actions/create-follow-up-modal"
import type { Contact } from "@/lib/actions-store"
import { useAppNavigate } from "@/hooks/use-app-navigate"

import {
  endLiveCall,
  flagLiveCall,
  getLiveCalls,
  handoffLiveCall,
  saveLiveCallNote,
  saveLiveCallTags,
} from "@/lib/data/live-calls"
import { createFollowUpFromCall } from "@/lib/data/call-history"

export function LiveCallsPage() {
  const handleNavigate = useAppNavigate()
  const [calls, setCalls] = useState<LiveCall[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [activeTab, setActiveTab] = useState<LiveCallTab>("all")
  const [selectedCall, setSelectedCall] = useState<LiveCall | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("liveCalls_viewMode") as "table" | "cards") || "table"
    }
    return "table"
  })
  const [handoffModalOpen, setHandoffModalOpen] = useState(false)
  const [handoffCallId, setHandoffCallId] = useState<string | null>(null)
  const [endCallConfirm, setEndCallConfirm] = useState<{ open: boolean; callId: string | null }>({
    open: false,
    callId: null,
  })
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({})
  const [createActionModalOpen, setCreateActionModalOpen] = useState(false)
  const [callForAction, setCallForAction] = useState<LiveCall | null>(null)

  const refreshCalls = useCallback(
    async (opts?: { withSpinner?: boolean; includeStale?: boolean }) => {
      if (opts?.withSpinner) setIsLoading(true)
      try {
        const data = await getLiveCalls({ includeStale: opts?.includeStale ?? false })
        setCalls(data)
        setLastUpdated(new Date())
      } catch (error) {
        console.error("Failed to load live calls:", error)
        toast({
          title: "Error",
          description: "Failed to load live calls. Please try again.",
          variant: "destructive",
        })
      } finally {
        if (opts?.withSpinner) setIsLoading(false)
      }
    },
    [],
  )

  // Initial load
  useEffect(() => {
    void refreshCalls({ withSpinner: true })
  }, [refreshCalls])

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && !drawerOpen) {
      const interval = setInterval(async () => {
        await refreshCalls()
      }, 10000)
      return () => clearInterval(interval)
    }
  }, [autoRefresh, drawerOpen, refreshCalls])

  // Update durations every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCalls((prev) =>
        prev.map((call) => ({
          ...call,
          durationSeconds: Math.floor((Date.now() - new Date(call.startedAt).getTime()) / 1000),
        })),
      )
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const handleViewModeChange = useCallback((mode: "table" | "cards") => {
    setViewMode(mode)
    if (typeof window !== "undefined") {
      localStorage.setItem("liveCalls_viewMode", mode)
    }
  }, [])

  const handleRefreshNow = useCallback(async () => {
    await refreshCalls({ withSpinner: true })
    toast({ title: "Refreshed", description: "Live calls data updated" })
  }, [refreshCalls])

  const handleCallClick = useCallback((call: LiveCall) => {
    setSelectedCall(call)
    setDrawerOpen(true)
  }, [])

  const handleDrawerClose = useCallback((open: boolean) => {
    setDrawerOpen(open)
    if (!open) {
      // Clear selected call when drawer closes to ensure fresh data on reopen
      setSelectedCall(null)
    }
  }, [])

  const handleEndCallRequest = useCallback((callId: string) => {
    setEndCallConfirm({ open: true, callId })
  }, [])

  const handleEndCallConfirm = useCallback(async () => {
    if (!endCallConfirm.callId) return

    const callId = endCallConfirm.callId
    setLoadingActions((prev: Record<string, boolean>) => ({ ...prev, [`endCall-${callId}`]: true }))

    try {
      await endLiveCall(callId)
      await refreshCalls()
      setDrawerOpen(false)
      setSelectedCall(null)
      toast({
        title: "Call Ended",
        description: `Call ${callId} has been terminated.`,
      })
      setEndCallConfirm({ open: false, callId: null })
    } catch {
      toast({
        title: "Error",
        description: "Failed to end call. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoadingActions((prev: Record<string, boolean>) => {
        const next = { ...prev }
        delete next[`endCall-${callId}`]
        return next
      })
    }
  }, [endCallConfirm.callId, refreshCalls])

  const handleTransfer = useCallback((callId: string) => {
    setHandoffCallId(callId)
    setHandoffModalOpen(true)
  }, [])

  const handleHandoffConfirm = useCallback(
    async (target: string, createAction: boolean) => {
      if (!handoffCallId) return

      const callId = handoffCallId
      setLoadingActions((prev: Record<string, boolean>) => ({ ...prev, [`transfer-${callId}`]: true }))

      try {
        await handoffLiveCall(callId, { target, createFollowUp: createAction })
        await refreshCalls()

        toast({
          title: "Handoff Requested",
          description: `Call handoff requested to ${target}.`,
        })

        setHandoffCallId(null)
        setHandoffModalOpen(false)
      } catch {
        toast({
          title: "Error",
          description: "Failed to request handoff. Please try again.",
          variant: "destructive",
        })
      } finally {
        setLoadingActions((prev: Record<string, boolean>) => {
          const next = { ...prev }
          delete next[`transfer-${callId}`]
          return next
        })
      }
    },
    [handoffCallId, refreshCalls],
  )

  // Helper function to convert LiveCall to Contact
  const callToContact = useCallback((call: LiveCall): Contact => {
    return {
      id: `contact-${call.callId}`,
      phone: call.callerNumber,
      name: undefined, // Name not available from call data
      email: undefined,
      tags: call.tags || [],
      smsOptOut: false,
      lastContactedAt: call.startedAt,
    }
  }, [])

  const handleCreateAction = useCallback((callId: string) => {
    const call = calls.find((c) => c.callId === callId)
    if (call) {
      setCallForAction(call)
      setCreateActionModalOpen(true)
    }
  }, [calls])

  const handleActionSubmit = useCallback(
    async (data: {
      contactId: string
      type: string
      priority: number
      dueAt: string
      notes: string
      ownerId?: string
    }) => {
      if (!callForAction) return
      await createFollowUpFromCall({
        callId: callForAction.callId,
        contactId: data.contactId,
        type: data.type,
        priority: data.priority,
        dueAt: data.dueAt,
        notes: data.notes,
        ownerId: data.ownerId,
      })
      toast({
        title: "Action Created",
        description: `Follow-up action created for call ${callForAction?.callId}. ${data.type} follow-up scheduled.`,
      })

      // Close modal and clear call context
      setCreateActionModalOpen(false)
      setCallForAction(null)
    },
    [callForAction],
  )

  // Create contacts list for modal (convert call to contact if available)
  const contactsForModal = useMemo(() => {
    if (callForAction) {
      return [callToContact(callForAction)]
    }
    return []
  }, [callForAction, callToContact])

  const handleSaveNote = useCallback(async (callId: string, note: string) => {
    if (!note.trim()) return
    try {
      await saveLiveCallNote(callId, note.trim())
      toast({
        title: "Note saved",
        description: "Internal note has been saved",
      })
    } catch {
      toast({
        title: "Note save failed",
        description: "Could not save this note.",
        variant: "destructive",
      })
    }
  }, [])

  const handleSaveTags = useCallback(async (callId: string, tags: string[]) => {
    try {
      await saveLiveCallTags(callId, tags)
      setCalls((prev: LiveCall[]) =>
        prev.map((c) => (c.callId === callId ? { ...c, tags } : c)),
      )
      // Update selected call if it's the one being tagged
      if (selectedCall?.callId === callId) {
        setSelectedCall((prev: LiveCall | null) => (prev ? { ...prev, tags } : null))
      }
      toast({
        title: "Tags updated",
        description: "Call tags have been updated",
      })
    } catch {
      toast({
        title: "Tag update failed",
        description: "Could not update tags for this call.",
        variant: "destructive",
      })
    }
  }, [selectedCall])

  const handleTagCall = useCallback(async (callId: string, tag: string) => {
    const call = calls.find((c) => c.callId === callId)
    if (!call) return
    const tags = call.tags.includes(tag) ? call.tags : [...call.tags, tag]
    await handleSaveTags(callId, tags)
  }, [calls, handleSaveTags])

  const handleFlagForReview = useCallback(async (callId: string) => {
    const call = calls.find((c) => c.callId === callId)
    if (!call) return

    setLoadingActions((prev: Record<string, boolean>) => ({ ...prev, [`flag-${callId}`]: true }))

    try {
      await flagLiveCall(callId, "manual_review")

      setCalls((prev: LiveCall[]) =>
        prev.map((c) =>
          c.callId === callId
            ? {
                ...c,
                tags: c.tags.includes("flagged") ? c.tags : [...c.tags, "flagged"],
              }
            : c,
        ),
      )
      // Update selected call if it's the one being flagged
      if (selectedCall?.callId === callId) {
        setSelectedCall((prev: LiveCall | null) =>
          prev
            ? {
                ...prev,
                tags: prev.tags.includes("flagged") ? prev.tags : [...prev.tags, "flagged"],
              }
            : null,
        )
      }
      toast({
        title: "Call Flagged",
        description: "This call has been flagged for review.",
      })
    } catch {
      toast({
        title: "Error",
        description: "Failed to flag call. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoadingActions((prev: Record<string, boolean>) => {
        const next = { ...prev }
        delete next[`flag-${callId}`]
        return next
      })
    }
  }, [calls, selectedCall])

  // Filter calls based on tab and search
  const filteredCalls = useMemo(() => {
    let result = calls

    // Tab filter
    if (activeTab !== "all") {
      result = result.filter((call) => {
        switch (activeTab) {
          case "ringing":
            return call.state === "ringing"
          case "active":
            return call.state === "active"
          case "handoff":
            return call.state === "handoff_requested"
          case "at_risk":
            return call.state === "at_risk" || call.riskFlags.length > 0
          case "errors":
            return call.state === "error"
          default:
            return true
        }
      })
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (call) =>
          call.callerNumber.toLowerCase().includes(query) ||
          call.callId.toLowerCase().includes(query) ||
          (call.intent || "").toLowerCase().includes(query),
      )
    }

    // Sort: at-risk first, then by duration
    result.sort((a, b) => {
      const aRisk = a.riskFlags.length > 0 ? 1 : 0
      const bRisk = b.riskFlags.length > 0 ? 1 : 0
      if (aRisk !== bRisk) return bRisk - aRisk
      return b.durationSeconds - a.durationSeconds
    })

    return result
  }, [calls, activeTab, searchQuery])

  // Tab counts
  const tabCounts = useMemo(
    () => ({
      all: calls.length,
      ringing: calls.filter((c) => c.state === "ringing").length,
      active: calls.filter((c) => c.state === "active").length,
      handoff: calls.filter((c) => c.state === "handoff_requested").length,
      at_risk: calls.filter((c) => c.state === "at_risk" || c.riskFlags.length > 0).length,
      errors: calls.filter((c) => c.state === "error").length,
    }),
    [calls],
  )

  // Capacity strip data
  const capacityData = useMemo(
    () => ({
      concurrencyUsed: calls.length,
      concurrencyLimit: 10,
      ringingCount: tabCounts.ringing,
      activeCount: tabCounts.active,
      handoffCount: tabCounts.handoff,
      atRiskCount: tabCounts.at_risk,
      errorsCount: tabCounts.errors,
    }),
    [calls.length, tabCounts],
  )

  const systemStatus: SystemStatusType = tabCounts.errors > 2 ? "degraded" : "operational"

  const statusDetails = {
    telephony: [
      { name: "Twilio", status: "operational", latency: 45 },
      { name: "SIP Trunk", status: "operational", latency: 32 },
    ],
    integrations: [
      {
        name: "HubSpot",
        status: systemStatus === "degraded" ? "degraded" : "operational",
        message: systemStatus === "degraded" ? "Elevated latency" : undefined,
      },
      { name: "Salesforce", status: "operational" },
      { name: "Slack", status: "operational" },
    ],
    incidents: [],
  }

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-full">
        {/* Sticky Header */}
        <LiveCallsHeader
        activeCount={calls.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        autoRefresh={autoRefresh}
        onAutoRefreshToggle={setAutoRefresh}
        lastUpdated={lastUpdated}
        onRefreshNow={handleRefreshNow}
      />

      {/* Capacity Strip */}
      <div className="px-4 py-3 border-b">
        <CapacityStrip
          concurrencyUsed={capacityData.concurrencyUsed}
          concurrencyLimit={capacityData.concurrencyLimit}
          ringingCount={capacityData.ringingCount}
          activeCount={capacityData.activeCount}
          handoffCount={capacityData.handoffCount}
          atRiskCount={capacityData.atRiskCount}
          errorsCount={capacityData.errorsCount}
          systemStatus={systemStatus}
          statusDetails={statusDetails}
        />
      </div>

      {/* Tabs + View Toggle */}
      <div className="px-4 flex items-center justify-between">
        <LiveCallsTabs activeTab={activeTab} onTabChange={setActiveTab} counts={tabCounts} />
        <div className="flex items-center gap-1 border-b pb-px">
          <Button
            variant={viewMode === "table" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => handleViewModeChange("table")}
            aria-label="Table view"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "cards" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => handleViewModeChange("cards")}
            aria-label="Card view"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <TableSkeleton rows={6} columns={6} />
            </CardContent>
          </Card>
        ) : filteredCalls.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={searchQuery || activeTab !== "all" ? "No matching calls" : "No active calls"}
            description={
              searchQuery || activeTab !== "all"
                ? "Try adjusting your search or filters"
                : "There are no live calls at the moment. Calls will appear here when they start."
            }
            variant={searchQuery || activeTab !== "all" ? "search" : "default"}
            action={
              searchQuery || activeTab !== "all"
                ? {
                    label: "Clear Filters",
                    onClick: () => {
                      setSearchQuery("")
                      setActiveTab("all")
                    },
                  }
                : undefined
            }
          />
        ) : (
          <LiveCallsTable
            calls={filteredCalls}
            isLoading={false}
            onCallClick={handleCallClick}
            selectedCallId={selectedCall?.callId}
            pauseReorder={drawerOpen}
            onTransfer={handleTransfer}
            onCreateAction={handleCreateAction}
            onEndCall={handleEndCallRequest}
            onFlagForReview={handleFlagForReview}
            onTagCall={(callId, tag) => void handleTagCall(callId, tag)}
            onViewHistory={() => {
              handleNavigate("history")
            }}
            loadingActions={loadingActions}
          />
        )}
      </div>

      {/* Call Details Drawer */}
      <CallInspectorDrawer
        call={selectedCall}
        open={drawerOpen}
        onOpenChange={handleDrawerClose}
        onEndCall={handleEndCallRequest}
        onTransfer={handleTransfer}
        onCreateAction={handleCreateAction}
        onFlagForReview={handleFlagForReview}
        onSaveNote={handleSaveNote}
        onSaveTags={handleSaveTags}
        loadingActions={loadingActions}
      />

      {/* Handoff Modal */}
      <HandoffModal
        open={handoffModalOpen}
        onOpenChange={setHandoffModalOpen}
        callerNumber={calls.find((c) => c.callId === handoffCallId)?.callerNumber}
        onConfirm={handleHandoffConfirm}
        isLoading={handoffCallId ? loadingActions[`transfer-${handoffCallId}`] : false}
      />

      {/* Create Action Modal */}
      <CreateFollowUpModal
        open={createActionModalOpen}
        onOpenChange={setCreateActionModalOpen}
        contacts={contactsForModal}
        selectedContact={callForAction ? callToContact(callForAction) : null}
        onSubmit={handleActionSubmit}
      />

      <ConfirmDialog
        open={endCallConfirm.open}
        onOpenChange={(open) => setEndCallConfirm({ open, callId: open ? endCallConfirm.callId : null })}
        title="End this call?"
        description="This will immediately terminate the call. This action cannot be undone."
        confirmLabel="End Call"
        variant="destructive"
        onConfirm={handleEndCallConfirm}
      />
      </div>
    </ErrorBoundary>
  )
}

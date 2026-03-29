"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { CallHistoryHeader, type SavedViewForHeader } from "@/components/call-history/call-history-header"
import { CallHistoryFilters, type Filters } from "@/components/call-history/call-history-filters"
import { ActiveFilterChips } from "@/components/call-history/active-filter-chips"
import { CallHistoryTable } from "@/components/call-history/call-history-table"
import type { CallRecord } from "@/types/api"
import { CallDetailDrawer } from "@/components/call-history/call-detail-drawer"
import { TableSkeleton } from "@/components/loading-skeleton"
import { EmptyState } from "@/components/empty-state"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { toast } from "@/hooks/use-toast"
import { ErrorBoundary } from "@/components/error-boundary"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Download, Trash2, Tag, ChevronDown, Save, History } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CreateFollowUpModal } from "@/components/actions/create-follow-up-modal"
import type { Contact } from "@/lib/actions-store"
import { subDays } from "date-fns"

import { getCallHistory, getPhoneLines, getTools } from "@/lib/data/call-history"

interface SavedView {
  id: string
  name: string
  filters: Filters
  dateRange: { from: Date; to: Date }
}
export type { SavedView }

const defaultFilters: Filters = {
  search: "",
  results: [],
  intent: "",
  phoneLine: "",
  direction: "",
  endReason: "",
  durationBucket: "",
  toolUsed: "",
  toolErrorsOnly: false,
  tags: [],
}

export interface BuiltInViewDef {
  id: string
  label: string
  description: string
  getState: () => { filters: Filters; dateRange: { from: Date; to: Date } }
}

const BUILT_IN_VIEWS: BuiltInViewDef[] = [
  {
    id: "default",
    label: "Default",
    description: "All calls, last 7 days",
    getState: () => {
      const to = new Date()
      return {
        filters: defaultFilters,
        dateRange: { from: subDays(to, 7), to },
      }
    },
  },
  {
    id: "attention",
    label: "Needs attention",
    description: "Failures and handoffs, last 7 days",
    getState: () => {
      const to = new Date()
      return {
        filters: { ...defaultFilters, results: ["systemFailed", "handoff"] },
        dateRange: { from: subDays(to, 7), to },
      }
    },
  },
  {
    id: "completed",
    label: "Completed only",
    description: "Successfully completed calls, last 7 days",
    getState: () => {
      const to = new Date()
      return {
        filters: { ...defaultFilters, results: ["completed"] },
        dateRange: { from: subDays(to, 7), to },
      }
    },
  },
  {
    id: "long",
    label: "Long calls",
    description: "Calls over 1 minute, last 30 days",
    getState: () => {
      const to = new Date()
      return {
        filters: { ...defaultFilters, durationBucket: "1m+" },
        dateRange: { from: subDays(to, 30), to },
      }
    },
  },
]

export interface HistoryPageProps {
  initialFilter?: string
  initialIntent?: string
  initialReason?: string
}

function mapInitialFilterToResults(filter: string): string[] {
  if (filter === "failed") return ["systemFailed"]
  if (filter === "handoff") return ["handoff"]
  if (filter === "dropped") return ["dropped"]
  if (filter === "completed") return ["completed"]
  return []
}

export function HistoryPage({ initialFilter, initialIntent, initialReason }: HistoryPageProps = {}) {
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [phoneLines, setPhoneLines] = useState<{ id: string; number: string; name: string }[]>([])
  const [tools, setTools] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [dateRange, setDateRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    to: new Date(),
  })

  const [filters, setFilters] = useState<Filters>({
    search: "",
    results: [],
    intent: "",
    phoneLine: "",
    direction: "",
    endReason: "",
    durationBucket: "",
    toolUsed: "",
    toolErrorsOnly: false,
    tags: [],
  })

  // Apply initial filter/intent/reason from dashboard deep links (e.g. Needs Attention, Insights)
  useEffect(() => {
    if (initialFilter || initialIntent || initialReason) {
      setFilters((prev) => ({
        ...prev,
        ...(initialFilter ? { results: mapInitialFilterToResults(initialFilter) } : {}),
        ...(initialIntent !== undefined && initialIntent !== "" ? { intent: initialIntent } : {}),
        ...(initialReason !== undefined && initialReason !== "" ? { endReason: initialReason } : {}),
      }))
    }
  }, [initialFilter, initialIntent, initialReason])

  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [createActionModalOpen, setCreateActionModalOpen] = useState(false)
  const [callForAction, setCallForAction] = useState<CallRecord | null>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("callHistory_savedViews")
      return stored ? JSON.parse(stored) : []
    }
    return []
  })
  const [currentViewId, setCurrentViewId] = useState<string | null>(null)
  const [saveViewDialogOpen, setSaveViewDialogOpen] = useState(false)
  const [newViewName, setNewViewName] = useState("")

  // Load data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [callsData, phoneLinesData, toolsData] = await Promise.all([
          getCallHistory(),
          getPhoneLines(),
          getTools(),
        ])
        setCalls(callsData)
        setPhoneLines(phoneLinesData)
        setTools(toolsData)
      } catch (error) {
        console.error("Failed to load call history data:", error)
        toast({
          title: "Error",
          description: "Failed to load call history data.",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("callHistory_savedViews", JSON.stringify(savedViews))
    }
  }, [savedViews])

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const callDate = new Date(call.startedAt)
      if (callDate < dateRange.from || callDate > dateRange.to) return false

      if (filters.search) {
        const searchLower = filters.search.toLowerCase()
        const matchesSearch =
          call.callerNumber.toLowerCase().includes(searchLower) ||
          call.callId.toLowerCase().includes(searchLower) ||
          (call.callerName?.toLowerCase().includes(searchLower) ?? false)
        if (!matchesSearch) return false
      }

      if (filters.results.length > 0 && !filters.results.includes(call.result)) return false
      if (filters.intent && filters.intent !== "all" && call.intent !== filters.intent) return false
      if (filters.phoneLine && filters.phoneLine !== "all" && call.phoneLineId !== filters.phoneLine) return false
      if (filters.direction && filters.direction !== "all" && call.direction !== filters.direction) return false
      if (filters.endReason && filters.endReason !== "all" && call.endReason !== filters.endReason) return false

      if (filters.toolUsed && filters.toolUsed !== "all") {
        if (!call.toolsUsed.some((t) => t.name === filters.toolUsed)) return false
      }

      if (filters.toolErrorsOnly) {
        if (!call.toolsUsed.some((t) => !t.success)) return false
      }

      if (filters.durationBucket === "1m+") {
        if (call.durationMs < 60000) return false
      }

      return true
    })
  }, [calls, dateRange, filters])

  const handleRemoveFilter = (key: keyof Filters, value?: string) => {
    if (key === "results" && value) {
      setFilters({
        ...filters,
        results: filters.results.filter((r) => r !== value),
      })
    } else if (key === "toolErrorsOnly") {
      setFilters({ ...filters, toolErrorsOnly: false })
    } else {
      setFilters({ ...filters, [key]: "" })
    }
    setCurrentViewId(null)
  }

  const handleRowClick = (call: CallRecord) => {
    setSelectedCall(call)
    setDrawerOpen(true)
  }

  const handleExport = useCallback(
    (format: "csv" | "json" = "csv") => {
      const dataToExport =
        selectedIds.length > 0 ? filteredCalls.filter((c) => selectedIds.includes(c.callId)) : filteredCalls

      if (format === "csv") {
        const csv = [
          ["Call ID", "Date", "Caller", "Intent", "Direction", "Duration", "Result", "End Reason"].join(","),
          ...dataToExport.map((call) =>
            [
              call.callId,
              call.startedAt,
              call.callerNumber,
              call.intent,
              call.direction,
              call.durationMs,
              call.result,
              call.endReason,
            ].join(","),
          ),
        ].join("\n")

        const blob = new Blob([csv], { type: "text/csv" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `call-history-${new Date().toISOString().split("T")[0]}.csv`
        a.click()
      } else {
        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `call-history-${new Date().toISOString().split("T")[0]}.json`
        a.click()
      }

      toast({
        title: "Export Complete",
        description: `${dataToExport.length} calls exported as ${format.toUpperCase()}`,
      })
    },
    [filteredCalls, selectedIds],
  )

  // Helper function to convert CallRecord to Contact
  const callToContact = useCallback((call: CallRecord): Contact => {
    return {
      id: `contact-${call.callId}`,
      phone: call.callerNumber,
      name: call.callerName,
      email: undefined,
      tags: [],
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
    (data: {
      contactId: string
      type: string
      priority: number
      dueAt: string
      notes: string
      ownerId?: string
    }) => {
      // In a real app, this would create the follow-up action via API
      toast({
        title: "Action Created",
        description: `Follow-up action created for call ${callForAction?.callId}. ${data.type} follow-up scheduled.`,
      })

      // Close modal and clear call context
      setCreateActionModalOpen(false)
      setCallForAction(null)
    },
    [callForAction, toast],
  )

  // Create contacts list for modal (convert call to contact if available)
  const contactsForModal = useMemo(() => {
    if (callForAction) {
      return [callToContact(callForAction)]
    }
    return []
  }, [callForAction, callToContact])

  const handleSelectAll = useCallback(() => {
    if (selectedIds.length === filteredCalls.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(filteredCalls.map((c) => c.callId))
    }
  }, [filteredCalls, selectedIds])

  const handleSelectRow = useCallback((callId: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, callId] : prev.filter((id) => id !== callId)))
  }, [])

  const handleBulkDelete = useCallback(() => {
    setCalls((prev) => prev.filter((c) => !selectedIds.includes(c.callId)))
    setSelectedIds([])
    setDeleteConfirmOpen(false)
    toast({
      title: "Calls Deleted",
      description: `${selectedIds.length} calls removed from history`,
    })
  }, [selectedIds])

  const handleSaveView = useCallback(() => {
    if (!newViewName.trim()) return
    const newView: SavedView = {
      id: `view-${Date.now()}`,
      name: newViewName.trim(),
      filters,
      dateRange,
    }
    setSavedViews((prev) => [...prev, newView])
    setCurrentViewId(newView.id)
    setSaveViewDialogOpen(false)
    setNewViewName("")
    toast({ title: "View Saved", description: `"${newView.name}" has been saved` })
  }, [newViewName, filters, dateRange])

  const handleSelectView = useCallback((view: SavedViewForHeader) => {
    setFilters(view.filters as Filters)
    setDateRange({
      from: new Date(view.dateRange.from),
      to: new Date(view.dateRange.to),
    })
    setCurrentViewId(view.id)
  }, [])

  const handleSelectBuiltInView = useCallback((viewId: string) => {
    const def = BUILT_IN_VIEWS.find((d) => d.id === viewId)
    if (def) {
      const { filters: f, dateRange: dr } = def.getState()
      setFilters(f)
      setDateRange(dr)
      setCurrentViewId(viewId)
    }
  }, [])

  const handleDeleteView = useCallback(
    (viewId: string) => {
      setSavedViews((prev) => prev.filter((v) => v.id !== viewId))
      if (currentViewId === viewId) setCurrentViewId(null)
      toast({ title: "View Deleted" })
    },
    [currentViewId],
  )

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <CallHistoryHeader
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onExport={() => handleExport("csv")}
          builtInViews={BUILT_IN_VIEWS.map((v) => ({ id: v.id, label: v.label, description: v.description }))}
          userSavedViews={savedViews}
          currentViewId={currentViewId}
          onSelectBuiltInView={handleSelectBuiltInView}
          onSelectUserView={handleSelectView}
          onSaveCurrentView={() => setSaveViewDialogOpen(true)}
        />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <CallHistoryFilters
            filters={filters}
            onFiltersChange={(f) => {
              setFilters(f)
              setCurrentViewId(null)
            }}
            phoneLines={phoneLines}
            tools={tools}
          />

          <ActiveFilterChips
            filters={filters}
            onRemoveFilter={handleRemoveFilter}
            phoneLines={phoneLines}
          />
        </CardContent>
      </Card>

      {selectedIds.length > 0 && (
        <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
          <Checkbox
            checked={selectedIds.length === filteredCalls.length}
            onCheckedChange={handleSelectAll}
            aria-label="Select all"
          />
          <span className="text-sm text-muted-foreground">
            {selectedIds.length} of {filteredCalls.length} selected
          </span>
          <Separator orientation="vertical" className="h-4" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export Selected
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport("csv")}>Export as CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("json")}>Export as JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast({ title: "Coming Soon", description: "Tagging will be available in a future update." })
            }
          >
            <Tag className="h-4 w-4 mr-2" />
            Tag
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive bg-transparent"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <TableSkeleton rows={8} columns={7} />
          ) : filteredCalls.length === 0 ? (
            <EmptyState
              title="No calls found"
              description="Try adjusting your filters or date range to find calls."
              variant="search"
              action={{
                label: "Clear Filters",
                onClick: () => {
                  setFilters({
                    search: "",
                    results: [],
                    intent: "",
                    phoneLine: "",
                    direction: "",
                    endReason: "",
                    durationBucket: "",
                    toolUsed: "",
                    toolErrorsOnly: false,
                    tags: [],
                  })
                  setDateRange({
                    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    to: new Date(),
                  })
                },
              }}
            />
          ) : (
            <CallHistoryTable
              calls={filteredCalls}
              onRowClick={handleRowClick}
              selectedIds={selectedIds}
              onSelectRow={handleSelectRow}
            />
          )}
        </CardContent>
      </Card>

      <CallDetailDrawer
        call={selectedCall}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreateAction={handleCreateAction}
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
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete selected calls?"
        description={`This will permanently remove ${selectedIds.length} call${selectedIds.length > 1 ? "s" : ""} from history. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleBulkDelete}
      />

      <Dialog open={saveViewDialogOpen} onOpenChange={setSaveViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current View</DialogTitle>
            <DialogDescription>Save your current filters and date range as a reusable view.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="viewName">View Name</Label>
            <Input
              id="viewName"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              placeholder="e.g., Failed Calls This Week"
              className="mt-2"
              onKeyDown={(e) => e.key === "Enter" && handleSaveView()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveViewDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveView} disabled={!newViewName.trim()}>
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </ErrorBoundary>
  )
}

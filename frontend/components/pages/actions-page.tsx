"use client"

import { useState, useMemo, useCallback, useEffect, useRef, Fragment } from "react"
import { ActionsProvider, useActionsState, type FollowUp } from "@/lib/actions-store"
import { ActionsTopBar } from "@/components/actions/actions-top-bar"
import { ActionQueueList } from "@/components/actions/action-queue-list"
import { ContactContextPanel } from "@/components/actions/contact-context-panel"
import { TranscriptViewer } from "@/components/actions/transcript-viewer"
import { NextActionComposer } from "@/components/actions/next-action-composer"
import { CreateFollowUpModal } from "@/components/actions/create-follow-up-modal"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu, Send, List, Plus, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react"
// Temporarily disabled react-resizable-panels due to React 19 compatibility issue
// import { Panel, Group, Separator, usePanelRef, type PanelImperativeHandle } from "react-resizable-panels"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/confirm-dialog"

function ActionsPageContent() {
  const { state, dispatch, isWithinBusinessHours } = useActionsState()
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState<{ x: number; sizes: { queue: number; contact: number; transcript: number; composer: number }; separatorIndex: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  // UI State
  const [searchQuery, setSearchQuery] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [priorityFilter, setPriorityFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [verticalFilter, setVerticalFilter] = useState("all")
  const [dueFilter, setDueFilter] = useState("all")
  const [savedView, setSavedView] = useState("inbox")
  const [activeQueue, setActiveQueue] = useState("all")

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [selectedEventType, setSelectedEventType] = useState<"call" | "followup" | null>(null)

  const [createFollowUpOpen, setCreateFollowUpOpen] = useState(false)
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false)
  const [mobileComposerOpen, setMobileComposerOpen] = useState(false)
  const [noteDialogOpen, setNoteDialogOpen] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [blocklistConfirmOpen, setBlocklistConfirmOpen] = useState(false)
  const [bulkResolveConfirmOpen, setBulkResolveConfirmOpen] = useState(false)
  const [pendingBulkResolveIds, setPendingBulkResolveIds] = useState<string[]>([])

  // Panel state management
  const [panelCollapsed, setPanelCollapsed] = useState<{
    queue: boolean
    contact: boolean
    transcript: boolean
    composer: boolean
  }>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("actions_panel_collapsed")
      if (stored) {
        try {
          return JSON.parse(stored)
        } catch {
          return { queue: false, contact: false, transcript: false, composer: false }
        }
      }
    }
    return { queue: false, contact: false, transcript: false, composer: false }
  })

  const defaultPanelSizes = {
    queue: 25, // 25% of width (as percentage 0-100)
    contact: 30, // 30% of width
    transcript: 25, // 25% of width
    composer: 20, // 20% of width
  }

  const [panelSizes, setPanelSizes] = useState<{
    queue: number
    contact: number
    transcript: number
    composer: number
  }>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("actions_panel_widths")
      if (stored) {
        try {
          return JSON.parse(stored)
        } catch {
          return defaultPanelSizes
        }
      }
    }
    return defaultPanelSizes
  })

  // Filter contacts based on search
  const filteredContacts = useMemo(() => {
    if (!searchQuery) return state.contacts

    const query = searchQuery.toLowerCase()
    return state.contacts.filter((contact) => {
      const nameMatch = contact.name?.toLowerCase().includes(query)
      const phoneMatch = contact.phone.includes(query)
      const callMatch = state.calls.some(
        (call) => call.contactId === contact.id && (call.summary?.toLowerCase().includes(query) || false),
      )
      return nameMatch || phoneMatch || callMatch
    })
  }, [state.contacts, state.calls, searchQuery])

  // Get selected contact data
  const selectedContact = selectedContactId ? state.contacts.find((c) => c.id === selectedContactId) || null : null

  const contactCalls = useMemo(() => {
    if (!selectedContactId) return []
    return state.calls
      .filter((c) => c.contactId === selectedContactId)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  }, [state.calls, selectedContactId])

  const contactFollowUps = useMemo(() => {
    if (!selectedContactId) return []
    return state.followUps.filter((f) => f.contactId === selectedContactId)
  }, [state.followUps, selectedContactId])

  const selectedCall = useMemo(() => {
    if (!selectedEventId || selectedEventType !== "call") return contactCalls[0] || null
    return state.calls.find((c) => c.id === selectedEventId) || null
  }, [state.calls, selectedEventId, selectedEventType, contactCalls])

  const activeFollowUp = useMemo(() => {
    return contactFollowUps.find((f) => !["done", "canceled"].includes(f.status)) || null
  }, [contactFollowUps])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        searchInput?.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Handlers
  const handleSelectContact = useCallback((contactId: string) => {
    setSelectedContactId(contactId)
    setSelectedEventId(null)
    setSelectedEventType(null)
    setMobileQueueOpen(false)
  }, [])

  const handleSelectEvent = useCallback((eventId: string, type: "call" | "followup") => {
    setSelectedEventId(eventId)
    setSelectedEventType(type)
  }, [])

  const handleSendMessage = useCallback(
    async (channel: string, message: string) => {
      if (!selectedContactId) return

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 500))

      const existingFollowUp = state.followUps.find(
        (f) => f.contactId === selectedContactId && !["done", "canceled"].includes(f.status),
      )

      const attemptId = `att-${Date.now()}`

      if (existingFollowUp) {
        dispatch({
          type: "ADD_ATTEMPT",
          followUpId: existingFollowUp.id,
          attempt: {
            id: attemptId,
            type: channel as "sms" | "ai_call" | "email" | "manual",
            time: new Date().toISOString(),
            result: "sent",
            note: message.substring(0, 50),
          },
        })

        dispatch({
          type: "UPDATE_FOLLOW_UP",
          id: existingFollowUp.id,
          updates: { status: "waiting_on_customer" },
        })
      }

      toast({
        title: `${channel === "sms" ? "SMS" : channel === "ai_call" ? "AI Call" : "Email"} sent`,
        description: `Message sent to ${selectedContact?.name || selectedContact?.phone}`,
      })
    },
    [selectedContactId, selectedContact, state.followUps, dispatch, toast],
  )

  const handleScheduleFollowUp = useCallback(
    async (data: { dueAt: string; priority: number; notes: string }) => {
      if (!selectedContactId) return

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 500))

      const newFollowUp: FollowUp = {
        id: `fu-${Date.now()}`,
        contactId: selectedContactId,
        type: "general",
        status: "scheduled",
        priority: data.priority,
        severity: data.priority === 1 ? "high" : "medium",
        dueAt: data.dueAt,
        createdAt: new Date().toISOString(),
        recommendedNextStep: data.notes || "Follow up with customer",
        channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
        attempts: [],
        scheduledSteps: [],
        metadata: {},
        vertical: "Common",
        notes: data.notes,
        tags: [],
      }

      dispatch({ type: "ADD_FOLLOW_UP", followUp: newFollowUp })
      toast({ title: "Follow-up scheduled", description: `Scheduled for ${new Date(data.dueAt).toLocaleString()}` })
    },
    [selectedContactId, dispatch, toast],
  )

  const handleAssignOwner = useCallback(() => {
    if (!selectedContactId) return
    const followUp = state.followUps.find(
      (f) => f.contactId === selectedContactId && !["done", "canceled"].includes(f.status),
    )
    if (followUp) {
      dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { ownerId: "current_user" } })
      toast({ title: "Assigned to you" })
    }
  }, [selectedContactId, state.followUps, dispatch, toast])

  const handleMarkResolved = useCallback(() => {
    if (!selectedContactId) return
    const followUps = state.followUps.filter(
      (f) => f.contactId === selectedContactId && !["done", "canceled"].includes(f.status),
    )
    followUps.forEach((fu) => {
      dispatch({ type: "UPDATE_FOLLOW_UP", id: fu.id, updates: { status: "done" } })
    })
    if (followUps.length > 0) {
      toast({ title: `Marked ${followUps.length} follow-up(s) as resolved` })
    }
  }, [selectedContactId, state.followUps, dispatch, toast])

  const handleSnooze = useCallback(() => {
    if (!selectedContactId) return
    const followUp = state.followUps.find(
      (f) => f.contactId === selectedContactId && !["done", "canceled"].includes(f.status),
    )
    if (followUp) {
      const newDue = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { status: "snoozed", dueAt: newDue } })
      toast({ title: "Snoozed for 1 hour" })
    }
  }, [selectedContactId, state.followUps, dispatch, toast])

  const handleAddNote = useCallback(() => {
    if (!selectedContactId) return
    const followUp = state.followUps.find(
      (f) => f.contactId === selectedContactId && !["done", "canceled"].includes(f.status),
    )
    if (followUp) {
      setNoteText(followUp.notes || "")
      setNoteDialogOpen(true)
    } else {
      toast({ title: "No active follow-up", description: "Create a follow-up first to add notes" })
    }
  }, [selectedContactId, state.followUps, toast])

  const handleBlocklist = useCallback(() => {
    if (!selectedContactId) return
    setBlocklistConfirmOpen(true)
  }, [selectedContactId])

  const handleBlocklistConfirm = useCallback(() => {
    if (!selectedContactId) return
    dispatch({
      type: "UPDATE_CONTACT",
      id: selectedContactId,
      updates: { smsOptOut: true, tags: [...(selectedContact?.tags || []), "blocklisted"] },
    })
    toast({
      title: "Contact blocklisted",
      description: "This contact will not receive automated messages",
      variant: "destructive",
    })
    setBlocklistConfirmOpen(false)
  }, [selectedContactId, selectedContact, dispatch, toast])

  // Bulk action handlers
  const handleBulkMarkResolved = useCallback(
    (contactIds: string[]) => {
      if (contactIds.length === 0) return
      setPendingBulkResolveIds(contactIds)
      setBulkResolveConfirmOpen(true)
    },
    [],
  )

  const handleBulkMarkResolvedConfirm = useCallback(() => {
    let count = 0
    pendingBulkResolveIds.forEach((contactId) => {
      const followUps = state.followUps.filter(
        (f) => f.contactId === contactId && !["done", "canceled"].includes(f.status),
      )
      followUps.forEach((fu) => {
        dispatch({ type: "UPDATE_FOLLOW_UP", id: fu.id, updates: { status: "done" } })
        count++
      })
    })
    if (count > 0) {
      toast({ title: `Marked ${count} follow-up(s) as resolved` })
    }
    setBulkResolveConfirmOpen(false)
    setPendingBulkResolveIds([])
  }, [pendingBulkResolveIds, state.followUps, dispatch, toast])

  const handleBulkSnooze = useCallback(
    (contactIds: string[]) => {
      const newDue = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      let count = 0
      contactIds.forEach((contactId) => {
        const followUp = state.followUps.find(
          (f) => f.contactId === contactId && !["done", "canceled"].includes(f.status),
        )
        if (followUp) {
          dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { status: "snoozed", dueAt: newDue } })
          count++
        }
      })
      if (count > 0) {
        toast({ title: `Snoozed ${count} follow-up(s) for 1 hour` })
      }
    },
    [state.followUps, dispatch, toast],
  )

  const handleBulkAddTag = useCallback(
    (contactIds: string[], tag: string) => {
      contactIds.forEach((contactId) => {
        const followUp = state.followUps.find(
          (f) => f.contactId === contactId && !["done", "canceled"].includes(f.status),
        )
        if (followUp && !followUp.tags.includes(tag)) {
          dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { tags: [...followUp.tags, tag] } })
        }
      })
      toast({ title: `Added tag "${tag}" to ${contactIds.length} item(s)` })
    },
    [state.followUps, dispatch, toast],
  )

  // Export handler
  const handleExport = useCallback(
    (format: "csv" | "json") => {
      // Get active follow-ups matching current filters
      const activeFollowUps = state.followUps.filter((f) => !["done", "canceled"].includes(f.status))

      // Apply filters
      let filteredFollowUps = activeFollowUps

      if (statusFilter !== "all") {
        filteredFollowUps = filteredFollowUps.filter((f) => f.status === statusFilter)
      }

      if (priorityFilter !== "all") {
        const priorityMap: Record<string, string> = {
          high: "high",
          medium: "medium",
          low: "low",
        }
        filteredFollowUps = filteredFollowUps.filter((f) => f.severity === priorityMap[priorityFilter])
      }

      if (typeFilter !== "all") {
        filteredFollowUps = filteredFollowUps.filter((f) => f.type === typeFilter)
      }

      if (verticalFilter !== "all") {
        filteredFollowUps = filteredFollowUps.filter((f) => f.vertical === verticalFilter)
      }

      if (ownerFilter !== "all") {
        if (ownerFilter === "me") {
          filteredFollowUps = filteredFollowUps.filter((f) => f.ownerId === "current_user")
        } else if (ownerFilter === "unassigned") {
          filteredFollowUps = filteredFollowUps.filter((f) => !f.ownerId)
        }
      }

      // Apply search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        filteredFollowUps = filteredFollowUps.filter((f) => {
          const contact = state.contacts.find((c) => c.id === f.contactId)
          if (!contact) return false
          const nameMatch = contact.name?.toLowerCase().includes(query)
          const phoneMatch = contact.phone.includes(query)
          return nameMatch || phoneMatch
        })
      }

      // Build export data
      const exportData = filteredFollowUps.map((followUp) => {
        const contact = state.contacts.find((c) => c.id === followUp.contactId)
        const lastCall = state.calls
          .filter((c) => c.contactId === followUp.contactId)
          .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0]

        const now = new Date()
        const dueDate = new Date(followUp.dueAt)
        const isOverdue = dueDate.getTime() < now.getTime()

        return {
          "Contact Name": contact?.name || "",
          "Phone": contact?.phone || "",
          "Email": contact?.email || "",
          "Follow-up ID": followUp.id,
          "Type": followUp.type,
          "Status": followUp.status,
          "Priority": followUp.severity,
          "Due Date": new Date(followUp.dueAt).toLocaleString(),
          "Is Overdue": isOverdue ? "Yes" : "No",
          "Owner": followUp.ownerId || "Unassigned",
          "Vertical": followUp.vertical,
          "Created At": new Date(followUp.createdAt).toLocaleString(),
          "Last Call": lastCall ? new Date(lastCall.time).toLocaleString() : "",
          "Last Call Outcome": lastCall?.outcome || "",
          "Attempts": followUp.attempts.length,
          "Tags": followUp.tags.join(", ") || "",
        }
      })

      if (format === "csv") {
        if (exportData.length === 0) {
          toast({
            title: "No data to export",
            description: "No follow-ups match the current filters",
            variant: "destructive",
          })
          return
        }

        const headers = Object.keys(exportData[0])
        const csv = [
          headers.join(","),
          ...exportData.map((row) =>
            headers
              .map((header) => {
                const value = row[header as keyof typeof row]
                // Escape commas and quotes in CSV
                const stringValue = String(value || "")
                if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
                  return `"${stringValue.replace(/"/g, '""')}"`
                }
                return stringValue
              })
              .join(","),
          ),
        ].join("\n")

        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `actions-queue-${new Date().toISOString().split("T")[0]}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        toast({
          title: "Export Complete",
          description: `${exportData.length} follow-up(s) exported as CSV`,
        })
      } else {
        if (exportData.length === 0) {
          toast({
            title: "No data to export",
            description: "No follow-ups match the current filters",
            variant: "destructive",
          })
          return
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `actions-queue-${new Date().toISOString().split("T")[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        toast({
          title: "Export Complete",
          description: `${exportData.length} follow-up(s) exported as JSON`,
        })
      }
    },
    [
      state.followUps,
      state.contacts,
      state.calls,
      statusFilter,
      priorityFilter,
      typeFilter,
      verticalFilter,
      ownerFilter,
      searchQuery,
      toast,
    ],
  )

  // Save panel sizes to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("actions_panel_widths", JSON.stringify(panelSizes))
    }
  }, [panelSizes])

  // Save panel collapsed state to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("actions_panel_collapsed", JSON.stringify(panelCollapsed))
    }
  }, [panelCollapsed])

  // Panel collapse control - using state-based approach
  const togglePanelCollapse = useCallback((panel: "queue" | "contact" | "transcript" | "composer") => {
    setPanelCollapsed((prev) => {
      const isCurrentlyCollapsed = prev[panel]
      return { ...prev, [panel]: !isCurrentlyCollapsed }
    })
  }, [])

  // Reset view to defaults
  const handleResetView = useCallback(() => {
    setPanelSizes(defaultPanelSizes)
    setPanelCollapsed({ queue: false, contact: false, transcript: false, composer: false })
    toast({
      title: "View Reset",
      description: "All panels have been reset to default sizes and expanded.",
    })
  }, [toast])

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, separatorIndex: number) => {
    e.preventDefault()
    setIsResizing(true)
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      setResizeStart({
        x: e.clientX - rect.left,
        sizes: { ...panelSizes },
        separatorIndex,
      })
    }
  }, [panelSizes])

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeStart || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const currentX = e.clientX - rect.left
    const deltaX = currentX - resizeStart.x
    const containerWidth = rect.width
    const deltaPercent = (deltaX / containerWidth) * 100

    setPanelSizes((prev) => {
      const newSizes = { ...prev }
      const { separatorIndex, sizes: startSizes } = resizeStart

      if (separatorIndex === 0) {
        // Resize between queue and contact
        newSizes.queue = Math.max(15, Math.min(35, startSizes.queue + deltaPercent))
        newSizes.contact = Math.max(20, Math.min(50, startSizes.contact - deltaPercent))
        // Keep transcript and composer the same
        newSizes.transcript = startSizes.transcript
        newSizes.composer = startSizes.composer
      } else if (separatorIndex === 1) {
        // Resize between contact and transcript
        newSizes.contact = Math.max(20, Math.min(50, startSizes.contact + deltaPercent))
        newSizes.transcript = Math.max(20, Math.min(60, startSizes.transcript - deltaPercent))
        // Keep queue and composer the same
        newSizes.queue = startSizes.queue
        newSizes.composer = startSizes.composer
      } else if (separatorIndex === 2) {
        // Resize between transcript and composer
        newSizes.transcript = Math.max(20, Math.min(60, startSizes.transcript + deltaPercent))
        newSizes.composer = Math.max(15, Math.min(35, startSizes.composer - deltaPercent))
        // Keep queue and contact the same
        newSizes.queue = startSizes.queue
        newSizes.contact = startSizes.contact
      }

      return newSizes
    })
  }, [isResizing, resizeStart])

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
    setResizeStart(null)
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove)
      document.addEventListener('mouseup', handleResizeEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      return () => {
        document.removeEventListener('mousemove', handleResizeMove)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Top Bar */}
      <ActionsTopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        ownerFilter={ownerFilter}
        onOwnerFilterChange={setOwnerFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        priorityFilter={priorityFilter}
        onPriorityFilterChange={setPriorityFilter}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        verticalFilter={verticalFilter}
        onVerticalFilterChange={setVerticalFilter}
        dueFilter={dueFilter}
        onDueFilterChange={setDueFilter}
        savedView={savedView}
        onSavedViewChange={setSavedView}
        quietHoursEnabled={state.businessHours.enabled}
        onQuietHoursChange={(enabled) =>
          dispatch({ type: "SET_BUSINESS_HOURS", hours: { ...state.businessHours, enabled } })
        }
        onCreateFollowUp={() => setCreateFollowUpOpen(true)}
        onExport={handleExport}
        onResetView={handleResetView}
      />

      {/* Resizable Panel Layout - Desktop */}
      <div className="flex-1 min-h-0 hidden xl:block">
        <div ref={containerRef} className="flex h-full relative">
          <div
            className="flex flex-col transition-all border-r border-border bg-card"
            style={{ width: `${panelSizes.queue}%`, minWidth: panelCollapsed.queue ? '3%' : '15%', maxWidth: '35%' }}
          >
            <div className="h-full flex flex-col">
              <ActionQueueList
                contacts={filteredContacts}
                followUps={state.followUps}
                calls={state.calls}
                selectedContactId={selectedContactId}
                onSelectContact={handleSelectContact}
                activeQueue={activeQueue}
                onQueueChange={setActiveQueue}
                onBulkMarkResolved={handleBulkMarkResolved}
                onBulkSnooze={handleBulkSnooze}
                onBulkAddTag={handleBulkAddTag}
                searchQuery={searchQuery}
              />
            </div>
          </div>

          <div
            className="w-1 bg-border hover:bg-primary/20 transition-colors cursor-col-resize flex-shrink-0 relative z-10"
            onMouseDown={(e) => handleResizeStart(e, 0)}
          />
          <div
            className="flex flex-col transition-all border-r border-border bg-card"
            style={{ width: `${panelSizes.contact}%`, minWidth: panelCollapsed.contact ? '5%' : '20%', maxWidth: '50%' }}
          >
            <div className="h-full flex flex-col">
              <ContactContextPanel
                contact={selectedContact}
                calls={contactCalls}
                followUps={contactFollowUps}
                selectedEventId={selectedEventId}
                onSelectEvent={handleSelectEvent}
                onAssignOwner={handleAssignOwner}
                onMarkResolved={handleMarkResolved}
                onSnooze={handleSnooze}
                onAddNote={handleAddNote}
                onBlocklist={handleBlocklist}
              />
            </div>
          </div>

          <div
            className="w-1 bg-border hover:bg-primary/20 transition-colors cursor-col-resize flex-shrink-0 relative z-10"
            onMouseDown={(e) => handleResizeStart(e, 1)}
          />
          <div
            className="flex flex-col transition-all bg-card"
            style={{ width: `${panelSizes.transcript}%`, minWidth: panelCollapsed.transcript ? '5%' : '20%', maxWidth: '60%' }}
          >
            <div className="h-full flex flex-col">
              <TranscriptViewer call={selectedCall} />
            </div>
          </div>

          <div
            className="w-1 bg-border hover:bg-primary/20 transition-colors cursor-col-resize flex-shrink-0 relative z-10"
            onMouseDown={(e) => handleResizeStart(e, 2)}
          />
          <div
            className="flex flex-col transition-all border-l border-border bg-card"
            style={{ width: `${panelSizes.composer}%`, minWidth: panelCollapsed.composer ? '3%' : '15%', maxWidth: '35%' }}
          >
            <div className="h-full flex flex-col">
              <NextActionComposer
                contact={selectedContact}
                followUp={activeFollowUp}
                templates={state.templates}
                quietHoursEnabled={state.businessHours.enabled}
                onSendMessage={handleSendMessage}
                onScheduleFollowUp={handleScheduleFollowUp}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile/Tablet Layout */}
      <div className="flex-1 flex min-h-0 xl:hidden">
        {/* Left: Action Queue - Hidden on mobile, shown as drawer */}
        <div className="w-80 flex-shrink-0 hidden lg:block">
          <ActionQueueList
            contacts={filteredContacts}
            followUps={state.followUps}
            calls={state.calls}
            selectedContactId={selectedContactId}
            onSelectContact={handleSelectContact}
            activeQueue={activeQueue}
            onQueueChange={setActiveQueue}
            onBulkMarkResolved={handleBulkMarkResolved}
            onBulkSnooze={handleBulkSnooze}
            onBulkAddTag={handleBulkAddTag}
            searchQuery={searchQuery}
          />
        </div>

        {/* Mobile Queue Drawer */}
        <Sheet open={mobileQueueOpen} onOpenChange={setMobileQueueOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <ActionQueueList
              contacts={filteredContacts}
              followUps={state.followUps}
              calls={state.calls}
              selectedContactId={selectedContactId}
              onSelectContact={handleSelectContact}
              activeQueue={activeQueue}
              onQueueChange={setActiveQueue}
              onBulkMarkResolved={handleBulkMarkResolved}
              onBulkSnooze={handleBulkSnooze}
              onBulkAddTag={handleBulkAddTag}
              searchQuery={searchQuery}
            />
          </SheetContent>
        </Sheet>

        {/* Center: Contact & Timeline + Transcript */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Contact Context */}
          <div className="flex-1 min-w-0">
            <ContactContextPanel
              contact={selectedContact}
              calls={contactCalls}
              followUps={contactFollowUps}
              selectedEventId={selectedEventId}
              onSelectEvent={handleSelectEvent}
              onAssignOwner={handleAssignOwner}
              onMarkResolved={handleMarkResolved}
              onSnooze={handleSnooze}
              onAddNote={handleAddNote}
              onBlocklist={handleBlocklist}
            />
          </div>
        </div>

        {/* Mobile Composer Drawer */}
        <Sheet open={mobileComposerOpen} onOpenChange={setMobileComposerOpen}>
          <SheetContent side="right" className="w-80 p-0">
            <NextActionComposer
              contact={selectedContact}
              followUp={activeFollowUp}
              templates={state.templates}
              quietHoursEnabled={state.businessHours.enabled}
              onSendMessage={handleSendMessage}
              onScheduleFollowUp={handleScheduleFollowUp}
            />
          </SheetContent>
        </Sheet>

        {/* Mobile FAB Menu - Consolidated action button */}
        <div className="fixed bottom-4 right-4 z-50 lg:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                className="h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90"
              >
                <Plus className="h-6 w-6" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-48 mb-2">
              <DropdownMenuItem onClick={() => setMobileQueueOpen(true)}>
                <List className="h-4 w-4 mr-2" />
                View Queue
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setMobileComposerOpen(true)}>
                <Send className="h-4 w-4 mr-2" />
                Compose Action
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateFollowUpOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create Follow-Up
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Modals */}
      <CreateFollowUpModal
        open={createFollowUpOpen}
        onOpenChange={setCreateFollowUpOpen}
        contacts={state.contacts}
        selectedContact={selectedContact}
        selectedFollowUp={activeFollowUp}
        onSubmit={(data) => {
          const newFollowUp: FollowUp = {
            id: `fu-${Date.now()}`,
            contactId: data.contactId,
            type: data.type as FollowUp["type"],
            status: "open",
            priority: data.priority,
            severity: data.priority === 1 ? "high" : data.priority === 2 ? "medium" : "low",
            dueAt: data.dueAt,
            createdAt: new Date().toISOString(),
            recommendedNextStep: data.notes || "Follow up with customer",
            channelPlan: { primary: "sms", fallbacks: ["ai_call"] },
            attempts: [],
            scheduledSteps: [],
            metadata: {},
            vertical: "Common",
            notes: data.notes,
            ownerId: data.ownerId,
            tags: [],
          }
          dispatch({ type: "ADD_FOLLOW_UP", followUp: newFollowUp })
          setCreateFollowUpOpen(false)
        }}
      />

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Note</DialogTitle>
            <DialogDescription>
              Add a note to the follow-up for {selectedContact?.name || selectedContact?.phone}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="note">Note</Label>
              <Textarea
                id="note"
                placeholder="Enter your note here..."
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!selectedContactId) return
                const followUp = state.followUps.find(
                  (f) => f.contactId === selectedContactId && !["done", "canceled"].includes(f.status),
                )
                if (followUp) {
                  dispatch({ type: "UPDATE_FOLLOW_UP", id: followUp.id, updates: { notes: noteText } })
                  toast({ title: "Note saved", description: "Note has been added to the follow-up" })
                  setNoteDialogOpen(false)
                  setNoteText("")
                }
              }}
            >
              Save Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Blocklist Confirmation */}
      <ConfirmDialog
        open={blocklistConfirmOpen}
        onOpenChange={setBlocklistConfirmOpen}
        title="Blocklist Contact"
        description={`Are you sure you want to blocklist ${selectedContact?.name || selectedContact?.phone}? This will prevent them from receiving any automated messages. This action can be reversed later.`}
        confirmLabel="Blocklist"
        variant="destructive"
        onConfirm={handleBlocklistConfirm}
      />

      {/* Bulk Resolve Confirmation */}
      <ConfirmDialog
        open={bulkResolveConfirmOpen}
        onOpenChange={(open) => {
          setBulkResolveConfirmOpen(open)
          if (!open) setPendingBulkResolveIds([])
        }}
        title="Mark Follow-ups as Resolved"
        description={`Are you sure you want to mark ${pendingBulkResolveIds.length} follow-up(s) as resolved? This action cannot be undone.`}
        confirmLabel="Mark Resolved"
        variant="default"
        onConfirm={handleBulkMarkResolvedConfirm}
      />

    </div>
  )
}

export function ActionsPage() {
  return (
    <ActionsProvider>
      <ActionsPageContent />
    </ActionsProvider>
  )
}

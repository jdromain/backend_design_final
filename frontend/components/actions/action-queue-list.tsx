"use client"

import { useMemo, useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Phone,
  MessageSquare,
  Bot,
  Mail,
  FileText,
  Car,
  UtensilsCrossed,
  AlertCircle,
  User,
  CheckCircle2,
  Clock,
  Tag,
  History,
  AlertTriangle,
  Circle,
  XCircle,
  Calendar,
  X,
  Info,
} from "lucide-react"
import type { Contact, FollowUp, Call } from "@/lib/actions-store"
import { scoreMatch, highlightMatch } from "@/lib/search-utils"

interface ActionQueueListProps {
  contacts: Contact[]
  followUps: FollowUp[]
  calls: Call[]
  selectedContactId: string | null
  onSelectContact: (contactId: string) => void
  activeQueue: string
  onQueueChange: (queue: string) => void
  onBulkMarkResolved?: (contactIds: string[]) => void
  onBulkSnooze?: (contactIds: string[]) => void
  onBulkAddTag?: (contactIds: string[], tag: string) => void
  isLoading?: boolean
  searchQuery?: string
}

interface QueueItem {
  contactId: string
  contact: Contact
  followUp: FollowUp
  lastCall?: Call
  reason: string
  dueRelative: string
  isOverdue: boolean
  channels: string[]
  hasTranscript: boolean
  lastAttemptFailed: boolean
  humanRequired: boolean
  lastTouchText?: string
}

export function ActionQueueList({
  contacts,
  followUps,
  calls,
  selectedContactId,
  onSelectContact,
  activeQueue,
  onQueueChange,
  onBulkMarkResolved,
  onBulkSnooze,
  onBulkAddTag,
  isLoading = false,
  searchQuery = "",
}: ActionQueueListProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const prevQueueRef = useRef(activeQueue)
  const prevSearchRef = useRef(searchQuery)

  const toggleSelect = useCallback((contactId: string) => {
    setSelectedIds((prev) => (prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]))
  }, [])

  const toggleSelectAll = useCallback((items: QueueItem[]) => {
    const itemIds = items.map((i) => i.contactId)
    setSelectedIds((prev) => {
      const allSelected = itemIds.length > 0 && itemIds.every((id) => prev.includes(id))
      
      if (allSelected) {
        // Deselect all visible items
        return prev.filter((id) => !itemIds.includes(id))
      } else {
        // Select all visible items (merge with existing selection)
        const newSelection = new Set(prev)
        itemIds.forEach((id) => newSelection.add(id))
        return Array.from(newSelection)
      }
    })
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])
  // Build queue items
  const queueItems = useMemo(() => {
    if (!followUps || followUps.length === 0) return []
    if (!contacts || contacts.length === 0) return []

    const activeFollowUps = followUps.filter((f) => f && !["done", "canceled"].includes(f.status))

    return activeFollowUps
      .map((fu): QueueItem | null => {
        if (!fu || !fu.contactId) return null
        const contact = contacts.find((c) => c && c.id === fu.contactId)
        if (!contact) return null

        const contactCalls = (calls || []).filter((c) => c && c.contactId === fu.contactId)
        const lastCall = contactCalls.length > 0
          ? contactCalls.sort((a, b) => {
              const timeA = a?.time ? new Date(a.time).getTime() : 0
              const timeB = b?.time ? new Date(b.time).getTime() : 0
              return timeB - timeA
            })[0]
          : undefined

        const now = new Date()
        let dueDate: Date
        try {
          dueDate = fu.dueAt ? new Date(fu.dueAt) : new Date()
        } catch {
          dueDate = new Date()
        }
        const diffMs = dueDate.getTime() - now.getTime()
        const isOverdue = diffMs < 0

        let dueRelative: string
        const absDiffMs = Math.abs(diffMs)
        const mins = Math.floor(absDiffMs / 60000)
        const hours = Math.floor(mins / 60)
        const days = Math.floor(hours / 24)

        if (days > 0) {
          dueRelative = isOverdue ? `Overdue ${days}d` : `in ${days}d`
        } else if (hours > 0) {
          dueRelative = isOverdue ? `Overdue ${hours}h` : `in ${hours}h`
        } else {
          dueRelative = isOverdue ? `Overdue ${mins}m` : `in ${mins}m`
        }

        const reasonMap: Record<string, string> = {
          missed_call: "Missed call",
          booking: "Booking confirmation",
          estimate_approval: "Estimate approval",
          ready_pickup: "Ready for pickup",
          payment_pending: "Payment pending",
          large_party: "Large party",
          catering: "Catering inquiry",
          complaint: "Complaint follow-up",
          reservation: "Reservation",
          order_issue: "Order issue",
          general: "General follow-up",
        }

        const channels: string[] = []
        if (fu.channelPlan.primary === "sms" || fu.channelPlan.fallbacks.includes("sms")) channels.push("sms")
        if (fu.channelPlan.primary === "ai_call" || fu.channelPlan.fallbacks.includes("ai_call"))
          channels.push("ai_call")
        if (fu.channelPlan.primary === "email" || fu.channelPlan.fallbacks.includes("email")) channels.push("email")

        const lastAttempt = fu.attempts[fu.attempts.length - 1]
        const lastAttemptFailed = lastAttempt?.result === "failed" || lastAttempt?.result === "no_answer"

        // Check if human required
        const humanRequired =
          fu.type === "complaint" ||
          fu.severity === "critical" ||
          fu.tags.includes("escalated") ||
          fu.tags.includes("human_required")

        // Last touch text
        let lastTouchText: string | undefined
        if (lastAttempt) {
          const touchTime = new Date(lastAttempt.time)
          const diffMs = Date.now() - touchTime.getTime()
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
          const channelLabel =
            lastAttempt.type === "sms" ? "SMS" : lastAttempt.type === "ai_call" ? "AI call" : lastAttempt.type
          if (diffHours < 1) {
            lastTouchText = `${channelLabel} sent just now`
          } else if (diffHours < 24) {
            lastTouchText = `${channelLabel} sent ${diffHours}h ago`
          } else {
            const diffDays = Math.floor(diffHours / 24)
            lastTouchText = `${channelLabel} sent ${diffDays}d ago`
          }
        }

        return {
          contactId: contact.id,
          contact,
          followUp: fu,
          lastCall,
          reason: reasonMap[fu.type] || fu.type,
          dueRelative,
          isOverdue,
          channels,
          hasTranscript: !!lastCall?.summary,
          lastAttemptFailed,
          humanRequired,
          lastTouchText,
        }
      })
      .filter((item): item is QueueItem => item !== null)
      .sort((a, b) => {
        // Sort by overdue first, then by priority, then by due date
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
        const priorityA = a.followUp?.priority ?? 3
        const priorityB = b.followUp?.priority ?? 3
        if (priorityA !== priorityB) return priorityA - priorityB
        
        try {
          const dateA = a.followUp?.dueAt ? new Date(a.followUp.dueAt).getTime() : 0
          const dateB = b.followUp?.dueAt ? new Date(b.followUp.dueAt).getTime() : 0
          return dateA - dateB
        } catch {
          return 0
        }
      })
  }, [contacts, followUps, calls])

  // Filter by active queue
  const filteredItems = useMemo(() => {
    if (!queueItems || queueItems.length === 0) return []
    
    switch (activeQueue) {
      case "overdue":
        return queueItems.filter((i) => i.isOverdue)
      case "today":
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today)
        tomorrow.setDate(tomorrow.getDate() + 1)
        return queueItems.filter((i) => {
          if (!i.followUp?.dueAt) return false
          try {
            const due = new Date(i.followUp.dueAt)
            return !isNaN(due.getTime()) && due >= today && due < tomorrow
          } catch {
            return false
          }
        })
      case "unassigned":
        return queueItems.filter((i) => !i.followUp.ownerId)
      case "missed_calls":
        return queueItems.filter((i) => i.followUp.type === "missed_call")
      case "escalations":
        return queueItems.filter((i) => i.followUp.severity === "critical" || i.followUp.tags.includes("escalated"))
      case "high_severity":
        return queueItems.filter((i) => i.followUp.severity === "high" || i.followUp.severity === "critical")
      default:
        return queueItems
    }
  }, [queueItems, activeQueue])

  // Filter selectedIds to only include currently visible items
  const visibleSelectedIds = useMemo(() => {
    const filteredItemIds = new Set(filteredItems.map((i) => i.contactId))
    return selectedIds.filter((id) => filteredItemIds.has(id))
  }, [selectedIds, filteredItems])

  // Clear selection when queue or search changes
  useEffect(() => {
    if (prevQueueRef.current !== activeQueue || prevSearchRef.current !== searchQuery) {
      // Only clear if we're switching to a different queue or search changed
      // Keep selection if items are still visible in new filter
      setSelectedIds((prev) => {
        const filteredItemIds = new Set(filteredItems.map((i) => i.contactId))
        return prev.filter((id) => filteredItemIds.has(id))
      })
      prevQueueRef.current = activeQueue
      prevSearchRef.current = searchQuery
    }
  }, [activeQueue, searchQuery, filteredItems])

  // Queue counts
  const counts = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    return {
      all: queueItems.length,
      overdue: queueItems.filter((i) => i.isOverdue).length,
      today: queueItems.filter((i) => {
        const due = new Date(i.followUp.dueAt)
        return due >= today && due < tomorrow
      }).length,
      unassigned: queueItems.filter((i) => !i.followUp.ownerId).length,
      missed_calls: queueItems.filter((i) => i.followUp.type === "missed_call").length,
      escalations: queueItems.filter((i) => i.followUp.severity === "critical" || i.followUp.tags.includes("escalated"))
        .length,
      high_severity: queueItems.filter((i) => i.followUp.severity === "high" || i.followUp.severity === "critical")
        .length,
    }
  }, [queueItems])

  const getVerticalIcon = (vertical: string) => {
    switch (vertical) {
      case "AutoShop":
        return <Car className="h-3 w-3" />
      case "Restaurant":
        return <UtensilsCrossed className="h-3 w-3" />
      default:
        return null
    }
  }

  const getPriorityConfig = (severity: string) => {
    switch (severity) {
      case "critical":
        return {
          className: "bg-red-500/10 text-red-400 border-red-500/30 dark:bg-red-500/20 dark:text-red-300",
          icon: AlertCircle,
          iconClassName: "text-red-400",
        }
      case "high":
        return {
          className: "bg-orange-500/10 text-orange-400 border-orange-500/30 dark:bg-orange-500/20 dark:text-orange-300",
          icon: AlertTriangle,
          iconClassName: "text-orange-400",
        }
      case "medium":
        return {
          className: "bg-amber-500/10 text-amber-400 border-amber-500/30 dark:bg-amber-500/20 dark:text-amber-300",
          icon: Clock,
          iconClassName: "text-amber-400",
        }
      default:
        return {
          className: "bg-muted/50 text-muted-foreground border-muted",
          icon: Circle,
          iconClassName: "text-muted-foreground",
        }
    }
  }

  const getStatusConfig = (status: string, isOverdue: boolean) => {
    if (isOverdue) {
      return {
        className: "bg-red-500/10 text-red-400 border-red-500/30 dark:bg-red-500/20 dark:text-red-300",
        icon: XCircle,
        iconClassName: "text-red-400",
        label: "Overdue",
      }
    }

    switch (status) {
      case "open":
        return {
          className: "bg-blue-500/10 text-blue-400 border-blue-500/30 dark:bg-blue-500/20 dark:text-blue-300",
          icon: Circle,
          iconClassName: "text-blue-400",
          label: "Open",
        }
      case "in_progress":
        return {
          className: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 dark:bg-indigo-500/20 dark:text-indigo-300",
          icon: Clock,
          iconClassName: "text-indigo-400",
          label: "In Progress",
        }
      case "scheduled":
        return {
          className: "bg-purple-500/10 text-purple-400 border-purple-500/30 dark:bg-purple-500/20 dark:text-purple-300",
          icon: Calendar,
          iconClassName: "text-purple-400",
          label: "Scheduled",
        }
      case "snoozed":
        return {
          className: "bg-slate-500/10 text-slate-400 border-slate-500/30 dark:bg-slate-500/20 dark:text-slate-300",
          icon: Clock,
          iconClassName: "text-slate-400",
          label: "Snoozed",
        }
      case "done":
        return {
          className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 dark:bg-emerald-500/20 dark:text-emerald-300",
          icon: CheckCircle2,
          iconClassName: "text-emerald-400",
          label: "Done",
        }
      default:
        return {
          className: "bg-muted/50 text-muted-foreground border-muted",
          icon: Circle,
          iconClassName: "text-muted-foreground",
          label: status,
        }
    }
  }

  return (
    <div className="h-full flex flex-col border-r border-border bg-card/30">
      {/* Queue Tabs */}
      <div className="px-4 py-3 border-b border-border">
        <Tabs value={activeQueue} onValueChange={onQueueChange}>
          <TabsList className="w-full h-auto gap-1 bg-transparent p-0">
            <TabsTrigger value="all" className="h-7 px-2 text-xs data-[state=active]:bg-primary/10">
              All <span className="ml-1 text-muted-foreground">{counts.all}</span>
            </TabsTrigger>
            <TabsTrigger value="overdue" className="h-7 px-2 text-xs data-[state=active]:bg-primary/10">
              Overdue <span className="ml-1 text-red-400">{counts.overdue}</span>
            </TabsTrigger>
            <TabsTrigger value="today" className="h-7 px-2 text-xs data-[state=active]:bg-primary/10">
              Today <span className="ml-1 text-muted-foreground">{counts.today}</span>
            </TabsTrigger>
            <TabsTrigger value="high_severity" className="h-7 px-2 text-xs data-[state=active]:bg-primary/10">
              High Priority <span className="ml-1 text-orange-400">{counts.high_severity}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Bulk Actions Bar */}
      {visibleSelectedIds.length > 0 && (
        <div className="px-4 py-3 border-b border-primary/20 bg-primary/5 flex items-center gap-3 shadow-sm flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary flex-shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-medium text-foreground whitespace-nowrap">
              {visibleSelectedIds.length} {visibleSelectedIds.length === 1 ? "item" : "items"} selected
              {selectedIds.length > visibleSelectedIds.length && (
                <span className="text-xs text-muted-foreground ml-1">
                  ({selectedIds.length - visibleSelectedIds.length} hidden)
                </span>
              )}
            </span>
          </div>
          <div className="flex-1 min-w-0" />
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    onBulkMarkResolved?.(visibleSelectedIds)
                    clearSelection()
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  Mark Resolved
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Mark selected follow-ups as resolved</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    onBulkSnooze?.(visibleSelectedIds)
                    clearSelection()
                  }}
                >
                  <Clock className="h-3.5 w-3.5 mr-1.5" />
                  Snooze
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Snooze selected follow-ups for 1 hour</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    onBulkAddTag?.(visibleSelectedIds, "priority")
                    clearSelection()
                  }}
                >
                  <Tag className="h-3.5 w-3.5 mr-1.5" />
                  Add Tag
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add a tag to selected follow-ups</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={clearSelection}
                  aria-label="Clear selection"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Clear selection</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Queue List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isLoading ? (
            <>
              {/* Loading Skeletons */}
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg">
                  <Skeleton className="h-3.5 w-3.5 rounded mt-1" />
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-3 w-24" />
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-20 rounded-md" />
                      <Skeleton className="h-5 w-24 rounded-md" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : filteredItems.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">{"You're all caught up!"}</h3>
              <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
                No follow-ups need attention right now. Great work keeping on top of everything!
              </p>
              <div className="flex flex-col gap-2 items-center">
                <Button variant="outline" size="sm" className="text-xs">
                  <History className="h-3.5 w-3.5 mr-1.5" />
                  View Call History
                </Button>
                <p className="text-xs text-muted-foreground">New follow-ups will appear here automatically</p>
              </div>
            </div>
          ) : (
            <>
              {/* Select All */}
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/50 mb-2 bg-muted/30 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                  <Checkbox
                    ref={(el) => {
                      if (el) {
                        const filteredItemIds = filteredItems.map((i) => i.contactId)
                        const allSelected = filteredItemIds.length > 0 && filteredItemIds.every((id) => selectedIds.includes(id))
                        const someSelected = filteredItemIds.some((id) => selectedIds.includes(id)) && !allSelected
                        ;(el as HTMLButtonElement & { indeterminate: boolean }).indeterminate = someSelected
                      }
                    }}
                    checked={filteredItems.length > 0 && filteredItems.every((item) => selectedIds.includes(item.contactId))}
                    onCheckedChange={() => toggleSelectAll(filteredItems)}
                    className="h-4 w-4 flex-shrink-0"
                    aria-label={filteredItems.every((item) => selectedIds.includes(item.contactId)) ? "Deselect all" : "Select all"}
                  />
                  <span className="text-xs font-medium text-foreground whitespace-nowrap">
                    {filteredItems.length > 0 && filteredItems.every((item) => selectedIds.includes(item.contactId))
                      ? "Deselect all"
                      : "Select all"}
                  </span>
                </div>
                {visibleSelectedIds.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                          <Info className="h-3 w-3" />
                          <span className="text-xs font-medium">{visibleSelectedIds.length} selected</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Use bulk actions bar above to perform actions on selected items</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
              {filteredItems.map((item) => (
                <div
                  key={item.followUp.id}
                  className={cn(
                    "group relative flex items-start gap-3 p-3 rounded-lg border transition-all",
                    "hover:border-border hover:shadow-sm hover:bg-accent/30",
                    selectedContactId === item.contactId && "border-primary/50 bg-accent shadow-sm",
                    selectedIds.includes(item.contactId) && "border-primary/30 bg-primary/5",
                    item.isOverdue && "border-l-4 border-l-red-500/50",
                    !item.isOverdue && "border-l-4 border-l-transparent",
                  )}
                >
                  <Checkbox
                    checked={selectedIds.includes(item.contactId)}
                    onCheckedChange={() => toggleSelect(item.contactId)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-label={`Select ${item.contact.name || item.contact.phone}`}
                  />
                  <button
                    onClick={() => onSelectContact(item.contactId)}
                    className="flex-1 text-left focus:outline-none min-w-0"
                    aria-label={`View details for ${item.contact.name || item.contact.phone}`}
                  >
                    {/* Row 1: Name + VIP + Due */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {searchQuery && item.contact.name
                            ? (() => {
                                const match = scoreMatch(searchQuery, item.contact.name)
                                return highlightMatch(item.contact.name, match.ranges)
                              })()
                            : item.contact.name || item.contact.phone}
                        </span>
                        {item.contact.tags.includes("vip") && (
                          <Badge
                            variant="outline"
                            className="px-1.5 font-medium bg-amber-500/10 text-amber-400 border-amber-500/30 shrink-0"
                          >
                            VIP
                          </Badge>
                        )}
                      </div>
                      <div
                        className={cn(
                          "flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-md text-xs font-medium",
                          item.isOverdue
                            ? "bg-red-500/10 text-red-400 dark:bg-red-500/20 dark:text-red-300"
                            : "bg-muted/50 text-muted-foreground",
                        )}
                      >
                        {item.isOverdue && <AlertCircle className="h-3 w-3" />}
                        <span>{item.dueRelative}</span>
                      </div>
                    </div>

                    {/* Row 2: Phone */}
                    <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {searchQuery
                        ? (() => {
                            const match = scoreMatch(searchQuery, item.contact.phone)
                            return highlightMatch(item.contact.phone, match.ranges)
                          })()
                        : item.contact.phone}
                    </div>

                    {/* Row 3: Status + Priority + Human Required */}
                    <div className="flex items-center gap-1.5 flex-wrap mb-2">
                      {/* Status Badge */}
                      {(() => {
                        const statusConfig = getStatusConfig(item.followUp.status, item.isOverdue)
                        const StatusIcon = statusConfig.icon
                        return (
                          <Badge variant="outline" className={cn("px-2 gap-1 font-medium", statusConfig.className)}>
                            <StatusIcon className={cn("h-2.5 w-2.5", statusConfig.iconClassName)} />
                            {statusConfig.label}
                          </Badge>
                        )
                      })()}

                      {/* Priority Badge */}
                      {(() => {
                        const priorityConfig = getPriorityConfig(item.followUp.severity)
                        const PriorityIcon = priorityConfig.icon
                        return (
                          <Badge
                            variant="outline"
                            className={cn("px-2 gap-1 font-medium", priorityConfig.className)}
                          >
                            <PriorityIcon className={cn("h-2.5 w-2.5", priorityConfig.iconClassName)} />
                            {item.reason}
                          </Badge>
                        )
                      })()}

                      {item.humanRequired && (
                        <Badge
                          variant="outline"
                          className="px-2 gap-1 font-medium bg-orange-500/10 text-orange-400 border-orange-500/30 dark:bg-orange-500/20 dark:text-orange-300"
                        >
                          <User className="h-2.5 w-2.5" />
                          Human required
                        </Badge>
                      )}
                    </div>

                    {/* Row 4: Last touch + icons */}
                    <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/50">
                      {item.lastTouchText && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <History className="h-3 w-3" />
                          {item.lastTouchText}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 ml-auto">
                        {getVerticalIcon(item.followUp.vertical) && (
                          <span className="text-muted-foreground" title={`Vertical: ${item.followUp.vertical}`}>
                            {getVerticalIcon(item.followUp.vertical)}
                          </span>
                        )}
                        {item.channels.includes("sms") && (
                          <span title="SMS channel" className="inline-flex">
                            <MessageSquare className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                          </span>
                        )}
                        {item.channels.includes("ai_call") && (
                          <span title="AI Call channel" className="inline-flex">
                            <Bot className="h-3.5 w-3.5 text-blue-400" aria-hidden />
                          </span>
                        )}
                        {item.channels.includes("email") && (
                          <span title="Email channel" className="inline-flex">
                            <Mail className="h-3.5 w-3.5 text-purple-400" aria-hidden />
                          </span>
                        )}
                        {item.hasTranscript && (
                          <span title="Has transcript" className="inline-flex">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          </span>
                        )}
                        {item.lastAttemptFailed && (
                          <span title="Last attempt failed" className="inline-flex">
                            <AlertCircle className="h-3.5 w-3.5 text-red-400" aria-hidden />
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

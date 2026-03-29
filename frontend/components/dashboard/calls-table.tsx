"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { formatDistance } from "date-fns"
import { useToast } from "@/hooks/use-toast"
import {
  Search,
  MoreHorizontal,
  Eye,
  Download,
  ChevronDown,
  ArrowUpDown,
  Columns,
  AlertTriangle,
  PhoneIncoming,
  PhoneOutgoing,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CallRecord } from "@/types/api"

export type QuickFilter = "completed" | "handoff" | "dropped" | "failed" | "long" | "toolErrors" | null

const PAGE_SIZE = 10

interface CallsTableProps {
  calls: CallRecord[]
  loading?: boolean
  activeQuickFilter?: QuickFilter
  onQuickFilterChange?: (filter: QuickFilter) => void
  onCallClick?: (call: CallRecord) => void
}

const resultBadgeStyles: Record<CallRecord["result"], { class: string; label: string }> = {
  completed: { class: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20", label: "Completed" },
  handoff: { class: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20", label: "Handoff" },
  dropped: { class: "bg-muted text-muted-foreground border-muted", label: "Dropped" },
  systemFailed: { class: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20", label: "System Failed" },
}

export function CallsTable({
  calls,
  loading = false,
  activeQuickFilter,
  onQuickFilterChange,
  onCallClick,
}: CallsTableProps) {
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")
  const [sortField, setSortField] = useState<"startedAt" | "durationMs">("startedAt")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [visibleColumns, setVisibleColumns] = useState({
    time: true,
    caller: true,
    direction: true,
    duration: true,
    result: true,
    reason: true,
    tools: true,
    failureType: true,
  })
  const [currentPage, setCurrentPage] = useState(0)

  // Reset to first page when filters or sort change
  useEffect(() => {
    setCurrentPage(0)
  }, [searchQuery, activeQuickFilter, sortField, sortDirection])

  const formatDuration = (ms?: number) => {
    if (!ms) return "N/A"
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
  }

  const filteredCalls = calls.filter((call) => {
    const matchesSearch =
      call.callerNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.callId.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch) return false

    if (activeQuickFilter === "completed") return call.result === "completed"
    if (activeQuickFilter === "handoff") return call.result === "handoff"
    if (activeQuickFilter === "dropped") return call.result === "dropped"
    if (activeQuickFilter === "failed") return call.result === "systemFailed"
    if (activeQuickFilter === "long") return (call.durationMs || 0) > 180000 // > 3 minutes
    if (activeQuickFilter === "toolErrors") return (call.toolErrors || 0) > 0

    return true
  })

  const sortedCalls = [...filteredCalls].sort((a, b) => {
    const multiplier = sortDirection === "asc" ? 1 : -1
    if (sortField === "startedAt") {
      return multiplier * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    }
    return multiplier * ((a.durationMs || 0) - (b.durationMs || 0))
  })

  const totalPages = Math.max(1, Math.ceil(sortedCalls.length / PAGE_SIZE))
  const paginatedCalls = sortedCalls.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  )

  const toggleSort = (field: "startedAt" | "durationMs") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const quickFilters: { value: QuickFilter; label: string; count?: number }[] = [
    { value: "completed", label: "Completed", count: calls.filter((c) => c.result === "completed").length },
    { value: "handoff", label: "Handoff", count: calls.filter((c) => c.result === "handoff").length },
    { value: "dropped", label: "Dropped", count: calls.filter((c) => c.result === "dropped").length },
    { value: "failed", label: "System Failed", count: calls.filter((c) => c.result === "systemFailed").length },
    { value: "long", label: "Long calls", count: calls.filter((c) => (c.durationMs || 0) > 180000).length },
    { value: "toolErrors", label: "Tool errors", count: calls.filter((c) => (c.toolErrors || 0) > 0).length },
  ]

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Recent Calls</CardTitle>
            <CardDescription>View and filter recent call activity</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search calls..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-[200px] pl-8"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 bg-transparent">
                  <Columns className="mr-2 h-4 w-4" />
                  Columns
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {Object.entries(visibleColumns).map(([key, value]) => (
                  <DropdownMenuCheckboxItem
                    key={key}
                    checked={value}
                    onCheckedChange={(checked) => setVisibleColumns((prev) => ({ ...prev, [key]: checked }))}
                  >
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Quick Filter Chips */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <span className="text-xs text-muted-foreground">Quick filters:</span>
          {quickFilters.map((filter) => (
            <Badge
              key={filter.value}
              variant={activeQuickFilter === filter.value ? "default" : "outline"}
              className={cn(
                "cursor-pointer transition-colors",
                activeQuickFilter === filter.value && "bg-primary text-primary-foreground",
              )}
              onClick={() => onQuickFilterChange?.(activeQuickFilter === filter.value ? null : filter.value)}
            >
              {filter.label}
              {filter.count !== undefined && filter.count > 0 && (
                <span className="ml-1 text-xs opacity-70">({filter.count})</span>
              )}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.time && (
                  <TableHead>
                    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => toggleSort("startedAt")}>
                      Time
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                )}
                {visibleColumns.caller && <TableHead>Caller</TableHead>}
                {visibleColumns.direction && <TableHead>Dir</TableHead>}
                {visibleColumns.duration && (
                  <TableHead>
                    <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => toggleSort("durationMs")}>
                      Duration
                      <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                  </TableHead>
                )}
                {visibleColumns.result && <TableHead>Result</TableHead>}
                {visibleColumns.reason && <TableHead>Reason</TableHead>}
                {visibleColumns.tools && <TableHead>Tools</TableHead>}
                {visibleColumns.failureType && <TableHead>Failure Type</TableHead>}
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCalls.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={Object.values(visibleColumns).filter(Boolean).length + 1}
                    className="h-24 text-center"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-muted-foreground">No calls found</p>
                      {activeQuickFilter && (
                        <Button variant="outline" size="sm" onClick={() => onQuickFilterChange?.(null)}>
                          Clear filter
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedCalls.map((call) => (
                  <TableRow
                    key={call.callId}
                    className="group cursor-pointer hover:bg-muted/50"
                    onClick={() => onCallClick?.(call)}
                  >
                    {visibleColumns.time && (
                      <TableCell>
                        <span className="text-sm">
                          {formatDistance(new Date(call.startedAt), new Date(), { addSuffix: true })}
                        </span>
                      </TableCell>
                    )}
                    {visibleColumns.caller && (
                      <TableCell className="font-mono text-sm">{call.callerNumber || "Unknown"}</TableCell>
                    )}
                    {visibleColumns.direction && (
                      <TableCell>
                        {call.direction === "inbound" ? (
                          <PhoneIncoming className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <PhoneOutgoing className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                    )}
                    {visibleColumns.duration && (
                      <TableCell className="font-medium">{formatDuration(call.durationMs)}</TableCell>
                    )}
                    {visibleColumns.result && (
                      <TableCell>
                        <Badge variant="outline" className={resultBadgeStyles[call.result].class}>
                          {resultBadgeStyles[call.result].label}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleColumns.reason && (
                      <TableCell className="text-sm text-muted-foreground">{call.endReason || "—"}</TableCell>
                    )}
                    {visibleColumns.tools && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm">{call.toolsUsed?.length || 0}</span>
                          {(call.toolErrors || 0) > 0 && <AlertTriangle className="h-3.5 w-3.5 text-red-500" />}
                        </div>
                      </TableCell>
                    )}
                    {visibleColumns.failureType && (
                      <TableCell className="text-sm text-muted-foreground">
                        {call.result === "systemFailed" ? call.failureType || "Unknown" : "—"}
                      </TableCell>
                    )}
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onCallClick?.(call)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation()
                              toast({ title: "Coming soon", description: "Download transcript is not yet available." })
                            }}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Download transcript
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-muted-foreground">
            Showing {sortedCalls.length === 0 ? 0 : currentPage * PAGE_SIZE + 1}-
            {Math.min((currentPage + 1) * PAGE_SIZE, sortedCalls.length)} of {sortedCalls.length} calls
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

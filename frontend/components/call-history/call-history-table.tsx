"use client"

import { useState } from "react"
import { format } from "date-fns"
import { ArrowUpDown, ArrowUp, ArrowDown, PhoneIncoming, PhoneOutgoing, AlertTriangle, Settings2 } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CallRecord } from "@/types/api"

interface CallHistoryTableProps {
  calls: CallRecord[]
  isLoading?: boolean
  onRowClick: (call: CallRecord) => void
  selectedIds?: string[]
  onSelectRow?: (callId: string, checked: boolean) => void
}

type SortKey = "startedAt" | "duration" | "outcome" | "turns" | "tools"
type SortDirection = "asc" | "desc"

const defaultColumns = {
  dateTime: true,
  caller: true,
  intent: true,
  direction: true,
  duration: true,
  result: true,
  endReason: true,
  phoneLine: false,
  turns: false,
  tools: false,
}

export function CallHistoryTable({ calls, isLoading, onRowClick, selectedIds, onSelectRow }: CallHistoryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("startedAt")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [visibleColumns, setVisibleColumns] = useState(defaultColumns)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortKey(key)
      setSortDirection("desc")
    }
  }

  const sortedCalls = [...calls].sort((a, b) => {
    const modifier = sortDirection === "asc" ? 1 : -1
    switch (sortKey) {
      case "startedAt":
        return modifier * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      case "duration":
        return modifier * (a.durationMs - b.durationMs)
      case "turns":
        return modifier * ((a.turnCount ?? 0) - (b.turnCount ?? 0))
      case "tools":
        return modifier * (a.toolsUsed.length - b.toolsUsed.length)
      default:
        return 0
    }
  })

  const paginatedCalls = sortedCalls.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const totalPages = Math.ceil(calls.length / pageSize)

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="ml-1 h-4 w-4 opacity-50" />
    return sortDirection === "asc" ? <ArrowUp className="ml-1 h-4 w-4" /> : <ArrowDown className="ml-1 h-4 w-4" />
  }

  const resultConfig: Record<string, { label: string; className: string }> = {
    completed: { label: "Completed", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
    handoff: { label: "Handoff", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    dropped: { label: "Dropped", className: "bg-muted text-muted-foreground border-muted" },
    systemFailed: { label: "System Failed", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  }

  const getResultBadge = (result: string) => {
    const config = resultConfig[result] || { label: result, className: "" }
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    )
  }

  const getEndReasonBadge = (reason: string) => {
    return (
      <Badge variant="outline" className="text-xs font-normal">
        {reason.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
      </Badge>
    )
  }

  const formatDuration = (ms: number) => {
    if (!ms) return "—"
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    )
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-3 mb-4">
          <PhoneIncoming className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium">No calls match these filters</h3>
        <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or date range</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {calls.length} call{calls.length !== 1 ? "s" : ""} found
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings2 className="mr-2 h-4 w-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {Object.entries(visibleColumns).map(([key, visible]) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={visible}
                onCheckedChange={(checked) => setVisibleColumns({ ...visibleColumns, [key]: checked })}
              >
                {key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {onSelectRow && selectedIds !== undefined && (
                <TableHead className="w-10">
                  <span className="sr-only">Select row</span>
                </TableHead>
              )}
              {visibleColumns.dateTime && (
                <TableHead>
                  <button className="flex items-center hover:text-foreground" onClick={() => handleSort("startedAt")}>
                    Date & Time
                    <SortIcon column="startedAt" />
                  </button>
                </TableHead>
              )}
              {visibleColumns.caller && <TableHead>Caller</TableHead>}
              {visibleColumns.intent && <TableHead>Intent</TableHead>}
              {visibleColumns.direction && <TableHead>Direction</TableHead>}
              {visibleColumns.duration && (
                <TableHead>
                  <button className="flex items-center hover:text-foreground" onClick={() => handleSort("duration")}>
                    Duration
                    <SortIcon column="duration" />
                  </button>
                </TableHead>
              )}
              {visibleColumns.result && <TableHead>Result</TableHead>}
              {visibleColumns.endReason && <TableHead>End Reason</TableHead>}
              {visibleColumns.phoneLine && <TableHead>Phone Line</TableHead>}
              {visibleColumns.turns && (
                <TableHead>
                  <button className="flex items-center hover:text-foreground" onClick={() => handleSort("turns")}>
                    Turns
                    <SortIcon column="turns" />
                  </button>
                </TableHead>
              )}
              {visibleColumns.tools && (
                <TableHead>
                  <button className="flex items-center hover:text-foreground" onClick={() => handleSort("tools")}>
                    Tools
                    <SortIcon column="tools" />
                  </button>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedCalls.map((call) => {
              const hasToolErrors = call.toolsUsed.some((t) => !t.success)
              return (
                <TableRow
                  key={call.callId}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onRowClick(call)}
                >
                  {onSelectRow && selectedIds !== undefined && (
                    <TableCell
                      className="w-10"
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                    >
                      <Checkbox
                        checked={selectedIds.includes(call.callId)}
                        onCheckedChange={(c) => onSelectRow(call.callId, c === true)}
                        aria-label={`Select call ${call.callId}`}
                      />
                    </TableCell>
                  )}
                  {visibleColumns.dateTime && (
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{format(new Date(call.startedAt), "MMM d, yyyy")}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(call.startedAt), "h:mm:ss a")}
                        </span>
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.caller && (
                    <TableCell>
                      <div className="flex flex-col">
                        {call.callerName && <span className="font-medium">{call.callerName}</span>}
                        <span className="font-mono text-sm text-muted-foreground">{call.callerNumber}</span>
                      </div>
                    </TableCell>
                  )}
                  {visibleColumns.intent && (
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {call.intent ?? "Unknown"}
                      </Badge>
                    </TableCell>
                  )}
                  {visibleColumns.direction && (
                    <TableCell>
                      {call.direction === "inbound" ? (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <PhoneIncoming className="h-4 w-4" />
                          <span className="text-sm">In</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <PhoneOutgoing className="h-4 w-4" />
                          <span className="text-sm">Out</span>
                        </div>
                      )}
                    </TableCell>
                  )}
                  {visibleColumns.duration && (
                    <TableCell className="font-mono">{formatDuration(call.durationMs)}</TableCell>
                  )}
                  {visibleColumns.result && <TableCell>{getResultBadge(call.result)}</TableCell>}
                  {visibleColumns.endReason && <TableCell>{getEndReasonBadge(call.endReason ?? "—")}</TableCell>}
                  {visibleColumns.phoneLine && (
                    <TableCell className="font-mono text-sm">{call.phoneLineNumber}</TableCell>
                  )}
                  {visibleColumns.turns && <TableCell>{call.turnCount ?? 0}</TableCell>}
                  {visibleColumns.tools && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <span>{call.toolsUsed.length}</span>
                        {hasToolErrors && <AlertTriangle className="h-4 w-4 text-destructive" />}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

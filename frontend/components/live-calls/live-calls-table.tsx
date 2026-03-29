"use client"

import { useState, useEffect } from "react"
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  AlertTriangle,
  Clock,
  MoreHorizontal,
  Eye,
  Flag,
  PhoneOff,
  ArrowRightLeft,
  ListTodo,
  Copy,
  Bell,
  Tag,
  Loader2,
} from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import type { LiveCall } from "@/types/api"

interface LiveCallsTableProps {
  calls: LiveCall[]
  isLoading?: boolean
  onCallClick: (call: LiveCall) => void
  selectedCallId?: string
  pauseReorder?: boolean
  onTransfer?: (callId: string) => void
  onCreateAction?: (callId: string) => void
  onEndCall?: (callId: string) => void
  onFlagForReview?: (callId: string) => void
  onViewHistory?: () => void
  loadingActions?: Record<string, boolean>
}

function LiveDuration({ startedAt }: { startedAt: string | Date }) {
  const [duration, setDuration] = useState(0)
  const startedMs = typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime()

  useEffect(() => {
    const updateDuration = () => {
      const now = Date.now()
      const elapsed = Math.floor((now - startedMs) / 1000)
      setDuration(elapsed)
    }
    updateDuration()
    const interval = setInterval(updateDuration, 1000)
    return () => clearInterval(interval)
  }, [startedMs])

  const mins = Math.floor(duration / 60)
  const secs = duration % 60
  return (
    <span className="font-mono tabular-nums">
      {mins}:{secs.toString().padStart(2, "0")}
    </span>
  )
}

export function LiveCallsTable({ calls, isLoading, onCallClick, selectedCallId, pauseReorder, onTransfer, onCreateAction, onEndCall, onFlagForReview, onViewHistory, loadingActions = {} }: LiveCallsTableProps) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [endCallDialogOpen, setEndCallDialogOpen] = useState(false)
  const [callToEnd, setCallToEnd] = useState<LiveCall | null>(null)
  const stateConfig: Record<string, { label: string; icon: typeof Phone; color: string }> = {
    ringing: {
      label: "Ringing",
      icon: PhoneIncoming,
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    active: {
      label: "Active",
      icon: Phone,
      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    at_risk: {
      label: "At Risk",
      icon: AlertTriangle,
      color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    },
    handoff_requested: {
      label: "Handoff Requested",
      icon: AlertTriangle,
      color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    },
    error: {
      label: "Error",
      icon: AlertTriangle,
      color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">State</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead className="w-[80px]">Direction</TableHead>
              <TableHead>Last Event</TableHead>
              <TableHead>Risk Flags</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-6 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-12" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-8 w-8 rounded" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16">
        <Phone className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium">No active calls right now</h3>
        <p className="text-sm text-muted-foreground mt-1">When calls come in, they will appear here</p>
        <Button variant="outline" className="mt-4 bg-transparent" onClick={onViewHistory}>
          View Call History
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">State</TableHead>
            <TableHead className="w-[100px]">Duration</TableHead>
            <TableHead>Caller</TableHead>
            <TableHead>Intent</TableHead>
            <TableHead className="w-[80px]">Direction</TableHead>
            <TableHead>Last Event</TableHead>
            <TableHead>Risk Flags</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => {
            const config = stateConfig[call.state] || stateConfig.active
            const StateIcon = config.icon
            const isSelected = selectedCallId === call.callId
            const isHovered = hoveredRow === call.callId
            const showQuickActions = (call.state === "at_risk" || call.state === "handoff_requested" || call.state === "error") && isHovered

            return (
              <TableRow
                key={call.callId}
                className={cn("cursor-pointer transition-colors group", isSelected && "bg-muted/50")}
                onClick={() => onCallClick(call)}
                onMouseEnter={() => setHoveredRow(call.callId)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                <TableCell>
                  <Badge className={cn("gap-1.5 font-medium", config.color)}>
                    <StateIcon className="h-3 w-3" />
                    {config.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <LiveDuration startedAt={call.startedAt} />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{call.callerNumber}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="font-normal">
                    {(call as any).intent || "Unknown"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {call.direction === "inbound" ? (
                      <PhoneIncoming className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <PhoneOutgoing className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs text-muted-foreground capitalize">{call.direction}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{call.lastEvent}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {call.riskFlags.map((flag) => (
                      <Badge key={flag} variant="destructive" className="text-xs px-1.5 py-0">
                        {flag.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {/* Quick actions for problematic calls */}
                    {showQuickActions && (
                      <div className="flex items-center gap-1 mr-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            onCallClick(call)
                          }}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          Inspect
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs bg-transparent"
                          disabled={loadingActions[`createAction-${call.callId}`]}
                          onClick={(e) => {
                            e.stopPropagation()
                            onCreateAction?.(call.callId)
                          }}
                        >
                          {loadingActions[`createAction-${call.callId}`] ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <ListTodo className="h-3.5 w-3.5 mr-1" />
                          )}
                          Create Action
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs bg-transparent"
                          disabled={loadingActions[`transfer-${call.callId}`]}
                          onClick={(e) => {
                            e.stopPropagation()
                            onTransfer?.(call.callId)
                          }}
                        >
                          {loadingActions[`transfer-${call.callId}`] ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                          )}
                          Transfer
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive bg-transparent"
                          disabled={loadingActions[`endCall-${call.callId}`]}
                          onClick={(e) => {
                            e.stopPropagation()
                            setCallToEnd(call)
                            setEndCallDialogOpen(true)
                          }}
                        >
                          {loadingActions[`endCall-${call.callId}`] ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          ) : (
                            <PhoneOff className="h-3.5 w-3.5 mr-1" />
                          )}
                          End
                        </Button>
                      </div>
                    )}
                    
                    {/* Kebab menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            navigator.clipboard.writeText(call.callId)
                          }}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy call ID
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            // In a real app, this would open a tag selection modal
                            navigator.clipboard.writeText(call.callId)
                          }}
                        >
                          <Tag className="h-4 w-4 mr-2" />
                          Add tag
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            // In a real app, this would open a notification modal
                          }}
                        >
                          <Bell className="h-4 w-4 mr-2" />
                          Notify owner
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCallClick(call) }}>
                          <Eye className="h-4 w-4 mr-2" />
                          Inspect
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation()
                            onFlagForReview?.(call.callId)
                          }}
                          disabled={loadingActions[`flag-${call.callId}`]}
                        >
                          {loadingActions[`flag-${call.callId}`] ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Flag className="h-4 w-4 mr-2" />
                          )}
                          Flag for review
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

      {/* End Call Confirmation Dialog */}
      <AlertDialog open={endCallDialogOpen} onOpenChange={setEndCallDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End Call?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to end the call with {callToEnd?.callerNumber}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (callToEnd) {
                  onEndCall?.(callToEnd.callId)
                  setCallToEnd(null)
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              End Call
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

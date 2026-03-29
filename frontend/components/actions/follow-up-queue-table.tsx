"use client"

import type React from "react"
import { formatDistanceToNow } from "date-fns"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { AlertCircle, AlertTriangle, CheckCircle, Clock, MoreHorizontal, User } from "lucide-react"
import { useActionsState, type FollowUp, type Severity, type FollowUpStatus } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/empty-state"

interface FollowUpQueueTableProps {
  followUps: FollowUp[]
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  onRowClick: (followUp: FollowUp) => void
}

const severityConfig: Record<Severity, { icon: typeof AlertCircle; color: string }> = {
  critical: { icon: AlertCircle, color: "text-red-500" },
  high: { icon: AlertTriangle, color: "text-orange-500" },
  medium: { icon: Clock, color: "text-amber-500" },
  low: { icon: CheckCircle, color: "text-gray-400" },
}

const statusConfig: Record<
  FollowUpStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  open: { label: "Open", variant: "default" },
  in_progress: { label: "In Progress", variant: "secondary" },
  waiting_on_customer: { label: "Waiting", variant: "outline" },
  scheduled: { label: "Scheduled", variant: "outline" },
  snoozed: { label: "Snoozed", variant: "outline" },
  done: { label: "Done", variant: "secondary" },
  failed: { label: "Failed", variant: "destructive" },
  canceled: { label: "Canceled", variant: "outline" },
}

const typeLabels: Record<string, string> = {
  missed_call: "Missed Call",
  booking: "Booking",
  estimate_approval: "Estimate",
  ready_pickup: "Pickup Ready",
  payment_pending: "Payment",
  reservation: "Reservation",
  catering: "Catering",
  large_party: "Large Party",
  complaint: "Complaint",
  order_issue: "Order Issue",
  general: "General",
}

export function FollowUpQueueTable({ followUps, selectedIds, onSelect, onRowClick }: FollowUpQueueTableProps) {
  const { state, dispatch, getContact } = useActionsState()
  const { toast } = useToast()

  const handleSelectAll = (checked: boolean) => {
    onSelect(checked ? followUps.map((f) => f.id) : [])
  }

  const handleSelectRow = (id: string, checked: boolean) => {
    onSelect(checked ? [...selectedIds, id] : selectedIds.filter((i) => i !== id))
  }

  const handleClaim = (e: React.MouseEvent, fu: FollowUp) => {
    e.stopPropagation()
    dispatch({ type: "UPDATE_FOLLOW_UP", id: fu.id, updates: { ownerId: "current_user", status: "in_progress" } })
    toast({ title: "Follow-up claimed", description: "Assigned to you" })
  }

  const handleSnooze = (e: React.MouseEvent, fu: FollowUp, duration: string) => {
    e.stopPropagation()
    let dueAt: Date
    switch (duration) {
      case "1h":
        dueAt = new Date(Date.now() + 60 * 60 * 1000)
        break
      case "tomorrow":
        dueAt = new Date()
        dueAt.setDate(dueAt.getDate() + 1)
        dueAt.setHours(9, 0, 0, 0)
        break
      case "week":
        dueAt = new Date()
        dueAt.setDate(dueAt.getDate() + 7)
        break
      default:
        dueAt = new Date(Date.now() + 60 * 60 * 1000)
    }
    dispatch({ type: "UPDATE_FOLLOW_UP", id: fu.id, updates: { status: "snoozed", dueAt: dueAt.toISOString() } })
    toast({ title: "Follow-up snoozed" })
  }

  const handleComplete = (e: React.MouseEvent, fu: FollowUp) => {
    e.stopPropagation()
    dispatch({ type: "UPDATE_FOLLOW_UP", id: fu.id, updates: { status: "done" } })
    toast({ title: "Follow-up completed" })
  }

  if (followUps.length === 0) {
    return (
      <EmptyState
        title="No follow-ups found"
        description="Try adjusting your filters or create a new follow-up."
        variant="search"
      />
    )
  }

  return (
    <div className="rounded-md border">
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={selectedIds.length === followUps.length && followUps.length > 0}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="w-10"></TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Vertical</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Next Step</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[120px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {followUps.map((fu) => {
              const contact = getContact(fu.contactId)
              const SeverityIcon = severityConfig[fu.severity].icon
              const isOverdue = new Date(fu.dueAt) < new Date() && !["done", "canceled", "failed"].includes(fu.status)
              const dueDate = new Date(fu.dueAt)

              return (
                <TableRow
                  key={fu.id}
                  className={cn("cursor-pointer hover:bg-muted/50", isOverdue && "bg-red-500/5")}
                  onClick={() => onRowClick(fu)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(fu.id)}
                      onCheckedChange={(checked) => handleSelectRow(fu.id, !!checked)}
                      aria-label={`Select ${fu.id}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger>
                        <SeverityIcon className={cn("h-4 w-4", severityConfig[fu.severity].color)} />
                      </TooltipTrigger>
                      <TooltipContent>{fu.severity} severity</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                        {contact?.name ? (
                          <span className="text-xs font-medium">
                            {contact.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .slice(0, 2)}
                          </span>
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{contact?.name || "Unknown"}</p>
                        <p className="text-xs text-muted-foreground">{contact?.phone}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {typeLabels[fu.type] || fu.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs",
                        fu.vertical === "AutoShop" && "bg-blue-500/10 text-blue-700",
                        fu.vertical === "Restaurant" && "bg-green-500/10 text-green-700",
                        fu.vertical === "Common" && "bg-gray-500/10 text-gray-700",
                      )}
                    >
                      {fu.vertical}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger>
                        <span className={cn("text-sm", isOverdue && "text-red-500 font-medium")}>
                          {isOverdue ? "Overdue " : ""}
                          {formatDistanceToNow(dueDate, { addSuffix: true })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{dueDate.toLocaleString()}</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {fu.ownerId === "current_user"
                        ? "You"
                        : fu.ownerId === "manager"
                          ? "Manager"
                          : fu.ownerId || "Unassigned"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground truncate max-w-[150px] block">
                      {fu.recommendedNextStep || "-"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusConfig[fu.status].variant}>{statusConfig[fu.status].label}</Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {!fu.ownerId && (
                        <Button variant="ghost" size="sm" onClick={(e) => handleClaim(e, fu)}>
                          Claim
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => handleClaim(e as any, fu)}>Claim</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => handleSnooze(e as any, fu, "1h")}>
                            Snooze 1 Hour
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => handleSnooze(e as any, fu, "tomorrow")}>
                            Snooze Until Tomorrow
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={(e) => handleSnooze(e as any, fu, "week")}>
                            Snooze 1 Week
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => handleComplete(e as any, fu)}>
                            Mark Complete
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
      </TooltipProvider>
    </div>
  )
}

"use client"

import type React from "react"

import { useState, useMemo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  User,
  Phone,
  UserPlus,
  CheckCircle2,
  Clock,
  StickyNote,
  Ban,
  ChevronDown,
  ChevronRight,
  Copy,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  MessageSquare,
  Mail,
  Bot,
  Car,
  UtensilsCrossed,
  Calendar,
  DollarSign,
  Users,
  FileText,
} from "lucide-react"
import type { Contact, Call, FollowUp } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"

interface ContactContextPanelProps {
  contact: Contact | null
  calls: Call[]
  followUps: FollowUp[]
  selectedEventId: string | null
  onSelectEvent: (eventId: string, type: "call" | "followup") => void
  onAssignOwner: () => void
  onMarkResolved: () => void
  onSnooze: () => void
  onAddNote: () => void
  onBlocklist: () => void
}

export function ContactContextPanel({
  contact,
  calls,
  followUps,
  selectedEventId,
  onSelectEvent,
  onAssignOwner,
  onMarkResolved,
  onSnooze,
  onAddNote,
  onBlocklist,
}: ContactContextPanelProps) {
  const { toast } = useToast()
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [fieldsOpen, setFieldsOpen] = useState(true)

  // Get latest call for AI summary
  const latestCall = useMemo(() => {
    if (calls.length === 0) return null
    return calls.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0]
  }, [calls])

  // Aggregate extracted fields from all calls
  const extractedFields = useMemo(() => {
    const fields: Record<string, string> = {}
    calls.forEach((call) => {
      Object.entries(call.extractedFields).forEach(([key, value]) => {
        if (value) fields[key] = value
      })
    })
    return fields
  }, [calls])

  // Build timeline events
  const timelineEvents = useMemo(() => {
    const events: Array<{
      id: string
      type: "call" | "sms" | "email" | "note" | "workflow"
      time: string
      title: string
      subtitle?: string
      outcome?: string
      duration?: number
      icon: React.ReactNode
    }> = []

    // Add calls
    calls.forEach((call) => {
      const outcomeColors: Record<string, string> = {
        handled: "bg-emerald-500/20 text-emerald-400",
        missed: "bg-red-500/20 text-red-400",
        abandoned: "bg-amber-500/20 text-amber-400",
        failed: "bg-red-500/20 text-red-400",
        escalated: "bg-orange-500/20 text-orange-400",
      }

      events.push({
        id: call.id,
        type: "call",
        time: call.time,
        title: call.direction === "inbound" ? "Inbound Call" : "Outbound Call",
        subtitle: call.summary,
        outcome: call.outcome,
        duration: call.durationSec,
        icon:
          call.outcome === "missed" ? (
            <PhoneMissed className="h-4 w-4 text-red-400" />
          ) : call.direction === "inbound" ? (
            <PhoneIncoming className="h-4 w-4 text-blue-400" />
          ) : (
            <PhoneOutgoing className="h-4 w-4 text-emerald-400" />
          ),
      })
    })

    // Add follow-up attempts as SMS/Email events
    followUps.forEach((fu) => {
      fu.attempts.forEach((attempt) => {
        events.push({
          id: attempt.id,
          type: attempt.type === "sms" ? "sms" : attempt.type === "email" ? "email" : "workflow",
          time: attempt.time,
          title:
            attempt.type === "sms"
              ? "SMS Sent"
              : attempt.type === "email"
                ? "Email Sent"
                : attempt.type === "ai_call"
                  ? "AI Call"
                  : "Manual Action",
          subtitle: attempt.note,
          outcome: attempt.result,
          icon:
            attempt.type === "sms" ? (
              <MessageSquare className="h-4 w-4 text-emerald-400" />
            ) : attempt.type === "email" ? (
              <Mail className="h-4 w-4 text-purple-400" />
            ) : attempt.type === "ai_call" ? (
              <Bot className="h-4 w-4 text-blue-400" />
            ) : (
              <User className="h-4 w-4 text-muted-foreground" />
            ),
        })
      })
    })

    return events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  }, [calls, followUps])

  const copyToClipboard = useCallback((text: string, label: string) => {
    try {
      navigator.clipboard.writeText(text)
      toast({ title: `${label} copied` })
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Unable to copy to clipboard. Please try again.",
        variant: "destructive",
      })
      console.error("Failed to copy to clipboard:", error)
    }
  }, [toast])

  const formatDuration = useCallback((seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }, [])

  const formatTime = useCallback((isoString: string) => {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    if (diffMins > 0) return `${diffMins}m ago`
    return "Just now"
  }, [])

  const getFieldIcon = useCallback((key: string) => {
    const lower = key.toLowerCase()
    if (lower.includes("vehicle") || lower.includes("car")) return <Car className="h-3 w-3" />
    if (lower.includes("date") || lower.includes("time") || lower.includes("appointment"))
      return <Calendar className="h-3 w-3" />
    if (lower.includes("party") || lower.includes("headcount") || lower.includes("guest"))
      return <Users className="h-3 w-3" />
    if (lower.includes("payment") || lower.includes("price") || lower.includes("amount") || lower.includes("invoice"))
      return <DollarSign className="h-3 w-3" />
    if (lower.includes("order") || lower.includes("ticket")) return <FileText className="h-3 w-3" />
    return <FileText className="h-3 w-3" />
  }, [])

  // Get active follow-up for case header
  const activeFollowUp = useMemo(() => {
    return followUps.find((f) => !["done", "canceled"].includes(f.status)) || null
  }, [followUps])

  // Calculate SLA status
  const slaStatus = useMemo(() => {
    if (!activeFollowUp) return null
    const now = new Date()
    const dueDate = new Date(activeFollowUp.dueAt)
    const diffMs = dueDate.getTime() - now.getTime()
    const isOverdue = diffMs < 0

    const absDiffMs = Math.abs(diffMs)
    const mins = Math.floor(absDiffMs / 60000)
    const hours = Math.floor(mins / 60)

    if (isOverdue) {
      return { text: hours > 0 ? `Overdue ${hours}h` : `Overdue ${mins}m`, isOverdue: true }
    }
    return { text: hours > 0 ? `Due in ${hours}h` : `Due in ${mins}m`, isOverdue: false }
  }, [activeFollowUp])

  // Get reason label
  const reasonLabel = useMemo(() => {
    if (!activeFollowUp) return null
    const reasonMap: Record<string, string> = {
      missed_call: "Missed call",
      booking: "Booking confirmation",
      estimate_approval: "Estimate approval",
      ready_pickup: "Ready for pickup",
      payment_pending: "Payment pending",
      large_party: "Large party",
      catering: "Catering inquiry",
      complaint: "Complaint",
      reservation: "Reservation",
      order_issue: "Order issue",
      general: "General follow-up",
    }
    return reasonMap[activeFollowUp.type] || activeFollowUp.type
  }, [activeFollowUp])

  // Empty state
  if (!contact) {
    return (
      <div className="h-full flex items-center justify-center bg-background/50">
        <div className="text-center p-8">
          <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <User className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-1">No contact selected</h3>
          <p className="text-sm text-muted-foreground">Select an item from the queue to view contact details</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background/50">
      {/* Case Header */}
      {activeFollowUp && (
        <div className="px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Reason */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Reason</span>
              <Badge
                variant="outline"
                className={cn(
                  activeFollowUp.type === "complaint"
                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                    : "bg-muted text-foreground",
                )}
              >
                {reasonLabel}
              </Badge>
            </div>

            {/* Sentiment */}
            {latestCall?.sentiment && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Sentiment</span>
                <Badge
                  variant="outline"
                  className={cn(
                    latestCall.sentiment === "positive" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                    latestCall.sentiment === "negative" && "bg-red-500/10 text-red-400 border-red-500/30",
                    latestCall.sentiment === "neutral" && "bg-muted text-muted-foreground",
                  )}
                >
                  {latestCall.sentiment}
                </Badge>
              </div>
            )}

            {/* SLA / Due */}
            {slaStatus && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">SLA</span>
                <Badge
                  variant="outline"
                  className={cn(
                    slaStatus.isOverdue
                      ? "bg-red-500/10 text-red-400 border-red-500/30"
                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                  )}
                >
                  {slaStatus.text}
                </Badge>
              </div>
            )}

            {/* Last Event */}
            {timelineEvents[0] && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Last</span>
                <span className="text-xs text-foreground">{timelineEvents[0].title}</span>
                <span className="text-[10px] text-muted-foreground">{formatTime(timelineEvents[0].time)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contact Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold text-foreground truncate">{contact.name || "Unknown"}</h2>
              {contact.tags.includes("vip") && (
                <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                  VIP
                </Badge>
              )}
              {contact.tags.includes("returning") && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">
                  Returning
                </Badge>
              )}
              {!contact.lastContactedAt && (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  New
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              <span>{contact.phone}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => copyToClipboard(contact.phone, "Phone")}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {/* Vertical indicator */}
          {followUps[0]?.vertical && (
            <Badge variant="outline" className="shrink-0">
              {followUps[0].vertical === "AutoShop" && <Car className="h-3 w-3 mr-1" />}
              {followUps[0].vertical === "Restaurant" && <UtensilsCrossed className="h-3 w-3 mr-1" />}
              {followUps[0].vertical}
            </Badge>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={onAssignOwner} aria-label="Assign follow-up to yourself">
            <UserPlus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Assign
          </Button>
          <Button variant="outline" size="sm" onClick={onMarkResolved} aria-label="Mark follow-up as resolved">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Mark Resolved
          </Button>
          <Button variant="outline" size="sm" onClick={onSnooze} aria-label="Snooze follow-up for 1 hour">
            <Clock className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Snooze
          </Button>
          <Button variant="outline" size="sm" onClick={onAddNote} aria-label="Add note to follow-up">
            <StickyNote className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Add Note
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={onBlocklist}
            aria-label="Blocklist contact to prevent automated messages"
          >
            <Ban className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Blocklist
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* AI Summary */}
          {latestCall?.summary && (
            <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen}>
              <Card className="border-border/50">
                <CollapsibleTrigger asChild>
                  <CardHeader className="py-3 px-4 cursor-pointer hover:bg-accent/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Bot className="h-4 w-4 text-blue-400" />
                        AI Summary
                      </CardTitle>
                      {summaryOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 px-4 pb-3">
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {latestCall.intent && (
                        <li className="flex items-start gap-2">
                          <span className="text-foreground/70">•</span>
                          <span>
                            <strong className="text-foreground">Intent:</strong> {latestCall.intent}
                          </span>
                        </li>
                      )}
                      {latestCall.summary && (
                        <li className="flex items-start gap-2">
                          <span className="text-foreground/70">•</span>
                          <span>{latestCall.summary}</span>
                        </li>
                      )}
                      {latestCall.sentiment && (
                        <li className="flex items-start gap-2">
                          <span className="text-foreground/70">•</span>
                          <span>
                            <strong className="text-foreground">Sentiment:</strong>{" "}
                            <span
                              className={cn(
                                latestCall.sentiment === "positive" && "text-emerald-400",
                                latestCall.sentiment === "negative" && "text-red-400",
                                latestCall.sentiment === "neutral" && "text-muted-foreground",
                              )}
                            >
                              {latestCall.sentiment}
                            </span>
                          </span>
                        </li>
                      )}
                    </ul>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => copyToClipboard(latestCall.summary || "", "Summary")}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy Summary
                    </Button>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* Extracted Fields */}
          {Object.keys(extractedFields).length > 0 && (
            <Collapsible open={fieldsOpen} onOpenChange={setFieldsOpen}>
              <Card className="border-border/50">
                <CollapsibleTrigger asChild>
                  <CardHeader className="py-3 px-4 cursor-pointer hover:bg-accent/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <FileText className="h-4 w-4 text-purple-400" />
                        Extracted Fields
                      </CardTitle>
                      {fieldsOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 px-4 pb-3">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(extractedFields).map(([key, value]) => (
                        <button
                          key={key}
                          onClick={() => copyToClipboard(value, key)}
                          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 hover:bg-muted text-xs transition-colors"
                        >
                          {getFieldIcon(key)}
                          <span className="text-muted-foreground">{key}:</span>
                          <span className="font-medium text-foreground">{value}</span>
                          <Copy className="h-2.5 w-2.5 text-muted-foreground ml-1" />
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Timeline</h3>
            {timelineEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Phone className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No activity yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {timelineEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => onSelectEvent(event.id, event.type === "call" ? "call" : "followup")}
                    className={cn(
                      "w-full p-3 rounded-lg border text-left transition-colors",
                      "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-primary/50",
                      selectedEventId === event.id ? "bg-accent border-primary/50" : "border-border/50 bg-card/30",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{event.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-sm font-medium text-foreground">{event.title}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{formatTime(event.time)}</span>
                        </div>
                        {event.subtitle && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{event.subtitle}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          {event.outcome && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "h-5 text-[10px]",
                                event.outcome === "handled" ||
                                  event.outcome === "delivered" ||
                                  event.outcome === "completed"
                                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                  : event.outcome === "missed" || event.outcome === "failed"
                                    ? "bg-red-500/20 text-red-400 border-red-500/30"
                                    : event.outcome === "escalated"
                                      ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                                      : "bg-muted text-muted-foreground",
                              )}
                            >
                              {event.outcome}
                            </Badge>
                          )}
                          {event.duration !== undefined && event.duration > 0 && (
                            <span className="text-xs text-muted-foreground">{formatDuration(event.duration)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}

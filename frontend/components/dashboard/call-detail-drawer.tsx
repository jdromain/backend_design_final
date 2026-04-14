"use client"

import { useState, useEffect } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Phone,
  Clock,
  Bot,
  Wrench,
  Download,
  Play,
  CheckCircle,
  AlertTriangle,
  XCircle,
  PhoneIncoming,
  PhoneOutgoing,
} from "lucide-react"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import type { CallRecord, TimelineEvent, TranscriptLine } from "@/types/api"
import { getTimelineForCall, getTranscriptLines } from "@/lib/data/call-details"

interface CallDetailDrawerProps {
  call: CallRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const outcomeBadgeStyles: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  handoff: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  systemFailed: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  dropped: "bg-muted text-muted-foreground border-muted",
}

const eventIcons = {
  call_started: Phone,
  caller_spoke: Phone,
  agent_spoke: Bot,
  tool_called: Wrench,
  transfer: AlertTriangle,
  call_ended: CheckCircle,
  error: XCircle,
}

const eventColors = {
  call_started: "text-sky-500 bg-sky-500/10",
  caller_spoke: "text-blue-500 bg-blue-500/10",
  agent_spoke: "text-violet-500 bg-violet-500/10",
  tool_called: "text-indigo-500 bg-indigo-500/10",
  transfer: "text-amber-500 bg-amber-500/10",
  call_ended: "text-emerald-500 bg-emerald-500/10",
  error: "text-red-500 bg-red-500/10",
}

export function CallDetailDrawer({ call, open, onOpenChange }: CallDetailDrawerProps) {
  const { toast } = useToast()
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [loading, setLoading] = useState(true)

  const handlePlayRecording = () => {
    toast({ title: "Coming soon", description: "Play recording is not yet available." })
  }

  const handleDownloadTranscript = () => {
    toast({ title: "Coming soon", description: "Download transcript is not yet available." })
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return "N/A"
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
  }

  useEffect(() => {
    if (!call) {
      setTimeline([])
      setTranscript([])
      setLoading(false)
      return
    }
    const loadDetails = async () => {
      setLoading(true)
      try {
        const [timelineData, transcriptData] = await Promise.all([
          getTimelineForCall(call),
          getTranscriptLines(call.callId),
        ])
        setTimeline(timelineData as TimelineEvent[])
        setTranscript(transcriptData)
      } catch {
        setTimeline([])
        setTranscript([])
      } finally {
        setLoading(false)
      }
    }
    loadDetails()
  }, [call])

  if (!call) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto rounded-l-xl border-l">
        <SheetHeader className="border-b border-border/80 pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Call Details
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 mt-6 gap-3">
            <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
            <p className="text-sm text-muted-foreground">Loading call details</p>
            <div className="w-full max-w-[200px] space-y-2">
              <div className="h-3 rounded bg-muted animate-pulse" />
              <div className="h-3 rounded bg-muted animate-pulse w-4/5" />
              <div className="h-3 rounded bg-muted animate-pulse w-3/5" />
            </div>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-120px)] mt-6">
            <div className="space-y-6 pr-4 pb-6">
              {/* Summary Card */}
              <Card className="rounded-lg shadow-sm">
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {call.direction === "inbound" ? (
                        <PhoneIncoming className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <PhoneOutgoing className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-mono text-sm font-medium truncate">{call.callerNumber}</span>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0", outcomeBadgeStyles[call.result] || outcomeBadgeStyles.dropped)}>
                      {call.result === "systemFailed" ? "System Failed" : call.result === "handoff" ? "Handoff" : call.result === "completed" ? "Completed" : "Dropped"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Duration</p>
                      <p className="text-sm font-medium flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {formatDuration(call.durationMs)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Agent</p>
                      <p className="text-sm font-medium flex items-center gap-1">
                        <Bot className="h-3.5 w-3.5 shrink-0" />
                        {"Unknown"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Started</p>
                      <p className="text-sm font-medium">{format(new Date(call.startedAt), "MMM d, h:mm a")}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">End Reason</p>
                      <p className="text-sm font-medium">{call.endReason || "Normal"}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 bg-transparent" onClick={handlePlayRecording}>
                      <Play className="mr-2 h-4 w-4" />
                      Play Recording
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 bg-transparent" onClick={handleDownloadTranscript}>
                      <Download className="mr-2 h-4 w-4" />
                      Transcript
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Timeline */}
              <Card className="rounded-lg shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Timeline</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {timeline.map((event, index) => {
                      const Icon =
                        eventIcons[event.type as keyof typeof eventIcons] ?? AlertTriangle
                      const colorClass =
                        eventColors[event.type as keyof typeof eventColors] ?? eventColors.error
                      return (
                        <div key={event.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <div
                              className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-full",
                                colorClass,
                              )}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            {index < timeline.length - 1 && <div className="w-px flex-1 min-h-[12px] bg-border mt-1" />}
                          </div>
                          <div className="flex-1 pb-4">
                            <p className="text-sm font-medium">{event.description}</p>
                            {event.details && <p className="text-xs text-muted-foreground mt-0.5">{event.details}</p>}
                            <p className="text-xs text-muted-foreground mt-1">{event.timestamp}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Transcript */}
              <Card className="rounded-lg shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Transcript</CardTitle>
                </CardHeader>
                <CardContent>
                  {transcript.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No transcript available.</p>
                  ) : (
                    <div className="space-y-2">
                      {transcript.map((line) => (
                        <div key={line.id} className="rounded-md border bg-muted/20 p-3">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <Badge variant={line.role === "agent" ? "default" : "outline"}>
                              {line.role === "agent" ? "Agent" : "Caller"}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">
                              {format(new Date(line.timestamp), "h:mm:ss a")}
                            </span>
                          </div>
                          <p className="text-sm">{line.text}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tool Activity */}
              {call.toolsUsed && call.toolsUsed.length > 0 && (
                <Card className="rounded-lg shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Wrench className="h-4 w-4" />
                      Tools Used ({call.toolsUsed.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {call.toolsUsed.map((tool, index) => (
                        <div key={index} className="flex items-center justify-between rounded-lg border p-3">
                          <span className="text-sm font-mono">{tool.name}</span>
                          <Badge
                            variant="outline"
                            className={
                              tool.success
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                            }
                          >
                            {tool.success ? "Success" : "Failed"}
                          </Badge>
                        </div>
                      ))}
                      {call.toolErrors && call.toolErrors > 0 && (
                        <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                          <span className="text-sm text-red-600 dark:text-red-400">
                            {call.toolErrors} tool error(s)
                          </span>
                          <Badge
                            variant="outline"
                            className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                          >
                            Failed
                          </Badge>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}

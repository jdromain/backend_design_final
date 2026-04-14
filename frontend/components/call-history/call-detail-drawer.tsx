"use client"

import { useState, useEffect } from "react"
import { format } from "date-fns"
import { Copy, Flag, Download, PhoneIncoming, PhoneOutgoing, Lightbulb, ListTodo } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NotesTags } from "./notes-tags"
import type { CallRecord, TimelineEvent, TranscriptLine, ToolActivity } from "@/types/api"
import { cn } from "@/lib/utils"
import { getTimelineForCall, getTranscriptLines, getToolActivities } from "@/lib/data/call-details"

interface CallDetailDrawerProps {
  call: CallRecord | null
  open: boolean
  onClose: () => void
  onCreateAction?: (callId: string) => void
}

const resultConfig: Record<string, { label: string; className: string }> = {
  completed: { label: "Completed", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  handoff: { label: "Handoff", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  dropped: { label: "Dropped", className: "bg-muted text-muted-foreground border-muted" },
  systemFailed: { label: "System Failed", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
}

function ResultBadge({ result }: { result: string }) {
  const config = resultConfig[result] || { label: result, className: "" }
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  )
}

export function CallDetailDrawer({ call, open, onClose, onCreateAction }: CallDetailDrawerProps) {
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([])
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!call) {
      setTimelineEvents([])
      setTranscriptLines([])
      setToolActivities([])
      return
    }
    const loadData = async () => {
      setLoading(true)
      try {
        const [timeline, transcript, tools] = await Promise.all([
          getTimelineForCall(call),
          getTranscriptLines(call.callId),
          getToolActivities(call.callId),
        ])
        setTimelineEvents(timeline)
        setTranscriptLines(transcript)
        setToolActivities(tools)
      } catch {
        setTimelineEvents([])
        setTranscriptLines([])
        setToolActivities([])
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [call])

  if (!call) return null

  const copyCallId = () => {
    navigator.clipboard.writeText(call.callId)
  }

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto rounded-l-xl border-l">
        <SheetHeader className="border-b border-border/80 pb-4">
          <SheetTitle>Call Details</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] pr-4">
          <div className="space-y-6 py-4 pb-6">
            {/* Primary CTA */}
            <div className="flex flex-wrap gap-2 pb-4 border-b border-border/80">
              <Button size="sm" onClick={() => onCreateAction?.(call.callId)}>
                <ListTodo className="h-4 w-4 mr-2" />
                Create Action
              </Button>
              <Button variant="outline" size="sm" className="bg-transparent">
                <Flag className="h-4 w-4 mr-2" />
                Flag
              </Button>
              <Button variant="outline" size="sm" className="bg-transparent">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>

            {/* Recommended Follow-Up (for Handoff or System Failed) */}
            {(call.result === "handoff" || call.result === "systemFailed") && (
              <Card
                className={cn(
                  "border-l-4 rounded-lg",
                  call.result === "handoff"
                    ? "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                    : "border-l-red-500 bg-red-50 dark:bg-red-950/20",
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2 rounded-full shrink-0",
                        call.result === "handoff"
                          ? "bg-amber-100 dark:bg-amber-900/30"
                          : "bg-red-100 dark:bg-red-900/30",
                      )}
                    >
                      <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="font-semibold text-sm">Recommended Follow-Up</p>
                      <p className="text-xs text-muted-foreground">
                        {call.result === "handoff"
                          ? "This call was handed off to a human. Consider reviewing the transcript and creating a follow-up action."
                          : "This call ended due to a system failure. Review the tool activity to identify the issue."}
                      </p>
                      <Button size="sm" onClick={() => onCreateAction?.(call.callId)}>
                        Create Action
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Summary block */}
            <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono bg-muted px-2 py-1 rounded">{call.callId}</code>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 bg-transparent" onClick={copyCallId}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Intent</span>
                  <p className="text-sm font-medium">{call.intent ?? "Unknown"}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Direction</span>
                  <p className="text-sm font-medium flex items-center gap-1">
                    {call.direction === "inbound" ? (
                      <>
                        <PhoneIncoming className="h-4 w-4 shrink-0" /> Inbound
                      </>
                    ) : (
                      <>
                        <PhoneOutgoing className="h-4 w-4 shrink-0" /> Outbound
                      </>
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Caller</span>
                  <p className="text-sm font-medium font-mono">{call.callerNumber}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Phone Line</span>
                  <p className="text-sm font-medium font-mono">{call.phoneLineNumber}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Started</span>
                  <p className="text-sm font-medium">{format(new Date(call.startedAt), "MMM d, h:mm:ss a")}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Duration</span>
                  <p className="text-sm font-medium">{formatDuration(call.durationMs)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <ResultBadge result={call.result} />
                <Badge variant="outline">{call.endReason ?? "—"}</Badge>
              </div>
            </div>

            <Separator />

            {/* Timeline */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Timeline</h4>
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : timelineEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No timeline data available.</p>
              ) : (
                <p className="text-xs text-muted-foreground">{timelineEvents.length} events</p>
              )}
            </div>

            <Separator />

            {/* Transcript Preview */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Transcript</h4>
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : transcriptLines.length === 0 ? (
                <p className="text-xs text-muted-foreground">No transcript available.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{transcriptLines.length} turns</p>
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                    {transcriptLines.map((line) => (
                      <div key={line.id} className="rounded-md border bg-background p-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <Badge variant={line.role === "agent" ? "default" : "outline"}>
                            {line.role === "agent" ? "Agent" : "Caller"}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(line.timestamp), "h:mm:ss a")}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed">{line.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Tool Activity */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Tool Activity</h4>
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : toolActivities.length === 0 ? (
                <p className="text-xs text-muted-foreground">No tool activity recorded.</p>
              ) : (
                <p className="text-xs text-muted-foreground">{toolActivities.length} tool calls</p>
              )}
            </div>

            <Separator />

            {/* Notes & Tags */}
            <div className="rounded-lg border p-4">
              <NotesTags
                notes="Customer requested reschedule due to work conflict. Very polite interaction."
                tags={["vip", "reschedule", "satisfied"]}
                onNotesChange={() => {}}
                onTagsChange={() => {}}
              />
            </div>

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

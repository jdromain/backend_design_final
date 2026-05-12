"use client"

import { useState, useEffect } from "react"
import { format } from "date-fns"
import { Copy, Flag, Download, PhoneIncoming, PhoneOutgoing, Lightbulb, ListTodo, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NotesTags } from "./notes-tags"
import type { CallIntelligenceDetail, CallRecord, TimelineEvent, TranscriptLine, ToolActivity } from "@/types/api"
import { cn } from "@/lib/utils"
import { getCallIntelligence, getTimelineForCall, getTranscriptLines, getToolActivities } from "@/lib/data/call-details"
import {
  selectCallEndedByDisplay,
  selectCallNextStepDisplay,
  selectCallResolutionDisplay,
  selectCallRiskDisplay,
  selectCallTopicDisplay,
} from "@/lib/call-labels"

interface CallDetailDrawerProps {
  call: CallRecord | null
  open: boolean
  onClose: () => void
  onCreateAction?: (callId: string) => void
}

const resultConfig: Record<string, { label: string; className: string }> = {
  completed: { label: "Handled", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  handoff: { label: "Handoff", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  dropped: { label: "Dropped", className: "bg-muted text-muted-foreground border-muted" },
  systemFailed: { label: "System Failed", className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  pending: { label: "Pending", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  unknown: { label: "Unknown", className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20" },
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
  const [intelligence, setIntelligence] = useState<CallIntelligenceDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!call) {
      setTimelineEvents([])
      setTranscriptLines([])
      setToolActivities([])
      setIntelligence(null)
      return
    }
    const loadData = async () => {
      setLoading(true)
      try {
        const [timeline, transcript, tools, intelligenceData] = await Promise.all([
          getTimelineForCall(call),
          getTranscriptLines(call.callId),
          getToolActivities(call.callId),
          getCallIntelligence(call.callId),
        ])
        setTimelineEvents(timeline)
        setTranscriptLines(transcript)
        setToolActivities(tools)
        setIntelligence(intelligenceData)
      } catch {
        setTimelineEvents([])
        setTranscriptLines([])
        setToolActivities([])
        setIntelligence(null)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [call])

  if (!call) return null

  const displayCall: CallRecord = intelligence?.compact ? { ...call, intelligence: intelligence.compact } : call
  const topic = selectCallTopicDisplay(displayCall)
  const resolution = selectCallResolutionDisplay(displayCall)
  const endedBy = selectCallEndedByDisplay(displayCall)
  const nextStep = selectCallNextStepDisplay(displayCall)
  const risk = selectCallRiskDisplay(displayCall)

  const topicBadgeClass = (() => {
    if (topic.state === "classification_failed") return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
    if (topic.state === "insufficient_evidence") return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
    if (topic.state === "pending_analysis" || topic.state === "provisional") return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
    if (topic.state === "true_unknown") return "bg-muted text-muted-foreground border-muted"
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
  })()

  const copyCallId = () => {
    navigator.clipboard.writeText(call.callId)
  }

  const recommendedActionTitle =
    nextStep.tone === "danger"
      ? "Immediate Follow-up Recommended"
      : nextStep.tone === "warning"
        ? "Review Recommended"
        : "No Immediate Action Needed"

  const recommendedActionHint =
    nextStep.tone === "danger"
      ? "This call likely needs human intervention or engineering review."
      : nextStep.tone === "warning"
        ? "A quick owner review can prevent repeat issues."
        : "Call appears stable with no urgent follow-up."

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
          <SheetTitle>Call Review</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] pr-4">
          <div className="space-y-6 py-4 pb-6">
            {/* Primary CTA */}
            <div className="flex flex-wrap gap-2 pb-4 border-b border-border/80">
              <Button size="sm" onClick={() => onCreateAction?.(call.callId)}>
                <ListTodo className="h-4 w-4 mr-2" />
                Create Follow-up
              </Button>
              <Button variant="outline" size="sm" className="bg-transparent">
                <Flag className="h-4 w-4 mr-2" />
                Flag
              </Button>
              <Button variant="outline" size="sm" className="bg-transparent">
                <Download className="h-4 w-4 mr-2" />
                Export Record
              </Button>
            </div>

            {/* Priority recommendation panel */}
            {(risk.level !== "low" || nextStep.tone !== "success" || call.result === "handoff" || call.result === "systemFailed") && (
              <Card
                className={cn(
                  "border-l-4 rounded-lg",
                  risk.level === "high" || call.result === "systemFailed"
                    ? "border-l-red-500 bg-red-50 dark:bg-red-950/20"
                    : risk.level === "medium" || call.result === "handoff"
                    ? "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20"
                    : "border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/20",
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2 rounded-full shrink-0",
                        risk.level === "high" || call.result === "systemFailed"
                          ? "bg-red-100 dark:bg-red-900/30"
                          : risk.level === "medium" || call.result === "handoff"
                          ? "bg-amber-100 dark:bg-amber-900/30"
                          : "bg-emerald-100 dark:bg-emerald-900/30",
                      )}
                    >
                      {risk.level === "high" ? (
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      ) : (
                        <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="font-semibold text-sm">{recommendedActionTitle}</p>
                      <p className="text-xs text-muted-foreground">{recommendedActionHint}</p>
                      <Button size="sm" onClick={() => onCreateAction?.(call.callId)}>
                        Create Follow-up
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

              {/* Summary block */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
                <div className="space-y-2 rounded-md border bg-background/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{topic.text}</span>
                    {topic.badge && (
                      <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${topicBadgeClass}`}>
                        {topic.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Business Outcome:</span>{" "}
                      <span className="font-medium">{resolution.label}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Ownership at End:</span>{" "}
                      <span className="font-medium">{endedBy.label}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Recommended Action:</span>{" "}
                      <span className="font-medium">{nextStep.label}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Priority:</span>{" "}
                      <span className="font-medium">
                        {risk.level === "high" ? "High Priority" : risk.level === "medium" ? "Medium Priority" : "Low Priority"}
                      </span>
                    </div>
                  </div>
                  {topic.warning && <p className="text-xs text-muted-foreground">{topic.warning}</p>}
                </div>

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
                <Badge variant="outline">{call.display?.reason ?? call.endReason ?? "Unknown"}</Badge>
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="text-sm font-medium">Backend Classification Details</h4>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Status: <span className="text-foreground">{call.classification?.status ?? call.canonical?.status ?? "unknown"}</span></div>
                <div>Outcome: <span className="text-foreground">{call.classification?.outcome ?? call.canonical?.outcome ?? "unknown"}</span></div>
                <div>End Reason: <span className="text-foreground">{call.classification?.endReason ?? call.canonical?.endReason ?? "unknown"}</span></div>
                <div>Failure Category: <span className="text-foreground">{call.classification?.failureCategory ?? "unknown"}</span></div>
                <div>Action Class: <span className="text-foreground">{call.classification?.actionClass ?? "no_action"}</span></div>
                <div>Intent: <span className="text-foreground">{call.classification?.intentCategory ?? call.intent ?? "Unknown"}</span></div>
                <div>Tools Used: <span className="text-foreground">{call.classification?.toolSummary?.toolsUsedCount ?? call.toolsUsed.length}</span></div>
                <div>Tool Errors: <span className="text-foreground">{call.classification?.toolSummary?.toolErrorsCount ?? call.toolErrors ?? 0}</span></div>
                <div>Source: <span className="text-foreground">{call.classification?.provenance?.terminalStatusSource ?? call.canonical?.terminalStatusSource ?? "unknown"}</span></div>
                <div>Label Version: <span className="text-foreground">{call.classification?.provenance?.labelVersion ?? 1}</span></div>
              </div>
            </div>

            <Separator />

            <div className="rounded-lg border p-4 space-y-3">
              <h4 className="text-sm font-medium">AI Summary & Confidence</h4>
              {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : !intelligence ? (
                <p className="text-xs text-muted-foreground">No intelligence envelope available.</p>
              ) : (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      Phase: <span className="text-foreground">{intelligence.phase}</span>
                    </div>
                    <div>
                      Revision: <span className="text-foreground">{intelligence.enrichmentRevision || "n/a"}</span>
                    </div>
                      <div>
                        Risk: <span className="text-foreground">{intelligence.compact?.riskLevel ?? "unknown"}</span>
                      </div>
                      <div>
                        Follow-up: <span className="text-foreground">{intelligence.compact?.followupNeeded ? "yes" : "no"}</span>
                      </div>
                      <div>
                        Review Recommended: <span className="text-foreground">{intelligence.compact?.reviewRecommended ? "yes" : "no"}</span>
                      </div>
                      <div>
                        Topic State: <span className="text-foreground">{topic.state}</span>
                      </div>
                    </div>
                  <div className="text-xs">
                    <div className="text-muted-foreground">Summary</div>
                    <div className="text-foreground">{intelligence.compact?.summary ?? "No summary"}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Warnings ({intelligence.warnings.length})</div>
                    {intelligence.warnings.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No warnings.</p>
                    ) : (
                      intelligence.warnings.slice(0, 6).map((warn) => (
                        <div key={`${warn.code}-${warn.field}-${warn.detectedAt}`} className="rounded border px-2 py-1 text-xs">
                          <span className="font-medium">{warn.code}</span>: {warn.message}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Timeline */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Call Timeline</h4>
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
              <h4 className="text-sm font-medium">Conversation Transcript</h4>
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
              <h4 className="text-sm font-medium">System & Tool Activity</h4>
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
                notes=""
                tags={[]}
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

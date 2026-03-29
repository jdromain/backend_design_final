"use client"

import { useState, useEffect } from "react"
import { Copy, Flag, PhoneOff, ArrowRightLeft, AlertTriangle, Lightbulb, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { CallTimeline } from "./call-timeline"
import { LiveTranscriptPreview } from "./live-transcript-preview"
import { TranscriptProcessingMessage, TranscriptUnavailableMessage } from "./transcript-processing-message"
import { ToolActivityList } from "./tool-activity-list"
import { cn } from "@/lib/utils"
import type { LiveCall } from "@/types/api"

interface CallInspectorDrawerProps {
  call: LiveCall | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEndCall?: (callId: string) => void
  onFlagForReview?: (callId: string) => void
  onTransfer?: (callId: string) => void
  onCreateAction?: (callId: string) => void
  onSaveNote?: (callId: string, note: string) => void
  onSaveTags?: (callId: string, tags: string[]) => void
  loadingActions?: Record<string, boolean>
}

export function CallInspectorDrawer({
  call,
  open,
  onOpenChange,
  onEndCall,
  onFlagForReview,
  onTransfer,
  onCreateAction,
  onSaveNote,
  onSaveTags,
  loadingActions = {},
}: CallInspectorDrawerProps) {
  const { toast } = useToast()
  const [note, setNote] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // Initialize note and tags from call when it changes
  useEffect(() => {
    if (call) {
      setNote("") // In a real app, this would load from call.notes
      setSelectedTags(call.tags || [])
    }
  }, [call])

  if (!call) return null

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const copyCallId = () => {
    navigator.clipboard.writeText(call.callId)
    toast({
      title: "Copied",
      description: "Call ID copied to clipboard",
    })
  }

  const stateConfig: Record<string, { label: string; color: string }> = {
    ringing: { label: "Ringing", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    active: { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    at_risk: { label: "At Risk", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
    handoff_requested: { label: "Handoff", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    error: { label: "Error", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  }

  // Recommended intervention logic
  const getRecommendedIntervention = () => {
    if (call.state === "handoff_requested") {
      return {
        type: "handoff",
        title: "Customer Requested Handoff",
        description: call.riskTrigger?.detail || "The caller has explicitly asked to speak with a human agent.",
        suggestion: "Suggested next step: Transfer to available team member",
        action: "Transfer",
        actionFn: onTransfer,
      }
    }
    if (call.state === "at_risk" || call.riskFlags.includes("silence_detected")) {
      return {
        type: "at_risk",
        title: "Long Silence Detected",
        description: call.riskTrigger?.detail || "No response for 15 seconds",
        suggestion: "Suggested next step: Review transcript and create action item",
        action: "Create Action",
        actionFn: onCreateAction,
      }
    }
    if (call.state === "error" || call.riskFlags.includes("tool_error")) {
      return {
        type: "error",
        title: "Tool Failure Detected",
        description: call.riskTrigger?.detail || "A tool encountered an error during execution.",
        suggestion: "Suggested next step: Request handoff to owner",
        action: "Request Handoff",
        actionFn: onTransfer,
      }
    }
    return null
  }

  const intervention = getRecommendedIntervention()

  const tagOptions = ["Stuck", "Tool error", "Complaint", "High priority"]

  const toggleTag = (tag: string) => {
    const newTags = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag]
    setSelectedTags(newTags)
    // Auto-save tags when toggled
    if (onSaveTags) {
      onSaveTags(call.callId, newTags)
    }
  }

  const handleNoteBlur = () => {
    // Save note when user leaves the field
    if (onSaveNote && note.trim()) {
      onSaveNote(call.callId, note)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto rounded-l-xl border-l">
        <SheetHeader className="border-b border-border/80 pb-4">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>Call Details</SheetTitle>
            <Badge className={cn("shrink-0 font-medium", (stateConfig[call.state] || stateConfig.active).color)}>{(stateConfig[call.state] || stateConfig.active).label}</Badge>
          </div>
        </SheetHeader>

        {/* Recommended Intervention Card */}
        {intervention && (
          <Card
            className={cn(
              "mb-4 border-l-4 rounded-lg",
              intervention.type === "handoff" && "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
              intervention.type === "at_risk" && "border-l-orange-500 bg-orange-50 dark:bg-orange-950/20",
              intervention.type === "error" && "border-l-red-500 bg-red-50 dark:bg-red-950/20",
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "p-2 rounded-full shrink-0",
                    intervention.type === "handoff" && "bg-amber-100 dark:bg-amber-900/30",
                    intervention.type === "at_risk" && "bg-orange-100 dark:bg-orange-900/30",
                    intervention.type === "error" && "bg-red-100 dark:bg-red-900/30",
                  )}
                >
                  {intervention.type === "error" ? (
                    <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  ) : (
                    <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <p className="font-semibold text-sm">{intervention.title}</p>
                    <p className="text-xs text-muted-foreground">{intervention.description}</p>
                  </div>
                  <p className="text-xs italic text-muted-foreground">{intervention.suggestion}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      disabled={loadingActions[intervention.type === "handoff" ? `transfer-${call.callId}` : intervention.type === "error" ? `transfer-${call.callId}` : `createAction-${call.callId}`]}
                      onClick={() => {
                        if (intervention.actionFn) {
                          intervention.actionFn(call.callId)
                        }
                      }}
                    >
                      {loadingActions[intervention.type === "handoff" ? `transfer-${call.callId}` : intervention.type === "error" ? `transfer-${call.callId}` : `createAction-${call.callId}`] ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : null}
                      {intervention.action}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary block */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Call ID</p>
              <div className="flex items-center gap-1">
                <code className="text-sm font-mono truncate min-w-0">{call.callId}</code>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copyCallId}>
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Direction</p>
              <p className="text-sm font-medium capitalize">{call.direction}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Caller</p>
              <p className="text-sm font-medium font-mono">{call.callerNumber}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Duration</p>
              <p className="text-sm font-medium font-mono">{formatDuration(call.durationSeconds)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Intent</p>
              <Badge variant="outline" className="font-normal">
                {call.intent || "Unknown"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Started</p>
              <p className="text-sm font-medium">
                {new Date(call.startedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>

          {/* Risk Flags */}
          {call.riskFlags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {call.riskFlags.map((flag) => (
                <Badge key={flag} variant="destructive" className="text-xs">
                  {flag.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="timeline" className="mt-4">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="mt-4 rounded-lg bg-muted/20 p-4">
            <CallTimeline events={call.timeline} />
          </TabsContent>

          <TabsContent value="transcript" className="mt-4 rounded-lg bg-muted/20 p-4">
            {["ringing", "active", "at_risk", "handoff_requested", "error"].includes(call.state) ? (
              <TranscriptProcessingMessage callActive />
            ) : call.transcript.length > 0 ? (
              <LiveTranscriptPreview turns={call.transcript} />
            ) : (
              call.transcriptStatus === "processing" ? (
                <TranscriptProcessingMessage callActive={false} />
              ) : (
                <TranscriptUnavailableMessage />
              )
            )}
          </TabsContent>

          <TabsContent value="tools" className="mt-4 rounded-lg bg-muted/20 p-4">
            <ToolActivityList tools={call.tools} />
          </TabsContent>
        </Tabs>

        <Separator className="my-4" />

        {/* Notes & Tags */}
        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Internal Note</label>
            <Textarea
              placeholder="Add a note about this call..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={handleNoteBlur}
              className="resize-none"
              rows={2}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Tags</label>
            <div className="flex flex-wrap gap-1.5">
              {tagOptions.map((tag) => (
                <Badge
                  key={tag}
                  variant={selectedTags.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <Separator className="my-4" />

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={loadingActions[`createAction-${call.callId}`]}
            onClick={() => onCreateAction?.(call.callId)}
          >
            {loadingActions[`createAction-${call.callId}`] ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : null}
            Create Action
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loadingActions[`transfer-${call.callId}`]}
            onClick={() => onTransfer?.(call.callId)}
            className="bg-transparent"
          >
            {loadingActions[`transfer-${call.callId}`] ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-4 w-4 mr-1.5" />
            )}
            Request Handoff
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loadingActions[`flag-${call.callId}`]}
            onClick={() => onFlagForReview?.(call.callId)}
            className="bg-transparent"
          >
            {loadingActions[`flag-${call.callId}`] ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Flag className="h-4 w-4 mr-1.5" />
            )}
            Flag for Review
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={loadingActions[`endCall-${call.callId}`]}
              >
                {loadingActions[`endCall-${call.callId}`] ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <PhoneOff className="h-4 w-4 mr-1.5" />
                )}
                End Call
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>End this call?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will immediately terminate the call. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onEndCall?.(call.callId)}
                  disabled={loadingActions[`endCall-${call.callId}`]}
                >
                  {loadingActions[`endCall-${call.callId}`] ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : null}
                  End Call
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SheetContent>
    </Sheet>
  )
}

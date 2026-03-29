"use client"

import { Loader2, FileText } from "lucide-react"

interface TranscriptProcessingMessageProps {
  /** When true, call is still active (transcript after call). When false, call ended and transcript is processing. */
  callActive?: boolean
}

export function TranscriptProcessingMessage({ callActive = true }: TranscriptProcessingMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4 shrink-0">
        {callActive ? (
          <FileText className="h-8 w-8 text-muted-foreground" />
        ) : (
          <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
        )}
      </div>
      <h4 className="text-sm font-medium text-foreground mb-1">
        {callActive ? "Transcript unavailable during call" : "Transcript processing"}
      </h4>
      <p className="text-xs text-muted-foreground max-w-[260px]">
        {callActive
          ? "Transcript will be available shortly after the call ends. You can review it in Call History or Actions."
          : "Transcript is being processed and will be available shortly."}
      </p>
    </div>
  )
}

export function TranscriptUnavailableMessage() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4 shrink-0">
        <FileText className="h-8 w-8 text-muted-foreground" />
      </div>
      <h4 className="text-sm font-medium text-foreground mb-1">No transcript available</h4>
      <p className="text-xs text-muted-foreground max-w-[260px]">
        This call has no transcript. It may have been too short or the recording was not captured.
      </p>
    </div>
  )
}

"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TranscriptLine } from "@/types/api"

interface LiveTranscriptPreviewProps {
  turns: TranscriptLine[]
  onViewFull?: () => void
}

export function LiveTranscriptPreview({ turns, onViewFull }: LiveTranscriptPreviewProps) {
  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {turns.slice(-10).map((turn) => (
          <div key={turn.id} className={cn("flex gap-2", turn.role === "agent" ? "justify-start" : "justify-end")}>
            <div
              className={cn(
                "max-w-[85%] rounded-lg px-3 py-2",
                turn.role === "agent" ? "bg-muted" : "bg-primary text-primary-foreground",
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium">{turn.role === "agent" ? "Agent" : "Caller"}</span>
                <span className="text-xs opacity-70">{formatTime(turn.timestamp)}</span>
              </div>
              <p className="text-sm">{turn.text}</p>
            </div>
          </div>
        ))}
      </div>
      {onViewFull && (
        <Button variant="outline" size="sm" className="w-full bg-transparent" onClick={onViewFull}>
          View full transcript
        </Button>
      )}
    </div>
  )
}

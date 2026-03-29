"use client"

import { useState, useMemo, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Search, Copy, Bot, User, FileText, Phone } from "lucide-react"
import type { Call } from "@/lib/actions-store"
import { useToast } from "@/hooks/use-toast"
import { TranscriptProcessingMessage, TranscriptUnavailableMessage } from "@/components/live-calls/transcript-processing-message"

interface TranscriptViewerProps {
  call: Call | null
  onRequestRecap?: () => void
  isLoading?: boolean
}

// Mock transcript data
const generateMockTranscript = (call: Call) => {
  const transcripts: Record<string, Array<{ speaker: "agent" | "caller"; text: string; time: string }>> = {
    booking: [
      { speaker: "agent", text: "Thank you for calling. How can I help you today?", time: "0:00" },
      { speaker: "caller", text: "Hi, I'd like to schedule an appointment for my car.", time: "0:05" },
      { speaker: "agent", text: "Of course! What type of service do you need?", time: "0:10" },
      { speaker: "caller", text: "I need an oil change and tire rotation.", time: "0:15" },
      {
        speaker: "agent",
        text: "Perfect. We have availability tomorrow at 10 AM or Wednesday at 2 PM. Which works better for you?",
        time: "0:22",
      },
      { speaker: "caller", text: "Tomorrow at 10 AM would be great.", time: "0:28" },
      {
        speaker: "agent",
        text: "Excellent! I've booked you in for tomorrow at 10 AM. Can I confirm your phone number?",
        time: "0:33",
      },
      { speaker: "caller", text: "Yes, it's 555-123-4567.", time: "0:40" },
      {
        speaker: "agent",
        text: "Great, you're all set. We'll send you a reminder text. Is there anything else I can help with?",
        time: "0:45",
      },
      { speaker: "caller", text: "No, that's all. Thank you!", time: "0:52" },
      { speaker: "agent", text: "Thank you for choosing us. Have a great day!", time: "0:55" },
    ],
    complaint: [
      { speaker: "agent", text: "Thank you for calling. How can I assist you?", time: "0:00" },
      { speaker: "caller", text: "I'm very unhappy with my recent order. It was completely wrong.", time: "0:05" },
      { speaker: "agent", text: "I'm so sorry to hear that. Can you tell me more about what happened?", time: "0:12" },
      {
        speaker: "caller",
        text: "I ordered a medium pizza with pepperoni and got a large veggie. This is unacceptable.",
        time: "0:18",
      },
      {
        speaker: "agent",
        text: "I completely understand your frustration. Let me make this right for you.",
        time: "0:27",
      },
      { speaker: "caller", text: "I've been a customer for years and this has never happened before.", time: "0:33" },
      {
        speaker: "agent",
        text: "We truly value your loyalty. I'm going to escalate this to our manager who will personally handle your case.",
        time: "0:40",
      },
      { speaker: "caller", text: "Okay, I appreciate that.", time: "0:48" },
    ],
    quote: [
      { speaker: "agent", text: "Good morning! How can I help you today?", time: "0:00" },
      { speaker: "caller", text: "Hi, I need a quote for brake replacement on my Toyota Camry.", time: "0:05" },
      {
        speaker: "agent",
        text: "Sure thing! Is it a 2020 model? And have you noticed any specific issues?",
        time: "0:12",
      },
      { speaker: "caller", text: "Yes, 2020. The brakes are squeaking and feel less responsive.", time: "0:20" },
      {
        speaker: "agent",
        text: "Based on what you're describing, you might need new brake pads and possibly rotors. A full brake service runs about $450.",
        time: "0:28",
      },
      { speaker: "caller", text: "That sounds reasonable. How soon can you get me in?", time: "0:38" },
      {
        speaker: "agent",
        text: "We have an opening this Thursday at 9 AM. I'll send you an estimate link to review and approve.",
        time: "0:45",
      },
      { speaker: "caller", text: "Perfect, send that over and I'll take a look.", time: "0:52" },
    ],
    reservation: [
      { speaker: "agent", text: "Thank you for calling! How may I help you?", time: "0:00" },
      { speaker: "caller", text: "I'd like to make a reservation for 6 people this Saturday.", time: "0:05" },
      { speaker: "agent", text: "Wonderful! What time were you thinking?", time: "0:10" },
      { speaker: "caller", text: "Around 7 PM if possible.", time: "0:14" },
      {
        speaker: "agent",
        text: "Let me check... Yes, we have availability at 7:15 PM. Would that work?",
        time: "0:20",
      },
      { speaker: "caller", text: "That's perfect!", time: "0:26" },
      { speaker: "agent", text: "Great! I'll need a name and phone number for the reservation.", time: "0:30" },
      { speaker: "caller", text: "Sarah Johnson, 555-234-5678.", time: "0:35" },
      {
        speaker: "agent",
        text: "You're all set for Saturday at 7:15 PM, party of 6. I'll send you a confirmation link.",
        time: "0:42",
      },
    ],
  }

  const intent = call.intent || "booking"
  return transcripts[intent] || transcripts.booking
}

export function TranscriptViewer({ call, onRequestRecap, isLoading = false }: TranscriptViewerProps) {
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState("")

  const copyToClipboard = useCallback((text: string, label: string) => {
    if (!text || !text.trim()) {
      toast({
        title: "Nothing to copy",
        description: `No ${label.toLowerCase()} available to copy`,
        variant: "destructive",
      })
      return
    }

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

  // Memoize transcript data (must be before conditional returns)
  const transcript = useMemo(() => {
    if (!call) return []
    return generateMockTranscript(call)
  }, [call])
  
  const filteredTranscript = useMemo(() => {
    if (!searchQuery) return transcript
    const query = searchQuery.toLowerCase()
    return transcript.filter((line) => line.text.toLowerCase().includes(query))
  }, [transcript, searchQuery])

  const fullTranscriptText = useMemo(() => {
    return transcript
      .map((line) => `${line.speaker === "agent" ? "Agent" : "Caller"}: ${line.text}`)
      .join("\n")
  }, [transcript])

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-background/50 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <Skeleton className="h-5 w-24" />
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>
    )
  }

  // Empty state - no call selected
  if (!call) {
    return (
      <div className="h-full flex flex-col bg-background/50 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Transcript</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No transcript available</h3>
            <p className="text-xs text-muted-foreground">
              Select a call from the timeline in the contact panel to view its full transcript and conversation details.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Transcript is still processing (post-call)
  if (call.transcriptStatus === "processing") {
    return (
      <div className="h-full flex flex-col bg-background/50 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Transcript</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <TranscriptProcessingMessage callActive={false} />
        </div>
      </div>
    )
  }

  // Transcript unavailable for this call
  if (call.transcriptStatus === "unavailable") {
    return (
      <div className="h-full flex flex-col bg-background/50 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Transcript</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <TranscriptUnavailableMessage />
        </div>
      </div>
    )
  }

  // No summary/transcript available (missed or very short call)
  if (!call.summary && call.durationSec === 0) {
    return (
      <div className="h-full flex flex-col bg-background/50 border-l border-border">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Transcript</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <Phone className="h-8 w-8 text-amber-500/70" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">No transcript for this call</h3>
            <p className="text-xs text-muted-foreground mb-4">
              This call was missed or ended before audio could be captured. Transcripts are available after completed calls.
            </p>
            {onRequestRecap && (
              <Button size="sm" variant="outline" onClick={onRequestRecap}>
                <Bot className="h-4 w-4 mr-1.5" />
                Request AI Call Recap
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-background/50 border-l border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-medium text-foreground flex-shrink-0">Transcript</h3>
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(call.summary || "", "Summary")}
              aria-label="Copy call summary to clipboard"
              className="flex-shrink-0"
            >
              <Copy className="h-3 w-3 mr-1" aria-hidden="true" />
              Copy Summary
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(fullTranscriptText, "Transcript")}
              aria-label="Copy full transcript to clipboard"
              className="flex-shrink-0"
            >
              <Copy className="h-3 w-3 mr-1" aria-hidden="true" />
              Copy Transcript
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcript..."
            className="pl-8 h-8 text-sm"
            aria-label="Search transcript text"
          />
        </div>

        {/* Call metadata */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className={cn(
              call.outcome === "handled"
                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                : call.outcome === "missed"
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : call.outcome === "escalated"
                    ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                    : "bg-muted text-muted-foreground",
            )}
          >
            {call.outcome}
          </Badge>
          {call.durationSec > 0 && (
            <Badge variant="outline" className="text-muted-foreground">
              {Math.floor(call.durationSec / 60)}:{(call.durationSec % 60).toString().padStart(2, "0")}
            </Badge>
          )}
          {call.sentiment && (
            <Badge
              variant="outline"
              className={cn(
                call.sentiment === "positive"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : call.sentiment === "negative"
                    ? "bg-red-500/10 text-red-400 border-red-500/30"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {call.sentiment}
            </Badge>
          )}
        </div>
      </div>

      {/* Transcript content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {filteredTranscript.map((line, i) => (
            <div
              key={i}
              className={cn("flex gap-3 p-2 rounded-lg", line.speaker === "agent" ? "bg-blue-500/5" : "bg-card/50")}
            >
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  line.speaker === "agent" ? "bg-blue-500/20" : "bg-muted",
                )}
              >
                {line.speaker === "agent" ? (
                  <Bot className="h-3.5 w-3.5 text-blue-400" />
                ) : (
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className={cn(
                      "text-xs font-medium",
                      line.speaker === "agent" ? "text-blue-400" : "text-foreground",
                    )}
                  >
                    {line.speaker === "agent" ? "Agent" : "Caller"}
                  </span>
                  <span className="text-xs text-muted-foreground">{line.time}</span>
                </div>
                <p className="text-sm text-foreground/90">{line.text}</p>
              </div>
            </div>
          ))}

          {searchQuery && filteredTranscript.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No results for "{searchQuery}"</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

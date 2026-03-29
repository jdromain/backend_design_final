"use client"

import { useState, useEffect } from "react"
import { Phone, Bot, User, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { Agent } from "./agent-card"

interface TestAgentModalProps {
  agent: Agent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface TranscriptTurn {
  id: string
  speaker: "agent" | "caller"
  text: string
  timestamp: string
}

const mockTranscript: TranscriptTurn[] = [
  { id: "1", speaker: "agent", text: "Hello! Thank you for calling. How can I help you today?", timestamp: "0:00" },
  { id: "2", speaker: "caller", text: "Hi, I'd like to make a reservation for this Saturday.", timestamp: "0:03" },
  {
    id: "3",
    speaker: "agent",
    text: "I'd be happy to help you with a reservation for Saturday. How many guests will be dining?",
    timestamp: "0:06",
  },
  { id: "4", speaker: "caller", text: "There will be 4 of us.", timestamp: "0:10" },
  {
    id: "5",
    speaker: "agent",
    text: "Perfect, a table for 4. What time would you prefer?",
    timestamp: "0:12",
  },
  { id: "6", speaker: "caller", text: "Around 7pm if possible.", timestamp: "0:15" },
  {
    id: "7",
    speaker: "agent",
    text: "Let me check availability for 7pm on Saturday... Great news! I have a table available at 7pm. Can I get a name for the reservation?",
    timestamp: "0:17",
  },
]

export function TestAgentModal({ agent, open, onOpenChange }: TestAgentModalProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([])

  useEffect(() => {
    if (open && agent) {
      setIsConnecting(true)
      setIsConnected(false)
      setTranscript([])

      // Simulate connection
      const connectTimer = setTimeout(() => {
        setIsConnecting(false)
        setIsConnected(true)

        // Simulate transcript appearing
        mockTranscript.forEach((turn, index) => {
          setTimeout(() => {
            setTranscript((prev) => [...prev, turn])
          }, index * 1500)
        })
      }, 2000)

      return () => clearTimeout(connectTimer)
    }
  }, [open, agent])

  const handleEndCall = () => {
    setIsConnected(false)
    onOpenChange(false)
  }

  if (!agent) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Test Call - {agent.name}
          </DialogTitle>
          <DialogDescription>Simulated test call with your AI agent</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between">
            <Badge variant={isConnected ? "default" : "secondary"} className={cn(isConnected && "bg-emerald-500")}>
              {isConnecting ? "Connecting..." : isConnected ? "Connected" : "Disconnected"}
            </Badge>
            {isConnected && (
              <span className="text-sm text-muted-foreground">Duration: {Math.floor(transcript.length * 3)}s</span>
            )}
          </div>

          {/* Transcript */}
          <div className="rounded-lg border bg-muted/30">
            {isConnecting ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                <p className="text-sm text-muted-foreground">Initiating test call...</p>
              </div>
            ) : (
              <ScrollArea className="h-[300px] p-4">
                <div className="space-y-3">
                  {transcript.map((turn) => (
                    <div key={turn.id} className={cn("flex gap-2", turn.speaker === "caller" && "justify-end")}>
                      {turn.speaker === "agent" && (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <Bot className="h-3 w-3 text-primary" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-3 py-2",
                          turn.speaker === "agent" ? "bg-muted" : "bg-primary text-primary-foreground",
                        )}
                      >
                        <p className="text-sm">{turn.text}</p>
                        <p className="text-xs opacity-60 mt-1">{turn.timestamp}</p>
                      </div>
                      {turn.speaker === "caller" && (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                          <User className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                  ))}
                  {transcript.length === 0 && !isConnecting && (
                    <p className="text-center text-sm text-muted-foreground py-8">No transcript yet</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {isConnected && (
              <Button variant="destructive" onClick={handleEndCall}>
                End Call
              </Button>
            )}
            {!isConnected && !isConnecting && (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

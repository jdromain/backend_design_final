"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Phone, Activity, Zap, FileText, Puzzle, PauseCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"

interface QuickActionsProps {
  onNavigate: (page: string) => void
  onTestCall?: () => void
  onPauseAgent?: () => void
}

export function QuickActions({ onNavigate, onTestCall, onPauseAgent }: QuickActionsProps) {
  const { toast } = useToast()

  const handleTestCall = () => {
    if (onTestCall) {
      onTestCall()
    } else {
      toast({
        title: "Test Call",
        description: "Initiating test call to your configured number...",
      })
    }
  }

  const handlePauseAgent = () => {
    if (onPauseAgent) {
      onPauseAgent()
    } else {
      toast({
        title: "Agent Paused",
        description: "Your agent has been paused. Incoming calls will go to voicemail.",
        variant: "destructive",
      })
    }
  }

  return (
    <Card className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-primary/20">
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="h-8" onClick={handleTestCall}>
            <Phone className="mr-2 h-4 w-4" />
            Test Call
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 bg-transparent"
            onClick={() => onNavigate("live")}
          >
            <Activity className="mr-2 h-4 w-4" />
            View Live Calls
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 bg-transparent"
            onClick={() => onNavigate("actions")}
          >
            <Zap className="mr-2 h-4 w-4" />
            Open Actions Inbox
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 bg-transparent"
            onClick={() => onNavigate("knowledge")}
          >
            <FileText className="mr-2 h-4 w-4" />
            Upload Documents
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 bg-transparent"
            onClick={() => onNavigate("integrations")}
          >
            <Puzzle className="mr-2 h-4 w-4" />
            Connect Integration
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            className={cn(
              "h-8 bg-transparent border-red-500/30 text-red-600 dark:text-red-400",
              "hover:bg-red-500/10 hover:border-red-500/50"
            )}
            onClick={handlePauseAgent}
          >
            <PauseCircle className="mr-2 h-4 w-4" />
            Pause Agent
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

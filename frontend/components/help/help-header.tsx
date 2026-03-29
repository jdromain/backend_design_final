"use client"

import { Button } from "@/components/ui/button"
import { MessageSquare, Bug, Activity } from "lucide-react"

interface HelpHeaderProps {
  onContactSupport: () => void
  onReportBug: () => void
  onViewStatus: () => void
}

export function HelpHeader({ onContactSupport, onReportBug, onViewStatus }: HelpHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Help & Support</h1>
        <p className="text-muted-foreground">Find answers, check system status, or contact support.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onViewStatus} title="System Status">
          <Activity className="h-4 w-4" />
        </Button>
        <Button variant="outline" onClick={onReportBug}>
          <Bug className="h-4 w-4 mr-2" />
          Report a Bug
        </Button>
        <Button onClick={onContactSupport}>
          <MessageSquare className="h-4 w-4 mr-2" />
          Contact Support
        </Button>
      </div>
    </div>
  )
}

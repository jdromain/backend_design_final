"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MessageSquare, Bug, Lightbulb, Download, Lock } from "lucide-react"

interface QuickActionsCardProps {
  isAdmin: boolean
  onContactSupport: () => void
  onReportBug: () => void
  onRequestFeature: () => void
  onDownloadDiagnostics: () => void
}

export function QuickActionsCard({
  isAdmin,
  onContactSupport,
  onReportBug,
  onRequestFeature,
  onDownloadDiagnostics,
}: QuickActionsCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="outline" className="w-full justify-start bg-transparent" onClick={onContactSupport}>
          <MessageSquare className="h-4 w-4 mr-2" />
          Contact Support
        </Button>
        <Button variant="outline" className="w-full justify-start bg-transparent" onClick={onReportBug}>
          <Bug className="h-4 w-4 mr-2" />
          Report a Bug
        </Button>
        <Button variant="outline" className="w-full justify-start bg-transparent" onClick={onRequestFeature}>
          <Lightbulb className="h-4 w-4 mr-2" />
          Request a Feature
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start bg-transparent"
          onClick={onDownloadDiagnostics}
          disabled={!isAdmin}
        >
          <Download className="h-4 w-4 mr-2" />
          Download Diagnostics
          {!isAdmin && <Lock className="h-3 w-3 ml-auto text-muted-foreground" />}
        </Button>
      </CardContent>
    </Card>
  )
}

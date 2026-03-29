"use client"

import { History, RotateCcw, Eye, User } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { Agent } from "./agent-card"

interface VersionHistoryDrawerProps {
  agent: Agent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface Version {
  id: string
  version: number
  createdAt: string
  createdBy: string
  notes: string
  isCurrent: boolean
}

export function VersionHistoryDrawer({ agent, open, onOpenChange }: VersionHistoryDrawerProps) {
  if (!agent) return null

  // Generate mock versions based on agent's current version
  const versions: Version[] = Array.from({ length: agent.version }, (_, i) => {
    const v = agent.version - i
    const daysAgo = i * 3 + 1
    return {
      id: `v${v}`,
      version: v,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * daysAgo).toISOString(),
      createdBy: ["John Smith", "Sarah Johnson", "Mike Chen"][i % 3],
      notes:
        v === agent.version
          ? "Updated response templates and improved error handling"
          : v === agent.version - 1
            ? "Added support for multiple languages"
            : "Initial release with core functionality",
      isCurrent: v === agent.version,
    }
  })

  const handleRollback = (version: Version) => {
    // Mock rollback action
    console.log("Rolling back to version", version.version)
  }

  const handleViewConfig = (version: Version) => {
    // Mock view config action
    console.log("Viewing config for version", version.version)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </SheetTitle>
          <SheetDescription>{agent.name}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-8rem)] mt-6 pr-4">
          <div className="space-y-4">
            {versions.map((version, index) => (
              <div key={version.id}>
                <div
                  className={cn("rounded-lg border p-4 space-y-3", version.isCurrent && "border-primary bg-primary/5")}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">v{version.version}</span>
                      {version.isCurrent && <Badge className="bg-primary/10 text-primary border-0">Current</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                    </span>
                  </div>

                  <p className="text-sm text-muted-foreground">{version.notes}</p>

                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {version.createdBy}
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs bg-transparent"
                      onClick={() => handleViewConfig(version)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      View Config
                    </Button>
                    {!version.isCurrent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs bg-transparent"
                        onClick={() => handleRollback(version)}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" />
                        Rollback
                      </Button>
                    )}
                  </div>
                </div>
                {index < versions.length - 1 && (
                  <div className="flex justify-center py-2">
                    <div className="h-4 w-px bg-border" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

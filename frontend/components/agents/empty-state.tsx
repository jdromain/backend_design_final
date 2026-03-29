"use client"

import { Bot, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

interface EmptyStateProps {
  onCreateAgent: () => void
}

export function EmptyState({ onCreateAgent }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Bot className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="mt-6 text-lg font-semibold">No agents yet</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        Create your first AI agent to start handling voice calls automatically.
      </p>
      <Button className="mt-6" onClick={onCreateAgent}>
        <Plus className="mr-2 h-4 w-4" />
        Create your first agent
      </Button>
    </div>
  )
}

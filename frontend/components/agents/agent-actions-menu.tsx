"use client"

import { MoreHorizontal, Copy, BarChart3, History, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { Agent } from "./agent-card"

interface AgentActionsMenuProps {
  agent: Agent
  onDuplicate: (agent: Agent) => void
  onViewAnalytics: (agent: Agent) => void
  onVersionHistory: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}

export function AgentActionsMenu({
  agent,
  onDuplicate,
  onViewAnalytics,
  onVersionHistory,
  onDelete,
}: AgentActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onDuplicate(agent)}>
          <Copy className="mr-2 h-4 w-4" />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onViewAnalytics(agent)}>
          <BarChart3 className="mr-2 h-4 w-4" />
          View Analytics
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onVersionHistory(agent)}>
          <History className="mr-2 h-4 w-4" />
          Version History
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(agent)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

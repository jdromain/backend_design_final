"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2 } from "lucide-react"
import type { ToolActivity } from "@/types/api"

interface ToolActivityListProps {
  tools: ToolActivity[]
}

export function ToolActivityList({ tools }: ToolActivityListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const getStatusIcon = (status: ToolActivity["status"]) => {
    switch (status) {
      case "pending":
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      case "success":
        return <CheckCircle className="h-4 w-4 text-emerald-500" />
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />
    }
  }

  return (
    <div className="space-y-2">
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">No tools invoked yet</p>
      ) : (
        tools.map((tool) => {
          const isExpanded = expandedIds.has(tool.id)
          return (
            <div key={tool.id} className="rounded-lg border">
              <button
                onClick={() => toggleExpanded(tool.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <code className="text-sm font-mono">{tool.name}</code>
                </div>
                <div className="flex items-center gap-2">
                  {tool.latency != null && <span className="text-xs text-muted-foreground">{tool.latency}ms</span>}
                  {getStatusIcon(tool.status)}
                </div>
              </button>
              {isExpanded && (
                <div className="border-t px-3 py-2 space-y-2">
                  {tool.error && (
                    <div className="rounded bg-red-50 dark:bg-red-900/20 p-2">
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">Error</p>
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{tool.error}</p>
                    </div>
                  )}
                  {tool.input && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Input</p>
                      <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                        {JSON.stringify(tool.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {tool.output && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
                      <pre className="text-xs bg-muted rounded p-2 overflow-x-auto">
                        {JSON.stringify(tool.output, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

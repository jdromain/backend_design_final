"use client"

import { cn } from "@/lib/utils"

export type LiveCallTab = "all" | "ringing" | "active" | "handoff" | "at_risk" | "errors"

interface LiveCallsTabsProps {
  activeTab: LiveCallTab
  onTabChange: (tab: LiveCallTab) => void
  counts: {
    all: number
    ringing: number
    active: number
    handoff: number
    at_risk: number
    errors: number
  }
}

export function LiveCallsTabs({ activeTab, onTabChange, counts }: LiveCallsTabsProps) {
  const tabs: { id: LiveCallTab; label: string; color?: string }[] = [
    { id: "all", label: "All" },
    { id: "ringing", label: "Ringing", color: "text-blue-600" },
    { id: "active", label: "Active", color: "text-emerald-600" },
    { id: "handoff", label: "Handoff", color: "text-amber-600" },
    { id: "at_risk", label: "At Risk", color: "text-orange-600" },
    { id: "errors", label: "Errors", color: "text-red-600" },
  ]

  return (
    <div className="flex flex-wrap gap-1 border-b">
      {tabs.map((tab) => {
        const count = counts[tab.id]
        const isActive = activeTab === tab.id

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className={cn(tab.color && isActive && tab.color)}>{tab.label}</span>
            {count > 0 && (
              <span
                className={cn(
                  "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium",
                  isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
            {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
          </button>
        )
      })}
    </div>
  )
}

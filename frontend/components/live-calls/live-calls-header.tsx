"use client"

import { useState, useEffect } from "react"
import { Search, RefreshCw } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface LiveCallsHeaderProps {
  activeCount: number
  searchQuery: string
  onSearchChange: (query: string) => void
  autoRefresh: boolean
  onAutoRefreshToggle: (enabled: boolean) => void
  lastUpdated: Date
  onRefreshNow: () => void
}

export function LiveCallsHeader({
  activeCount,
  searchQuery,
  onSearchChange,
  autoRefresh,
  onAutoRefreshToggle,
  lastUpdated,
  onRefreshNow,
}: LiveCallsHeaderProps) {
  const [secondsAgo, setSecondsAgo] = useState(0)

  useEffect(() => {
    const updateSeconds = () => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000))
    }
    updateSeconds()
    const interval = setInterval(updateSeconds, 1000)
    return () => clearInterval(interval)
  }, [lastUpdated])

  return (
    <div className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Live Calls</h1>
          <Badge variant={activeCount > 0 ? "default" : "secondary"} className="h-7 px-3 text-sm font-semibold">
            <span className={activeCount > 0 ? "relative flex h-2 w-2 mr-2" : "hidden"}>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary-foreground"></span>
            </span>
            {activeCount} Active
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search caller, call ID, intent..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={onAutoRefreshToggle} />
              <Label htmlFor="auto-refresh" className="text-sm text-muted-foreground whitespace-nowrap">
                Auto-refresh
              </Label>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">Updated {secondsAgo}s ago</span>
            <Button variant="ghost" size="icon" onClick={onRefreshNow} className="h-8 w-8">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

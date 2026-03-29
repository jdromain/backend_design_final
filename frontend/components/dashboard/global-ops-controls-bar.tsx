"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { Download, CalendarIcon, ChevronDown } from "lucide-react"
import { format, startOfDay, subDays, isToday, isSameDay, differenceInDays } from "date-fns"
import { cn } from "@/lib/utils"

export interface DateRangeValue {
  from: Date
  to: Date
}

interface GlobalOpsControlsBarProps {
  dateRange: DateRangeValue
  onDateRangeChange: (range: DateRangeValue) => void
  onExport: () => void
  lastUpdated: Date
  autoRefresh: boolean
  onAutoRefreshToggle: (enabled: boolean) => void
}

const presets = [
  { label: "Today", getValue: (): DateRangeValue => {
    const now = new Date()
    return { from: startOfDay(now), to: now }
  }},
  { label: "24h", getValue: (): DateRangeValue => {
    const to = new Date()
    return { from: subDays(to, 1), to }
  }},
  { label: "7d", getValue: (): DateRangeValue => {
    const to = new Date()
    return { from: subDays(to, 7), to }
  }},
  { label: "30d", getValue: (): DateRangeValue => {
    const to = new Date()
    return { from: subDays(to, 30), to }
  }},
]

function formatRangeLabel(range: DateRangeValue): string {
  if (isSameDay(range.from, range.to) && isToday(range.from)) return "Today"
  const fromStr = format(range.from, "MMM d")
  const toStr = format(range.to, "MMM d, yyyy")
  return `${fromStr} - ${toStr}`
}

function getActivePresetKey(range: DateRangeValue): string | null {
  const daysDiff = Math.round(differenceInDays(range.to, range.from))
  if (isSameDay(range.from, range.to) && isToday(range.from)) return "Today"
  if (daysDiff <= 1) return "24h"
  if (daysDiff >= 6 && daysDiff <= 8) return "7d"
  if (daysDiff >= 28 && daysDiff <= 31) return "30d"
  return null
}

export function GlobalOpsControlsBar({
  dateRange,
  onDateRangeChange,
  onExport,
  lastUpdated,
  autoRefresh,
  onAutoRefreshToggle,
}: GlobalOpsControlsBarProps) {
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)

  // Re-render every second when auto-refresh is on so "Updated Xs ago" increments
  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  const secondsAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 1000)
  const activePresetKey = getActivePresetKey(dateRange)

  const handlePreset = (preset: (typeof presets)[number]) => {
    onDateRangeChange(preset.getValue())
    setOpen(false)
  }

  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range?.from) return
    if (range.to) {
      onDateRangeChange({ from: range.from, to: range.to })
      setOpen(false)
    } else {
      onDateRangeChange({ from: range.from, to: range.from })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Quick preset buttons */}
      <div className="flex items-center rounded-lg border bg-card p-1">
        {presets.map((preset) => {
          const isActive = activePresetKey === preset.label
          return (
            <Button
              key={preset.label}
              type="button"
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 px-3 text-xs",
                isActive && "bg-primary text-primary-foreground"
              )}
              onClick={() => onDateRangeChange(preset.getValue())}
              aria-pressed={isActive}
              aria-label={`Date range: ${preset.label}`}
            >
              {preset.label}
            </Button>
          )
        })}
      </div>

      {/* Custom range: opens calendar dropdown */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-2 bg-transparent font-normal",
              activePresetKey === null && "border-primary/30 bg-primary/5"
            )}
            aria-expanded={open}
            aria-label="Pick custom date range"
          >
            <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
            {activePresetKey === null ? formatRangeLabel(dateRange) : "Custom range"}
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex">
            <div className="border-r p-2 space-y-1 min-w-[100px]">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs"
                  onClick={() => handlePreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <CalendarComponent
              mode="range"
              defaultMonth={dateRange.from}
              selected={{ from: dateRange.from, to: dateRange.to }}
              onSelect={handleCalendarSelect}
              numberOfMonths={2}
              disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
            />
          </div>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-6" />

      {/* Auto-refresh Toggle */}
      <div className="flex items-center gap-2">
        <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={onAutoRefreshToggle} className="scale-90" />
        <Label htmlFor="auto-refresh" className="text-xs text-muted-foreground cursor-pointer">
          Auto-refresh
        </Label>
        <span className="text-xs text-muted-foreground">Updated {secondsAgo}s ago</span>
      </div>

      <div className="ml-auto">
        <Button type="button" variant="outline" size="sm" className="h-8 gap-2 bg-transparent" onClick={onExport} aria-label="Export data">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>
    </div>
  )
}

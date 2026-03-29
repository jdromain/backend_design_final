"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { CalendarIcon, Download, X, ArrowLeftRight, ChevronDown } from "lucide-react"
import { format, startOfDay, subDays, isToday, isSameDay, differenceInDays } from "date-fns"
import { cn } from "@/lib/utils"
import type { DateRange } from "react-day-picker"

export interface AnalyticsFilters {
  dateRange: DateRange | undefined
  datePreset: string
  compareEnabled: boolean
  phoneLine: string
  outcome: string
  direction: string
}

interface AnalyticsControlsBarProps {
  filters: AnalyticsFilters
  onFiltersChange: (filters: AnalyticsFilters) => void
  phoneLines: string[]
  onExport?: () => void
}

type DateRangeValue = { from: Date; to: Date }

const datePresets = [
  { label: "Today", preset: "today", getValue: (): DateRangeValue => {
    const now = new Date()
    return { from: startOfDay(now), to: now }
  }},
  { label: "24h", preset: "24h", getValue: (): DateRangeValue => {
    const to = new Date()
    return { from: subDays(to, 1), to }
  }},
  { label: "7d", preset: "7d", getValue: (): DateRangeValue => {
    const to = new Date()
    return { from: subDays(to, 7), to }
  }},
  { label: "30d", preset: "30d", getValue: (): DateRangeValue => {
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

function getActivePresetKey(range: DateRangeValue | undefined): string | null {
  if (!range?.from || !range?.to) return null
  const daysDiff = Math.round(differenceInDays(range.to, range.from))
  if (isSameDay(range.from, range.to) && isToday(range.from)) return "today"
  if (daysDiff <= 1) return "24h"
  if (daysDiff >= 6 && daysDiff <= 8) return "7d"
  if (daysDiff >= 28 && daysDiff <= 31) return "30d"
  return null
}

export function AnalyticsControlsBar({ filters, onFiltersChange, phoneLines, onExport }: AnalyticsControlsBarProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const hasActiveFilters =
    filters.phoneLine !== "all" || filters.outcome !== "all" || filters.direction !== "all"

  const dateRange = filters.dateRange?.from && filters.dateRange?.to
    ? { from: filters.dateRange.from, to: filters.dateRange.to }
    : undefined
  const activePresetKey = dateRange ? getActivePresetKey(dateRange) : null

  const applyDateRange = (range: DateRangeValue, preset: string) => {
    onFiltersChange({
      ...filters,
      datePreset: preset,
      dateRange: range,
    })
  }

  const handlePresetClick = (preset: (typeof datePresets)[number]) => {
    applyDateRange(preset.getValue(), preset.preset)
  }

  const handleCustomPreset = (preset: (typeof datePresets)[number]) => {
    applyDateRange(preset.getValue(), preset.preset)
    setCustomOpen(false)
  }

  const handleCalendarSelect = (range: { from?: Date; to?: Date } | undefined) => {
    if (!range?.from) return
    if (range.to) {
      onFiltersChange({
        ...filters,
        datePreset: "custom",
        dateRange: { from: range.from, to: range.to },
      })
      setCustomOpen(false)
    } else {
      onFiltersChange({
        ...filters,
        datePreset: "custom",
        dateRange: { from: range.from, to: range.from },
      })
    }
  }

  const clearFilters = () => {
    onFiltersChange({
      ...filters,
      phoneLine: "all",
      outcome: "all",
      direction: "all",
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      {/* Date range: quick presets + custom (same pattern as dashboard) */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border bg-background p-1">
          {datePresets.map((preset) => {
            const isActive = activePresetKey === preset.preset
            return (
              <Button
                key={preset.preset}
                type="button"
                variant={isActive ? "secondary" : "ghost"}
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs",
                  isActive && "bg-primary text-primary-foreground"
                )}
                onClick={() => handlePresetClick(preset)}
                aria-pressed={isActive}
                aria-label={`Date range: ${preset.label}`}
              >
                {preset.label}
              </Button>
            )
          })}
        </div>

        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-2 bg-transparent font-normal",
                filters.datePreset === "custom" && "border-primary/30 bg-primary/5"
              )}
              aria-expanded={customOpen}
              aria-label="Pick custom date range"
            >
              <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
              {filters.datePreset === "custom" && dateRange
                ? formatRangeLabel(dateRange)
                : "Custom range"}
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 opacity-50 transition-transform", customOpen && "rotate-180")} />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
              <div className="border-r p-2 space-y-1 min-w-[100px]">
                {datePresets.map((preset) => (
                  <Button
                    key={preset.preset}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs"
                    onClick={() => handleCustomPreset(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <Calendar
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={handleCalendarSelect}
                numberOfMonths={2}
                disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="h-6 w-px bg-border" />

      {/* Compare Toggle */}
      <Button
        type="button"
        variant={filters.compareEnabled ? "default" : "outline"}
        size="sm"
        onClick={() => onFiltersChange({ ...filters, compareEnabled: !filters.compareEnabled })}
        className={cn("gap-1.5", !filters.compareEnabled && "bg-transparent")}
        aria-pressed={filters.compareEnabled}
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        Compare
      </Button>

      <div className="h-6 w-px bg-border" />

      {/* Filters */}
      <Select value={filters.phoneLine} onValueChange={(v) => onFiltersChange({ ...filters, phoneLine: v })}>
        <SelectTrigger className="w-[130px]" size="sm">
          <SelectValue placeholder="Phone Line" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Lines</SelectItem>
          {phoneLines.map((line) => (
            <SelectItem key={line} value={line}>
              {line}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.outcome} onValueChange={(v) => onFiltersChange({ ...filters, outcome: v })}>
        <SelectTrigger className="w-[120px]" size="sm">
          <SelectValue placeholder="Outcome" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Outcomes</SelectItem>
          <SelectItem value="handled">Handled</SelectItem>
          <SelectItem value="escalated">Escalated</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="abandoned">Abandoned</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.direction} onValueChange={(v) => onFiltersChange({ ...filters, direction: v })}>
        <SelectTrigger className="w-[120px]" size="sm">
          <SelectValue placeholder="Direction" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="inbound">Inbound</SelectItem>
          <SelectItem value="outbound">Outbound</SelectItem>
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-muted-foreground bg-transparent">
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}

      <div className="flex-1" />

      {/* Export */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5 bg-transparent"
        onClick={onExport ?? (() => {})}
      >
        <Download className="h-3.5 w-3.5" />
        Export
      </Button>
    </div>
  )
}

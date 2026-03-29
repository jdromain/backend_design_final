"use client"

import { useState } from "react"
import { Calendar, ChevronDown, Download, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as CalendarComponent } from "@/components/ui/calendar"
import { format } from "date-fns"
import { cn } from "@/lib/utils"

export interface BuiltInViewItem {
  id: string
  label: string
  description: string
}

export interface SavedViewForHeader {
  id: string
  name: string
  filters: unknown
  dateRange: { from: Date | string; to: Date | string }
}

interface CallHistoryHeaderProps {
  dateRange: { from: Date; to: Date }
  onDateRangeChange: (range: { from: Date; to: Date }) => void
  onExport: () => void
  builtInViews?: BuiltInViewItem[]
  userSavedViews?: SavedViewForHeader[]
  currentViewId?: string | null
  onSelectBuiltInView?: (viewId: string) => void
  onSelectUserView?: (view: SavedViewForHeader) => void
  onSaveCurrentView?: () => void
}

export function CallHistoryHeader({
  dateRange,
  onDateRangeChange,
  onExport,
  builtInViews = [],
  userSavedViews = [],
  currentViewId = null,
  onSelectBuiltInView,
  onSelectUserView,
  onSaveCurrentView,
}: CallHistoryHeaderProps) {
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  const presets = [
    { label: "Today", days: 0 },
    { label: "Last 24 hours", days: 1 },
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
  ]

  const applyPreset = (days: number) => {
    const to = new Date()
    const from = new Date()
    if (days === 0) {
      from.setHours(0, 0, 0, 0)
    } else {
      from.setDate(from.getDate() - days)
    }
    onDateRangeChange({ from, to })
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-2xl font-semibold">Call History</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="justify-start text-left font-normal bg-transparent">
              <Calendar className="mr-2 h-4 w-4" />
              {format(dateRange.from, "MMM d")} - {format(dateRange.to, "MMM d, yyyy")}
              <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="flex">
              <div className="border-r p-2 space-y-1">
                {presets.map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => {
                      applyPreset(preset.days)
                      setIsCalendarOpen(false)
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <CalendarComponent
                mode="range"
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={(range) => {
                  if (range?.from && range?.to) {
                    onDateRangeChange({ from: range.from, to: range.to })
                  }
                }}
                numberOfMonths={2}
              />
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Save className="mr-2 h-4 w-4" />
              Saved Views
              <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {builtInViews.map((view) => (
              <DropdownMenuItem
                key={view.id}
                className={cn(
                  "flex flex-col items-start cursor-pointer",
                  currentViewId === view.id && "bg-accent"
                )}
                onClick={() => onSelectBuiltInView?.(view.id)}
              >
                <span className="font-medium">{view.label}</span>
                <span className="text-xs text-muted-foreground">{view.description}</span>
              </DropdownMenuItem>
            ))}
            {builtInViews.length > 0 && userSavedViews.length > 0 && <DropdownMenuSeparator />}
            {userSavedViews.map((view) => (
              <DropdownMenuItem
                key={view.id}
                className={cn(
                  "flex flex-col items-start cursor-pointer",
                  currentViewId === view.id && "bg-accent"
                )}
                onClick={() => onSelectUserView?.(view)}
              >
                <span className="font-medium">{view.name}</span>
                <span className="text-xs text-muted-foreground">Saved view</span>
              </DropdownMenuItem>
            ))}
            {onSaveCurrentView && (
              <>
                {(builtInViews.length > 0 || userSavedViews.length > 0) && <DropdownMenuSeparator />}
                <DropdownMenuItem className="cursor-pointer" onClick={onSaveCurrentView}>
                  <Save className="mr-2 h-4 w-4" />
                  Save current view
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" onClick={onExport}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>
      </div>
    </div>
  )
}

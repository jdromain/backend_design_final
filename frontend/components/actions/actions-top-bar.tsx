"use client"

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Search, Plus, Moon, MoreHorizontal, Zap, ChevronDown, ChevronUp, X, Download, Clock, Trash2, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getRecentSearches, addRecentSearch, clearRecentSearches } from "@/lib/search-utils"

interface ActionsTopBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  ownerFilter: string
  onOwnerFilterChange: (owner: string) => void
  statusFilter: string
  onStatusFilterChange: (status: string) => void
  priorityFilter: string
  onPriorityFilterChange: (priority: string) => void
  typeFilter: string
  onTypeFilterChange: (type: string) => void
  verticalFilter: string
  onVerticalFilterChange: (vertical: string) => void
  dueFilter: string
  onDueFilterChange: (due: string) => void
  savedView: string
  onSavedViewChange: (view: string) => void
  quietHoursEnabled: boolean
  onQuietHoursChange: (enabled: boolean) => void
  onCreateFollowUp: () => void
  onExport?: (format: "csv" | "json") => void
  onResetView?: () => void
}

export function ActionsTopBar({
  searchQuery,
  onSearchChange,
  ownerFilter,
  onOwnerFilterChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  typeFilter,
  onTypeFilterChange,
  verticalFilter,
  onVerticalFilterChange,
  dueFilter,
  onDueFilterChange,
  savedView,
  onSavedViewChange,
  quietHoursEnabled,
  onQuietHoursChange,
  onCreateFollowUp,
  onExport,
  onResetView,
}: ActionsTopBarProps) {
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)
  const [searchHistoryOpen, setSearchHistoryOpen] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Load recent searches
  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

  // Update recent searches when search query changes
  useEffect(() => {
    if (searchQuery.trim() && searchQuery.length > 2) {
      addRecentSearch(searchQuery)
      setRecentSearches(getRecentSearches())
    }
  }, [searchQuery])

  const handleSearchChange = (value: string) => {
    onSearchChange(value)
    if (value.trim()) {
      setSearchHistoryOpen(false)
    }
  }

  const handleSelectRecentSearch = (query: string) => {
    onSearchChange(query)
    setSearchHistoryOpen(false)
    searchInputRef.current?.focus()
  }

  const handleClearHistory = () => {
    clearRecentSearches()
    setRecentSearches([])
  }

  // Helper functions to get filter labels
  const getStatusLabel = (value: string) => {
    const labels: Record<string, string> = {
      all: "All Status",
      open: "Open",
      overdue: "Overdue",
      done: "Done",
    }
    return labels[value] || value
  }

  const getDueLabel = (value: string) => {
    const labels: Record<string, string> = {
      all: "All Due",
      today: "Today",
      this_week: "This Week",
    }
    return labels[value] || value
  }

  const getPriorityLabel = (value: string) => {
    const labels: Record<string, string> = {
      all: "All Priority",
      high: "High",
      medium: "Medium",
      low: "Low",
    }
    return labels[value] || value
  }

  const getOwnerLabel = (value: string) => {
    const labels: Record<string, string> = {
      all: "All Owners",
      me: "Assigned to Me",
      unassigned: "Unassigned",
    }
    return labels[value] || value
  }

  const getVerticalLabel = (value: string) => {
    const labels: Record<string, string> = {
      all: "All Verticals",
      AutoShop: "Auto Shop",
      Restaurant: "Restaurant",
      Common: "General",
    }
    return labels[value] || value
  }

  const getTypeLabel = (value: string) => {
    const labels: Record<string, string> = {
      all: "All Types",
      missed_call: "Missed Call",
      booking: "Booking",
      estimate: "Estimate",
      complaint: "Complaint",
      catering: "Catering",
    }
    return labels[value] || value
  }

  const getSavedViewLabel = (value: string) => {
    const labels: Record<string, string> = {
      inbox: "Inbox",
      overdue: "Overdue",
      missed_calls: "Missed Calls",
    }
    return labels[value] || value
  }

  // Build active filters array
  const activeFilters: Array<{ key: string; label: string; onRemove: () => void }> = []

  if (savedView && savedView !== "inbox") {
    activeFilters.push({
      key: "savedView",
      label: `Queue: ${getSavedViewLabel(savedView)}`,
      onRemove: () => onSavedViewChange("inbox"),
    })
  }

  if (statusFilter && statusFilter !== "all") {
    activeFilters.push({
      key: "status",
      label: `Status: ${getStatusLabel(statusFilter)}`,
      onRemove: () => onStatusFilterChange("all"),
    })
  }

  if (dueFilter && dueFilter !== "all") {
    activeFilters.push({
      key: "due",
      label: `Due: ${getDueLabel(dueFilter)}`,
      onRemove: () => onDueFilterChange("all"),
    })
  }

  if (priorityFilter && priorityFilter !== "all") {
    activeFilters.push({
      key: "priority",
      label: `Priority: ${getPriorityLabel(priorityFilter)}`,
      onRemove: () => onPriorityFilterChange("all"),
    })
  }

  if (ownerFilter && ownerFilter !== "all") {
    activeFilters.push({
      key: "owner",
      label: `Owner: ${getOwnerLabel(ownerFilter)}`,
      onRemove: () => onOwnerFilterChange("all"),
    })
  }

  if (verticalFilter && verticalFilter !== "all") {
    activeFilters.push({
      key: "vertical",
      label: `Vertical: ${getVerticalLabel(verticalFilter)}`,
      onRemove: () => onVerticalFilterChange("all"),
    })
  }

  if (typeFilter && typeFilter !== "all") {
    activeFilters.push({
      key: "type",
      label: `Type: ${getTypeLabel(typeFilter)}`,
      onRemove: () => onTypeFilterChange("all"),
    })
  }

  const clearAllFilters = () => {
    onSavedViewChange("inbox")
    onStatusFilterChange("all")
    onDueFilterChange("all")
    onPriorityFilterChange("all")
    onOwnerFilterChange("all")
    onVerticalFilterChange("all")
    onTypeFilterChange("all")
  }

  return (
    <div className="border-b border-border bg-card px-4 py-4 space-y-4">
      {/* Row 1: Title + Actions */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Actions</h1>
          <p className="text-sm text-muted-foreground">Follow-ups & human handoffs</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCreateFollowUp} className="bg-transparent">
            <Plus className="h-4 w-4 mr-1" />
            Create Follow-Up
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 bg-transparent">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onExport && (
                <>
                  <DropdownMenuItem onClick={() => onExport("csv")}>
                    <Download className="h-4 w-4 mr-2" />
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onExport("json")}>
                    <Download className="h-4 w-4 mr-2" />
                    Export as JSON
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {onResetView && (
                <>
                  <DropdownMenuItem onClick={onResetView}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset View
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem>View Settings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Row 2: Search + Primary Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
        {/* Search with History */}
        <Popover open={searchHistoryOpen && !searchQuery && recentSearches.length > 0} onOpenChange={setSearchHistoryOpen}>
          <PopoverTrigger asChild>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <Input
                ref={searchInputRef}
                placeholder="Search contacts, phone, notes..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={() => {
                  if (!searchQuery && recentSearches.length > 0) {
                    setSearchHistoryOpen(true)
                  }
                }}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <div className="p-2">
              <div className="flex items-center justify-between px-2 py-1.5 mb-1">
                <span className="text-xs font-medium text-muted-foreground">Recent Searches</span>
                {recentSearches.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={handleClearHistory}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </div>
              {recentSearches.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No recent searches
                </div>
              ) : (
                <div className="space-y-0.5">
                  {recentSearches.map((query, index) => (
                    <button
                      key={index}
                      onClick={() => handleSelectRecentSearch(query)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent text-left transition-colors"
                    >
                      <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1">{query}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

          {/* Primary Filter Group */}
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <span className="text-xs text-muted-foreground font-medium">Queue:</span>
            <Select value={savedView} onValueChange={onSavedViewChange}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Queue" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inbox">Inbox</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="missed_calls">Missed Calls</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status & Priority Group */}
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <Select value={statusFilter} onValueChange={onStatusFilterChange}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={onPriorityFilterChange}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Due Date Group */}
          <div className="flex items-center gap-2 pl-3 border-l border-border">
            <Select value={dueFilter} onValueChange={onDueFilterChange}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Due Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Due</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="this_week">This Week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1" />

          {/* Quiet Hours */}
          <div className="flex items-center gap-2">
            <Switch
              id="quiet-hours"
              checked={quietHoursEnabled}
              onCheckedChange={onQuietHoursChange}
              className="scale-75"
            />
            <Label
              htmlFor="quiet-hours"
              className="text-xs text-muted-foreground cursor-pointer flex items-center gap-1"
            >
              <Moon className="h-3 w-3" />
              Quiet Hours
            </Label>
          </div>
        </div>

        {/* Active Filter Badges */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-medium">Active filters:</span>
            {activeFilters.map((filter) => (
              <Badge key={filter.key} variant="secondary" className="gap-1 pr-1">
                {filter.label}
                <button
                  onClick={filter.onRemove}
                  className="ml-1 rounded-full p-0.5 hover:bg-muted transition-colors"
                  aria-label={`Remove ${filter.label} filter`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          </div>
        )}
      </div>

      {/* Row 3: More Filters (Collapsible) */}
      <Collapsible open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7 px-2 bg-transparent">
              {moreFiltersOpen ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
              More Filters
            </Button>
          </CollapsibleTrigger>
          {!moreFiltersOpen && (ownerFilter !== "all" || verticalFilter !== "all" || typeFilter !== "all") && (
            <Badge variant="outline" className="text-xs">
              {[ownerFilter !== "all", verticalFilter !== "all", typeFilter !== "all"].filter(Boolean).length} active
            </Badge>
          )}
        </div>
        <CollapsibleContent className="pt-3">
          <div className="flex flex-wrap items-center gap-3 pl-3 border-l border-border">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium">Owner:</span>
              <Select value={ownerFilter} onValueChange={onOwnerFilterChange}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Owners</SelectItem>
                  <SelectItem value="me">Assigned to Me</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <span className="text-xs text-muted-foreground font-medium">Vertical:</span>
              <Select value={verticalFilter} onValueChange={onVerticalFilterChange}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Vertical" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Verticals</SelectItem>
                  <SelectItem value="AutoShop">Auto Shop</SelectItem>
                  <SelectItem value="Restaurant">Restaurant</SelectItem>
                  <SelectItem value="Common">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <span className="text-xs text-muted-foreground font-medium">Type:</span>
              <Select value={typeFilter} onValueChange={onTypeFilterChange}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="missed_call">Missed Call</SelectItem>
                  <SelectItem value="booking">Booking</SelectItem>
                  <SelectItem value="estimate">Estimate</SelectItem>
                  <SelectItem value="complaint">Complaint</SelectItem>
                  <SelectItem value="catering">Catering</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

"use client"

import { LayoutGrid, List, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type TabValue = "all" | "active" | "paused" | "draft"
export type SortValue = "recently_updated" | "most_calls" | "highest_failure"
export type ViewMode = "table" | "cards"

interface ActiveFilter {
  type: "status" | "phoneLine" | "agentType"
  value: string
  label: string
}

interface AgentsToolbarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  tab: TabValue
  onTabChange: (tab: TabValue) => void
  statusFilter: string
  onStatusFilterChange: (status: string) => void
  phoneLineFilter: string
  onPhoneLineFilterChange: (line: string) => void
  typeFilter: string
  onTypeFilterChange: (type: string) => void
  needsAttentionOnly: boolean
  onNeedsAttentionChange: (checked: boolean) => void
  needsAttentionCount: number
  sortBy: SortValue
  onSortChange: (sort: SortValue) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  phoneLines: string[]
}

export function AgentsToolbar({
  searchQuery,
  onSearchChange,
  tab,
  onTabChange,
  statusFilter,
  onStatusFilterChange,
  phoneLineFilter,
  onPhoneLineFilterChange,
  typeFilter,
  onTypeFilterChange,
  needsAttentionOnly,
  onNeedsAttentionChange,
  needsAttentionCount,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  phoneLines,
}: AgentsToolbarProps) {
  // Build active filters list
  const activeFilters: ActiveFilter[] = []
  if (statusFilter !== "all") {
    activeFilters.push({ type: "status", value: statusFilter, label: `Status: ${statusFilter}` })
  }
  if (phoneLineFilter !== "all") {
    activeFilters.push({ type: "phoneLine", value: phoneLineFilter, label: `Line: ${phoneLineFilter}` })
  }
  if (typeFilter !== "all") {
    activeFilters.push({ type: "agentType", value: typeFilter, label: `Type: ${typeFilter}` })
  }

  const clearFilter = (filter: ActiveFilter) => {
    switch (filter.type) {
      case "status":
        onStatusFilterChange("all")
        break
      case "phoneLine":
        onPhoneLineFilterChange("all")
        break
      case "agentType":
        onTypeFilterChange("all")
        break
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter + Sort Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => onTabChange(v as TabValue)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="paused">Paused</TabsTrigger>
              <TabsTrigger value="draft">Draft</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>

          <Select value={phoneLineFilter} onValueChange={onPhoneLineFilterChange}>
            <SelectTrigger className="w-[160px]">
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

          <Select value={typeFilter} onValueChange={onTypeFilterChange}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="booking">Booking</SelectItem>
              <SelectItem value="support">Support</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
            <Switch id="needs-attention" checked={needsAttentionOnly} onCheckedChange={onNeedsAttentionChange} />
            <Label htmlFor="needs-attention" className="text-sm cursor-pointer whitespace-nowrap">
              Needs Attention
              {needsAttentionCount > 0 && (
                <Badge variant="secondary" className="ml-1.5">
                  {needsAttentionCount}
                </Badge>
              )}
            </Label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Select value={sortBy} onValueChange={(v) => onSortChange(v as SortValue)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recently_updated">Recently updated</SelectItem>
              <SelectItem value="most_calls">Most calls today</SelectItem>
              <SelectItem value="highest_failure">Highest failure rate</SelectItem>
            </SelectContent>
          </Select>

          {/* View Toggle */}
          <div className="flex items-center rounded-md border p-1">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => onViewModeChange("table")}
            >
              <List className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => onViewModeChange("cards")}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Active Filter Chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Filters:</span>
          {activeFilters.map((filter) => (
            <Badge key={`${filter.type}-${filter.value}`} variant="secondary" className="gap-1 pr-1">
              {filter.label}
              <button
                onClick={() => clearFilter(filter)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => {
              onStatusFilterChange("all")
              onPhoneLineFilterChange("all")
              onTypeFilterChange("all")
            }}
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  )
}

"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface AgentFilters {
  tab: "all" | "active" | "paused"
  status: string
  phoneLine: string
  agentType: string
  sortBy: string
}

interface AgentsFiltersBarProps {
  filters: AgentFilters
  onFiltersChange: (filters: AgentFilters) => void
  phoneLines: string[]
}

export function AgentsFiltersBar({ filters, onFiltersChange, phoneLines }: AgentsFiltersBarProps) {
  const hasActiveFilters = filters.status !== "all" || filters.phoneLine !== "all" || filters.agentType !== "all"

  const clearFilters = () => {
    onFiltersChange({
      ...filters,
      status: "all",
      phoneLine: "all",
      agentType: "all",
    })
  }

  return (
    <div className="space-y-4">
      <Tabs value={filters.tab} onValueChange={(v) => onFiltersChange({ ...filters, tab: v as AgentFilters["tab"] })}>
        <TabsList>
          <TabsTrigger value="all">All Agents</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="paused">Paused</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={filters.status} onValueChange={(v) => onFiltersChange({ ...filters, status: v })}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.phoneLine} onValueChange={(v) => onFiltersChange({ ...filters, phoneLine: v })}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Phone Line" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Phone Lines</SelectItem>
            {phoneLines.map((line) => (
              <SelectItem key={line} value={line}>
                {line}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.agentType} onValueChange={(v) => onFiltersChange({ ...filters, agentType: v })}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Agent Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="support">Support</SelectItem>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="booking">Booking</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <Select value={filters.sortBy} onValueChange={(v) => onFiltersChange({ ...filters, sortBy: v })}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="calls_today">Most calls today</SelectItem>
              <SelectItem value="handled_rate_asc">Worst handled rate</SelectItem>
              <SelectItem value="escalation_rate_desc">Highest escalation</SelectItem>
              <SelectItem value="recently_updated">Recently updated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2">
            <X className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}

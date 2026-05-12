"use client"

import { useState } from "react"
import { Search, ChevronDown, ChevronUp, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  CANONICAL_ACTION_CLASS_FILTER_OPTIONS,
  CANONICAL_END_REASON_FILTER_OPTIONS,
  CANONICAL_FAILURE_CATEGORY_FILTER_OPTIONS,
  CANONICAL_OUTCOME_FILTER_OPTIONS,
  type CanonicalActionClass,
  type CanonicalEndReason,
  type CanonicalFailureCategory,
  type CanonicalOutcome,
} from "@/lib/call-labels"

export interface Filters {
  search: string
  results: CanonicalOutcome[]
  intent: string
  phoneLine: string
  direction: string
  endReason: CanonicalEndReason | ""
  failureCategory: CanonicalFailureCategory | ""
  actionClass: CanonicalActionClass | ""
  durationBucket: string
  toolUsed: string
  toolErrorsOnly: boolean
  tags: string[]
}

interface CallHistoryFiltersProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  phoneLines: { id: string; number: string }[]
  tools: string[]
  intents?: string[]
  endReasons?: string[]
  directions?: string[]
}

export function CallHistoryFilters({
  filters,
  onFiltersChange,
  phoneLines,
  tools,
  intents = ["Billing", "Support", "Sales", "Booking", "Unknown"],
  endReasons = [],
  directions = ["inbound", "outbound"],
}: CallHistoryFiltersProps) {
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)

  const results = CANONICAL_OUTCOME_FILTER_OPTIONS
  const canonicalEndReasonOptions =
    endReasons.length > 0
      ? CANONICAL_END_REASON_FILTER_OPTIONS.filter((option) => {
          const optionValue = option.value.toLowerCase()
          const optionLabel = option.label.toLowerCase()
          return endReasons.some((facet) => {
            const f = facet.trim().toLowerCase()
            return f === optionValue || f === optionLabel
          })
        })
      : CANONICAL_END_REASON_FILTER_OPTIONS

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const toggleResult = (result: CanonicalOutcome) => {
    const newResults = filters.results.includes(result)
      ? filters.results.filter((r) => r !== result)
      : [...filters.results, result]
    updateFilter("results", newResults)
  }

  const clearFilters = () => {
    onFiltersChange({
      search: "",
      results: [],
      intent: "",
      phoneLine: "",
      direction: "",
      endReason: "",
      failureCategory: "",
      actionClass: "",
      durationBucket: "",
      toolUsed: "",
      toolErrorsOnly: false,
      tags: [],
    })
  }

  const hasActiveFilters =
    filters.search ||
    filters.results.length > 0 ||
    filters.intent ||
    filters.phoneLine ||
    filters.direction ||
    filters.endReason ||
    filters.failureCategory ||
    filters.actionClass ||
    filters.toolUsed ||
    filters.toolErrorsOnly

  return (
    <div className="space-y-3">
      {/* Row 1 - Always visible */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by caller, phone, or call ID..."
            value={filters.search}
            onChange={(e) => updateFilter("search", e.target.value)}
            className="pl-9"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-w-[140px] bg-transparent">
              Outcome
              {filters.results.length > 0 && (
                <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  {filters.results.length}
                </span>
              )}
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {results.map((result) => (
              <DropdownMenuCheckboxItem
                key={result.value}
                checked={filters.results.includes(result.value)}
                onCheckedChange={() => toggleResult(result.value)}
              >
                {result.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={filters.intent || "all"} onValueChange={(v) => updateFilter("intent", v === "all" ? "" : v)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Call Reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All call reasons</SelectItem>
            {intents.map((intent) => (
              <SelectItem key={intent} value={intent}>
                {intent}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.direction || "all"}
          onValueChange={(v) => updateFilter("direction", v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {directions.map((dir) => (
              <SelectItem key={dir} value={dir}>
                <span className="capitalize">{dir}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center space-x-2">
          <Switch
            id="tool-errors-main"
            checked={filters.toolErrorsOnly}
            onCheckedChange={(v) => updateFilter("toolErrorsOnly", v)}
          />
          <Label htmlFor="tool-errors-main" className="text-sm">
            System/tool issues only
          </Label>
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-4 w-4" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Row 2 - Collapsible More Filters */}
      <Collapsible open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            {moreFiltersOpen ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
            Advanced Filters
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={filters.phoneLine || "all"}
              onValueChange={(v) => updateFilter("phoneLine", v === "all" ? "" : v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Phone Line" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Lines</SelectItem>
                {phoneLines.map((line) => (
                  <SelectItem key={line.id} value={line.id}>
                    {line.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.endReason || "all"}
              onValueChange={(v) => updateFilter("endReason", v === "all" ? "" : (v as CanonicalEndReason))}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="How Call Ended" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {canonicalEndReasonOptions.map((reason) => (
                  <SelectItem key={reason.value} value={reason.value}>
                    {reason.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.toolUsed} onValueChange={(v) => updateFilter("toolUsed", v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="System Tool Used" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tools</SelectItem>
                {tools.map((tool) => (
                  <SelectItem key={tool} value={tool}>
                    {tool}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.failureCategory || "all"}
              onValueChange={(v) => updateFilter("failureCategory", v === "all" ? "" : (v as CanonicalFailureCategory))}
            >
              <SelectTrigger className="w-[210px]">
                <SelectValue placeholder="Failure Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All failure types</SelectItem>
                {CANONICAL_FAILURE_CATEGORY_FILTER_OPTIONS.map((category) => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.actionClass || "all"}
              onValueChange={(v) => updateFilter("actionClass", v === "all" ? "" : (v as CanonicalActionClass))}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Recommended Action Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All recommended action types</SelectItem>
                {CANONICAL_ACTION_CLASS_FILTER_OPTIONS.map((action) => (
                  <SelectItem key={action.value} value={action.value}>
                    {action.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

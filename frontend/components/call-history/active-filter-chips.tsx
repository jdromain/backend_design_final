"use client"

import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Filters } from "./call-history-filters"
import {
  CANONICAL_ACTION_CLASS_FILTER_OPTIONS,
  CANONICAL_FAILURE_CATEGORY_FILTER_OPTIONS,
  toDisplayReason,
} from "@/lib/call-labels"

const resultLabels: Record<string, string> = {
  handled: "Handled",
  transferred: "Handoff",
  abandoned: "Dropped",
  failed: "System Failed",
  unknown: "Unknown",
}

interface ActiveFilterChipsProps {
  filters: Filters
  onRemoveFilter: (key: keyof Filters, value?: string) => void
  phoneLines: { id: string; number: string }[]
}

export function ActiveFilterChips({ filters, onRemoveFilter, phoneLines }: ActiveFilterChipsProps) {
  const chips: { label: string; key: keyof Filters; value?: string }[] = []

  filters.results.forEach((result) => {
    chips.push({ label: `Outcome: ${resultLabels[result] || result}`, key: "results", value: result })
  })

  if (filters.intent && filters.intent !== "all") {
    chips.push({ label: `Classified intent: ${filters.intent}`, key: "intent" })
  }

  if (filters.phoneLine && filters.phoneLine !== "all") {
    const line = phoneLines.find((l) => l.id === filters.phoneLine)
    chips.push({ label: `Line: ${line?.number || filters.phoneLine}`, key: "phoneLine" })
  }

  if (filters.direction && filters.direction !== "all") {
    chips.push({ label: `Direction: ${filters.direction}`, key: "direction" })
  }

  if (filters.endReason) {
    chips.push({
      label: `End: ${toDisplayReason(filters.endReason)}`,
      key: "endReason",
    })
  }

  if (filters.failureCategory) {
    const label = CANONICAL_FAILURE_CATEGORY_FILTER_OPTIONS.find((o) => o.value === filters.failureCategory)?.label ?? filters.failureCategory
    chips.push({ label: `Failure: ${label}`, key: "failureCategory" })
  }

  if (filters.actionClass) {
    const label = CANONICAL_ACTION_CLASS_FILTER_OPTIONS.find((o) => o.value === filters.actionClass)?.label ?? filters.actionClass
    chips.push({ label: `Action: ${label}`, key: "actionClass" })
  }

  if (filters.toolUsed && filters.toolUsed !== "all") {
    chips.push({ label: `Tool: ${filters.toolUsed}`, key: "toolUsed" })
  }

  if (filters.toolErrorsOnly) {
    chips.push({ label: "Has tool errors", key: "toolErrorsOnly" })
  }

  if (filters.durationBucket === "1m+") {
    chips.push({ label: "Duration: 1m+", key: "durationBucket" })
  }

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip, index) => (
        <Badge key={`${chip.key}-${chip.value || index}`} variant="secondary" className="gap-1 pr-1">
          {chip.label}
          <button
            onClick={() => onRemoveFilter(chip.key, chip.value)}
            className="ml-1 rounded-full p-0.5 hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  )
}

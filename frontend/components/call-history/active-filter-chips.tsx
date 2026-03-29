"use client"

import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { Filters } from "./call-history-filters"

const resultLabels: Record<string, string> = {
  completed: "Completed",
  handoff: "Handoff",
  dropped: "Dropped",
  systemFailed: "System Failed",
}

interface ActiveFilterChipsProps {
  filters: Filters
  onRemoveFilter: (key: keyof Filters, value?: string) => void
  phoneLines: { id: string; number: string }[]
}

export function ActiveFilterChips({ filters, onRemoveFilter, phoneLines }: ActiveFilterChipsProps) {
  const chips: { label: string; key: keyof Filters; value?: string }[] = []

  filters.results.forEach((result) => {
    chips.push({ label: `Result: ${resultLabels[result] || result}`, key: "results", value: result })
  })

  if (filters.intent && filters.intent !== "all") {
    chips.push({ label: `Intent: ${filters.intent}`, key: "intent" })
  }

  if (filters.phoneLine && filters.phoneLine !== "all") {
    const line = phoneLines.find((l) => l.id === filters.phoneLine)
    chips.push({ label: `Line: ${line?.number || filters.phoneLine}`, key: "phoneLine" })
  }

  if (filters.direction && filters.direction !== "all") {
    chips.push({ label: `Direction: ${filters.direction}`, key: "direction" })
  }

  if (filters.endReason && filters.endReason !== "all") {
    chips.push({
      label: `End: ${filters.endReason}`,
      key: "endReason",
    })
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

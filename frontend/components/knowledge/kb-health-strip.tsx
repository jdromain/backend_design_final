"use client"

import { FileText, CheckCircle, Loader2, XCircle, Layers } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

interface KbHealthStripProps {
  totalDocs: number
  readyDocs: number
  processingDocs: number
  failedDocs: number
  totalChunks: number
}

export function KbHealthStrip({ totalDocs, readyDocs, processingDocs, failedDocs, totalChunks }: KbHealthStripProps) {
  const metrics = [
    { label: "Total Docs", value: totalDocs, icon: FileText, color: "text-foreground" },
    { label: "Ready", value: readyDocs, icon: CheckCircle, color: "text-emerald-500" },
    { label: "Processing", value: processingDocs, icon: Loader2, color: "text-amber-500", spin: true },
    { label: "Failed", value: failedDocs, icon: XCircle, color: "text-red-500" },
    { label: "Total Chunks", value: totalChunks.toLocaleString(), icon: Layers, color: "text-blue-500" },
  ]

  return (
    <div
      className="grid grid-cols-2 gap-3 p-4 bg-muted/50 rounded-lg border sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2"
      role="status"
      aria-live="polite"
    >
      {metrics.map((metric) => (
        <div key={metric.label} className="flex min-w-0 items-center gap-2">
          <metric.icon
            className={`h-4 w-4 shrink-0 ${metric.color} ${metric.spin && processingDocs > 0 ? "animate-spin" : ""}`}
            aria-hidden
          />
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums">{metric.value}</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{metric.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function KbHealthStripSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 bg-muted/50 rounded-lg border sm:flex sm:flex-wrap sm:gap-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  )
}

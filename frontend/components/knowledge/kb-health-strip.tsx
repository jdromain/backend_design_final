"use client"

import { FileText, CheckCircle, Loader2, XCircle, Layers } from "lucide-react"

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
    <div className="flex items-center gap-6 p-4 bg-muted/50 rounded-lg border">
      {metrics.map((metric, index) => (
        <div key={metric.label} className="flex items-center gap-2">
          <metric.icon className={`h-4 w-4 ${metric.color} ${metric.spin ? "animate-spin" : ""}`} />
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold">{metric.value}</span>
            <span className="text-xs text-muted-foreground">{metric.label}</span>
          </div>
          {index < metrics.length - 1 && <div className="ml-4 h-6 w-px bg-border" />}
        </div>
      ))}
    </div>
  )
}

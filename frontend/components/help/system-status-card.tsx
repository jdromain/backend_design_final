"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, ExternalLink } from "lucide-react"

interface ServiceStatus {
  name: string
  status: "operational" | "degraded" | "outage"
}

const mockServices: ServiceStatus[] = [
  { name: "API", status: "operational" },
  { name: "Telephony", status: "operational" },
  { name: "LLM Gateway", status: "operational" },
  { name: "Knowledge Base", status: "operational" },
  { name: "Redis", status: "operational" },
]

interface SystemStatusCardProps {
  onViewDetails: () => void
}

export function SystemStatusCard({ onViewDetails }: SystemStatusCardProps) {
  const [lastChecked, setLastChecked] = useState(new Date())
  const [isRefreshing, setIsRefreshing] = useState(false)

  const overallStatus = mockServices.every((s) => s.status === "operational")
    ? "operational"
    : mockServices.some((s) => s.status === "outage")
      ? "outage"
      : "degraded"

  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => {
      setLastChecked(new Date())
      setIsRefreshing(false)
    }, 1000)
  }

  const statusConfig = {
    operational: {
      icon: CheckCircle,
      label: "All systems operational",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    degraded: { icon: AlertTriangle, label: "Degraded performance", color: "text-amber-400", bg: "bg-amber-500/10" },
    outage: { icon: XCircle, label: "System outage", color: "text-red-400", bg: "bg-red-500/10" },
  }

  const config = statusConfig[overallStatus]
  const StatusIcon = config.icon

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">System Status</CardTitle>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`flex items-center gap-2 p-3 rounded-lg ${config.bg}`}>
          <StatusIcon className={`h-4 w-4 ${config.color}`} />
          <span className={`text-sm font-medium ${config.color}`}>{config.label}</span>
        </div>

        <div className="space-y-2">
          {mockServices.map((service) => {
            const sConfig = statusConfig[service.status]
            const SIcon = sConfig.icon
            return (
              <div key={service.name} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{service.name}</span>
                <SIcon className={`h-3.5 w-3.5 ${sConfig.color}`} />
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <span className="text-xs text-muted-foreground">
            Last checked: {Math.round((Date.now() - lastChecked.getTime()) / 60000) || "<1"} min ago
          </span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onViewDetails}>
            View details
            <ExternalLink className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

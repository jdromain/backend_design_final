"use client"

import { useState } from "react"
import { Phone, PhoneIncoming, AlertTriangle, Activity, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

export type SystemStatusType = "operational" | "degraded" | "incident"

interface CapacityStripProps {
  concurrencyUsed: number
  concurrencyLimit: number
  ringingCount: number
  activeCount: number
  handoffCount: number
  atRiskCount: number
  errorsCount: number
  systemStatus: SystemStatusType
  statusDetails?: {
    telephony: { name: string; status: string; latency?: number }[]
    integrations: { name: string; status: string; message?: string }[]
    incidents: { id: string; title: string; status: string; time: Date }[]
  }
}

export function CapacityStrip({
  concurrencyUsed,
  concurrencyLimit,
  ringingCount,
  activeCount,
  handoffCount,
  atRiskCount,
  errorsCount,
  systemStatus,
  statusDetails,
}: CapacityStripProps) {
  const [statusOpen, setStatusOpen] = useState(false)
  const utilization = Math.round((concurrencyUsed / concurrencyLimit) * 100)

  const statusConfig = {
    operational: { label: "Operational", color: "bg-emerald-500", textColor: "text-emerald-600" },
    degraded: { label: "Degraded", color: "bg-amber-500", textColor: "text-amber-600" },
    incident: { label: "Incident", color: "bg-red-500", textColor: "text-red-600" },
  }

  const config = statusConfig[systemStatus]

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 px-4 py-2.5">
      {/* Concurrency */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Concurrency</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {concurrencyUsed} / {concurrencyLimit}
          </span>
        </div>
        <Progress value={utilization} className="h-2 w-20" />
      </div>

      <div className="h-4 w-px bg-border" />

      {/* Ringing */}
      <div className="flex items-center gap-2">
        <PhoneIncoming className="h-4 w-4 text-blue-500" />
        <span className="text-sm">
          <span className="font-medium">{ringingCount}</span>
          <span className="text-muted-foreground ml-1">Ringing</span>
        </span>
      </div>

      {/* Active */}
      <div className="flex items-center gap-2">
        <Phone className="h-4 w-4 text-emerald-500" />
        <span className="text-sm">
          <span className="font-medium">{activeCount}</span>
          <span className="text-muted-foreground ml-1">Active</span>
        </span>
      </div>

      {/* Handoff */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <span className="text-sm">
          <span className="font-medium">{handoffCount}</span>
          <span className="text-muted-foreground ml-1">Handoff</span>
        </span>
      </div>

      {/* At Risk */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-orange-500" />
        <span className="text-sm">
          <span className="font-medium">{atRiskCount}</span>
          <span className="text-muted-foreground ml-1">At Risk</span>
        </span>
      </div>

      {/* Errors */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-red-500" />
        <span className="text-sm">
          <span className="font-medium">{errorsCount}</span>
          <span className="text-muted-foreground ml-1">Errors</span>
        </span>
      </div>

      <div className="h-4 w-px bg-border" />

      {/* System Status */}
      <Sheet open={statusOpen} onOpenChange={setStatusOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-2 px-2">
            <span className={cn("h-2 w-2 rounded-full", config.color)} />
            <span className={cn("text-sm font-medium", config.textColor)}>{config.label}</span>
            <ChevronRight className="h-3 w-3" />
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>System Status</SheetTitle>
            <SheetDescription>Current system health and recent incidents</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {/* Telephony */}
            <div>
              <h4 className="text-sm font-medium mb-3">Telephony</h4>
              <div className="space-y-2">
                {statusDetails?.telephony.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          item.status === "operational" ? "bg-emerald-500" : "bg-amber-500",
                        )}
                      />
                      <span className="text-sm">{item.name}</span>
                    </div>
                    {item.latency && <span className="text-xs text-muted-foreground">{item.latency}ms</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Integrations */}
            <div>
              <h4 className="text-sm font-medium mb-3">Integrations</h4>
              <div className="space-y-2">
                {statusDetails?.integrations.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          item.status === "operational" ? "bg-emerald-500" : "bg-amber-500",
                        )}
                      />
                      <span className="text-sm">{item.name}</span>
                    </div>
                    {item.message && <span className="text-xs text-muted-foreground">{item.message}</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Incidents */}
            <div>
              <h4 className="text-sm font-medium mb-3">Recent Incidents</h4>
              {statusDetails?.incidents && statusDetails.incidents.length > 0 ? (
                <div className="space-y-2">
                  {statusDetails.incidents.map((incident) => (
                    <div key={incident.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{incident.title}</span>
                        <Badge variant="outline" className="text-xs">
                          {incident.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No recent incidents</p>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

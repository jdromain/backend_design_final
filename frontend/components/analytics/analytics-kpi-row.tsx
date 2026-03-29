"use client"

import type React from "react"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Clock, AlertTriangle, XCircle, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface KpiData {
  label: string
  value: string
  subtext: string
  delta: number
  deltaLabel: string
  icon: React.ElementType
  onClick?: () => void
}

interface AnalyticsKpiRowProps {
  kpis: KpiData[]
  compareEnabled: boolean
}

export function AnalyticsKpiRow({ kpis, compareEnabled }: AnalyticsKpiRowProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi, index) => {
        const Icon = kpi.icon
        const isPositive = kpi.delta >= 0
        const TrendIcon = isPositive ? TrendingUp : TrendingDown

        return (
          <Card
            key={index}
            className={cn(
              "cursor-pointer transition-all hover:border-primary/50 hover:shadow-md",
              kpi.onClick && "hover:bg-accent/50",
            )}
            onClick={kpi.onClick}
          >
            <CardContent className="pt-6">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
                  <p className="text-3xl font-bold tracking-tight">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground">{kpi.subtext}</p>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>
              {compareEnabled && (
                <div
                  className={cn(
                    "mt-3 flex items-center gap-1 text-sm font-medium",
                    isPositive ? "text-emerald-500" : "text-red-500",
                  )}
                >
                  <TrendIcon className="h-4 w-4" />
                  <span>
                    {isPositive ? "+" : ""}
                    {kpi.delta.toFixed(1)}%
                  </span>
                  <span className="text-muted-foreground font-normal">{kpi.deltaLabel}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function getDefaultKpis(
  data: {
    handledRate: number
    avgDuration: number
    failureRate: number
    escalationRate: number
    totalCalls: number
    handledCalls: number
    failedCalls: number
    escalatedCalls: number
  },
  onDrilldown: (filter: string, value: string) => void,
): KpiData[] {
  return [
    {
      label: "Handled Rate",
      value: `${data.handledRate.toFixed(1)}%`,
      subtext: `${data.handledCalls} of ${data.totalCalls} calls`,
      delta: 2.3,
      deltaLabel: "vs previous",
      icon: CheckCircle,
      onClick: () => onDrilldown("outcome", "handled"),
    },
    {
      label: "Avg Duration",
      value: `${Math.floor(data.avgDuration / 60)}m ${data.avgDuration % 60}s`,
      subtext: "Average call length",
      delta: -5.2,
      deltaLabel: "vs previous",
      icon: Clock,
      onClick: undefined,
    },
    {
      label: "Failure Rate",
      value: `${data.failureRate.toFixed(1)}%`,
      subtext: `${data.failedCalls} calls failed`,
      delta: -0.8,
      deltaLabel: "vs previous",
      icon: XCircle,
      onClick: () => onDrilldown("outcome", "failed"),
    },
    {
      label: "Escalation Rate",
      value: `${data.escalationRate.toFixed(1)}%`,
      subtext: `${data.escalatedCalls} escalations`,
      delta: 1.2,
      deltaLabel: "vs previous",
      icon: AlertTriangle,
      onClick: () => onDrilldown("outcome", "escalated"),
    },
  ]
}

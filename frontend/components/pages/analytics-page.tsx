"use client"

import { useState, useMemo, useEffect } from "react"
import { useRouter } from "next/navigation"
import { AnalyticsControlsBar, type AnalyticsFilters } from "@/components/analytics/analytics-controls-bar"
import { AnalyticsKpiRow, getDefaultKpis } from "@/components/analytics/analytics-kpi-row"
import { OutcomesOverTimeChart } from "@/components/analytics/outcomes-over-time-chart"
import { VolumeModule } from "@/components/analytics/volume-module"
import { ToolsPerformanceTable } from "@/components/analytics/tools-performance-table"
import { AssistantPerformanceCard } from "@/components/analytics/agent-performance-table"
import { InsightsCard } from "@/components/analytics/insights-card"
import { KpiRowSkeleton, ChartSkeleton } from "@/components/loading-skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

import {
  getPhoneLines,
  getToolsPerformance,
  getAgentPerformance,
  getAnalyticsInsights,
} from "@/lib/data/analytics"
import { getDashboardOutcomes, getSparklineData } from "@/lib/data/dashboard"

interface AnalyticsPageProps {
  onNavigate?: (page: string, params?: Record<string, string>) => void
}

export function AnalyticsPage({ onNavigate }: AnalyticsPageProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(true)
  const [phoneLines, setPhoneLines] = useState<string[]>([])
  const [toolsPerformance, setToolsPerformance] = useState<{ name: string; usageCount: number; failureRate: number; avgLatency: number; lastFailure: string | null }[]>([])
  const [agentPerformance, setAgentPerformance] = useState<{
    name: string
    version?: string
    totalCalls: number
    handledRate: number
    escalationRate: number
    failureRate: number
    avgDuration: number
    topIntents?: { name: string; count: number; percentage: number }[]
  } | null>(null)
  const [insights, setInsights] = useState<{ type: string; title: string; detail: string; severity: string }[]>([])
  const [outcomesSeries, setOutcomesSeries] = useState<
    { time: string; handled: number; escalated: number; failed: number; abandoned: number }[]
  >([])
  const [hourlyData, setHourlyData] = useState<{ hour: string; calls: number }[]>([])
  const [heatmapData, setHeatmapData] = useState<{ day: string; hours: number[] }[]>([])
  const [filters, setFilters] = useState<AnalyticsFilters>({
    dateRange: { from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() },
    datePreset: "7d",
    compareEnabled: false,
    phoneLine: "all",
    outcome: "all",
    direction: "all",
  })

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getPhoneLines(),
      getToolsPerformance(),
      getAgentPerformance(),
      getAnalyticsInsights(),
      getDashboardOutcomes(),
      getSparklineData(),
    ])
      .then(([lines, tools, agent, insightList, rawOutcomes, spark]) => {
        if (cancelled) return
        setPhoneLines(lines)
        setToolsPerformance(tools)
        setAgentPerformance(agent)
        setInsights(insightList)
        const mapped =
          rawOutcomes.length > 0
            ? rawOutcomes.map((p) => ({
                time: p.time,
                handled: p.completed,
                escalated: p.handoff,
                failed: p.systemFailed,
                abandoned: p.dropped,
              }))
            : [
                {
                  time: "—",
                  handled: 0,
                  escalated: 0,
                  failed: 0,
                  abandoned: 0,
                },
              ]
        setOutcomesSeries(mapped)
        setHourlyData(
          Array.from({ length: 24 }, (_, hour) => ({
            hour: hour.toString().padStart(2, "0") + ":00",
            calls: spark.calls[hour] ?? 0,
          })),
        )
        const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        setHeatmapData(
          days.map((day) => ({
            day,
            hours: Array.from({ length: 24 }, () => 0),
          })),
        )
      })
      .catch(() => {
        if (cancelled) return
        setPhoneLines([])
        setToolsPerformance([])
        setAgentPerformance(null)
        setInsights([])
        setOutcomesSeries([
          { time: "—", handled: 0, escalated: 0, failed: 0, abandoned: 0 },
        ])
        setHourlyData(
          Array.from({ length: 24 }, (_, hour) => ({
            hour: hour.toString().padStart(2, "0") + ":00",
            calls: 0,
          })),
        )
        setHeatmapData(
          ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => ({
            day,
            hours: Array.from({ length: 24 }, () => 0),
          })),
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const kpiData = useMemo(() => {
    const totalCalls = agentPerformance?.totalCalls ?? 0
    const handledCalls = totalCalls > 0 ? Math.round((totalCalls * (agentPerformance?.handledRate ?? 0)) / 100) : 0
    const failedCalls = totalCalls > 0 ? Math.round((totalCalls * (agentPerformance?.failureRate ?? 0)) / 100) : 0
    const escalatedCalls = totalCalls > 0 ? Math.round((totalCalls * (agentPerformance?.escalationRate ?? 0)) / 100) : 0
    return {
      handledRate: agentPerformance?.handledRate ?? 0,
      avgDuration: agentPerformance?.avgDuration ?? 0,
      failureRate: agentPerformance?.failureRate ?? 0,
      escalationRate: agentPerformance?.escalationRate ?? 0,
      totalCalls,
      handledCalls,
      failedCalls,
      escalatedCalls,
    }
  }, [agentPerformance])

  const handleDrilldown = (filterType: string, value: string) => {
    toast({
      title: "Navigating to Call History",
      description: `Filtering by ${filterType}: ${value}`,
    })
    if (onNavigate) {
      onNavigate("history", { [filterType]: value })
    }
  }

  const handleToolClick = (toolName: string) => {
    toast({
      title: "Navigating to Call History",
      description: `Filtering calls using: ${toolName}`,
    })
  }

  const handleVolumeClick = (day: string, hour: number) => {
    toast({
      title: "Navigating to Call History",
      description: `Filtering calls from ${day} at ${hour}:00`,
    })
  }

  const kpis = getDefaultKpis(kpiData, handleDrilldown)

  const handleFiltersChange = (newFilters: AnalyticsFilters) => {
    setIsLoading(true)
    setFilters(newFilters)
    // Simulate data refresh
    setTimeout(() => {
      setIsLoading(false)
      toast({ title: "Filters Applied", description: "Analytics data updated" })
    }, 400)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-14 w-full" />
        <KpiRowSkeleton count={4} />
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <ChartSkeleton />
          </CardContent>
        </Card>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="pt-6">
                <ChartSkeleton />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Skeleton className="h-[200px]" />
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Analytics</h1>

      {/* Controls Bar */}
      <AnalyticsControlsBar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        phoneLines={phoneLines}
      />

      {/* KPI Row */}
      <AnalyticsKpiRow kpis={kpis} compareEnabled={filters.compareEnabled} />

      {/* Outcomes Over Time Chart */}
      <OutcomesOverTimeChart
        data={outcomesSeries}
        compareEnabled={filters.compareEnabled}
        onSegmentClick={(time, outcome) => handleDrilldown("time", time)}
      />

      {/* Volume + Insights */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VolumeModule hourlyData={hourlyData} heatmapData={heatmapData} onCellClick={handleVolumeClick} />
        </div>
        <InsightsCard
          insights={insights.map((insight) => ({
            type: insight.type as "regression" | "improvement" | "spike",
            title: insight.title,
            detail: insight.detail,
            severity: insight.severity as "low" | "medium" | "high",
            onClick: () => {},
          }))}
        />
      </div>

      {/* Performance Tables - Tools + Assistant */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ToolsPerformanceTable tools={toolsPerformance} onToolClick={handleToolClick} />
        {agentPerformance && <AssistantPerformanceCard assistant={agentPerformance} />}
      </div>
    </div>
  )
}

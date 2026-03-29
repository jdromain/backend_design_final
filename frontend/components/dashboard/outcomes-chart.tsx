"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts"

interface OutcomeData {
  time: string
  completed: number
  handoff: number
  dropped: number
  systemFailed: number
  prevCompleted?: number
  prevHandoff?: number
  prevDropped?: number
  prevSystemFailed?: number
}

interface OutcomesChartProps {
  data: OutcomeData[]
  onSegmentClick?: (time: string, outcome: string) => void
  compareEnabled?: boolean
}

type ViewMode = "count" | "rate"
type Granularity = "hour" | "day" | "week"

const outcomeColors = {
  completed: "#10b981", // Emerald green
  handoff: "#f59e0b", // Amber
  dropped: "#6b7280", // Gray
  systemFailed: "#ef4444", // Red
}

const outcomeLabels = {
  completed: "Completed",
  handoff: "Handoff",
  dropped: "Dropped",
  systemFailed: "System Failed",
}

export function OutcomesChart({ data, onSegmentClick, compareEnabled = false }: OutcomesChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("count")
  const [granularity, setGranularity] = useState<Granularity>("hour")

  const processedData = data.map((item) => {
    if (viewMode === "rate") {
      const total = item.completed + item.handoff + item.dropped + item.systemFailed
      return {
        ...item,
        completed: total > 0 ? Math.round((item.completed / total) * 100) : 0,
        handoff: total > 0 ? Math.round((item.handoff / total) * 100) : 0,
        dropped: total > 0 ? Math.round((item.dropped / total) * 100) : 0,
        systemFailed: total > 0 ? Math.round((item.systemFailed / total) * 100) : 0,
      }
    }
    return item
  })

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-card p-3 shadow-lg">
          <p className="mb-2 font-medium text-foreground">{label}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-sm text-muted-foreground capitalize">{entry.dataKey}:</span>
                <span className="font-medium text-foreground">
                  {entry.value}
                  {viewMode === "rate" ? "%" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  const handleClick = (data: any) => {
    if (onSegmentClick && data?.activePayload?.[0]) {
      const time = data.activeLabel
      const outcome = data.activePayload[0].dataKey
      onSegmentClick(time, outcome)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle>Call Results Over Time</CardTitle>
          <CardDescription>Call results breakdown over time</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="count" className="text-xs px-2">
                Count
              </TabsTrigger>
              <TabsTrigger value="rate" className="text-xs px-2">
                Rate %
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
            <TabsList className="h-8">
              <TabsTrigger value="hour" className="text-xs px-2">
                Hour
              </TabsTrigger>
              <TabsTrigger value="day" className="text-xs px-2">
                Day
              </TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-2">
                Week
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={processedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} onClick={handleClick}>
            <defs>
              <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={outcomeColors.completed} stopOpacity={0.4} />
                <stop offset="95%" stopColor={outcomeColors.completed} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="colorHandoff" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={outcomeColors.handoff} stopOpacity={0.4} />
                <stop offset="95%" stopColor={outcomeColors.handoff} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="colorDropped" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={outcomeColors.dropped} stopOpacity={0.3} />
                <stop offset="95%" stopColor={outcomeColors.dropped} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="colorSystemFailed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={outcomeColors.systemFailed} stopOpacity={0.4} />
                <stop offset="95%" stopColor={outcomeColors.systemFailed} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="time" tick={{ fill: "#ffffff", fontSize: 12 }} tickLine={false} axisLine={false} dy={10} />
            <YAxis
              tick={{ fill: "#ffffff", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              dx={-10}
              tickFormatter={(value) => (viewMode === "rate" ? `${value}%` : value)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              height={36}
              formatter={(value) => <span className="text-xs text-foreground">{outcomeLabels[value as keyof typeof outcomeLabels] || value}</span>}
              wrapperStyle={{ color: "hsl(var(--foreground))" }}
            />
            <Area
              type="monotone"
              dataKey="completed"
              stackId="1"
              stroke={outcomeColors.completed}
              strokeWidth={2}
              fill="url(#colorCompleted)"
              className="cursor-pointer"
            />
            <Area
              type="monotone"
              dataKey="handoff"
              stackId="1"
              stroke={outcomeColors.handoff}
              strokeWidth={2}
              fill="url(#colorHandoff)"
              className="cursor-pointer"
            />
            <Area
              type="monotone"
              dataKey="dropped"
              stackId="1"
              stroke={outcomeColors.dropped}
              strokeWidth={2}
              fill="url(#colorDropped)"
              className="cursor-pointer"
            />
            <Area
              type="monotone"
              dataKey="systemFailed"
              stackId="1"
              stroke={outcomeColors.systemFailed}
              strokeWidth={2}
              fill="url(#colorSystemFailed)"
              className="cursor-pointer"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

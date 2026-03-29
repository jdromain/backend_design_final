"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface OutcomeDataPoint {
  time: string
  handled: number
  escalated: number
  failed: number
  abandoned: number
  prevHandled?: number
  prevEscalated?: number
  prevFailed?: number
  prevAbandoned?: number
}

interface OutcomesOverTimeChartProps {
  data: OutcomeDataPoint[]
  compareEnabled: boolean
  onSegmentClick?: (time: string, outcome: string) => void
}

export function OutcomesOverTimeChart({ data, compareEnabled, onSegmentClick }: OutcomesOverTimeChartProps) {
  const [viewMode, setViewMode] = useState<"count" | "rate">("count")
  const [granularity, setGranularity] = useState<"hour" | "day" | "week">("day")

  const processedData = data.map((point) => {
    if (viewMode === "rate") {
      const total = point.handled + point.escalated + point.failed + point.abandoned
      return {
        ...point,
        handled: total > 0 ? (point.handled / total) * 100 : 0,
        escalated: total > 0 ? (point.escalated / total) * 100 : 0,
        failed: total > 0 ? (point.failed / total) * 100 : 0,
        abandoned: total > 0 ? (point.abandoned / total) * 100 : 0,
      }
    }
    return point
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
                  {viewMode === "rate" ? `${entry.value.toFixed(1)}%` : entry.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Outcomes Over Time</CardTitle>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border p-0.5">
            <Button
              variant={viewMode === "count" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("count")}
              className={cn("h-7 px-3", viewMode !== "count" && "bg-transparent")}
            >
              Count
            </Button>
            <Button
              variant={viewMode === "rate" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("rate")}
              className={cn("h-7 px-3", viewMode !== "rate" && "bg-transparent")}
            >
              Rate %
            </Button>
          </div>
          <Select value={granularity} onValueChange={(v) => setGranularity(v as any)}>
            <SelectTrigger className="w-[90px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">Hour</SelectItem>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <AreaChart
            data={processedData}
            onClick={(e) => {
              if (e && e.activeLabel && onSegmentClick) {
                onSegmentClick(String(e.activeLabel), "all")
              }
            }}
          >
            <defs>
              <linearGradient id="colorHandled" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorEscalated" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorAbandoned" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6b7280" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6b7280" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="time" tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => (viewMode === "rate" ? `${v}%` : v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ paddingTop: 16 }} />
            <Area
              type="monotone"
              dataKey="handled"
              stackId="1"
              stroke="#10b981"
              fill="url(#colorHandled)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="escalated"
              stackId="1"
              stroke="#f59e0b"
              fill="url(#colorEscalated)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="failed"
              stackId="1"
              stroke="#ef4444"
              fill="url(#colorFailed)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="abandoned"
              stackId="1"
              stroke="#6b7280"
              fill="url(#colorAbandoned)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

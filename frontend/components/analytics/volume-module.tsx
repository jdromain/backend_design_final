"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface HeatmapData {
  day: string
  hours: number[]
}

interface VolumeModuleProps {
  hourlyData: { hour: string; calls: number }[]
  heatmapData: HeatmapData[]
  onCellClick?: (day: string, hour: number) => void
}

export function VolumeModule({ hourlyData, heatmapData, onCellClick }: VolumeModuleProps) {
  const [viewMode, setViewMode] = useState<"bar" | "heatmap">("heatmap")

  const maxValue = Math.max(1, ...heatmapData.flatMap((d) => d.hours))

  const getHeatColor = (value: number) => {
    const intensity = value / maxValue
    if (intensity === 0) return "bg-muted"
    if (intensity < 0.25) return "bg-blue-500/20"
    if (intensity < 0.5) return "bg-blue-500/40"
    if (intensity < 0.75) return "bg-blue-500/60"
    return "bg-blue-500/90"
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-card p-3 shadow-lg">
          <p className="mb-1 font-medium text-foreground">{label}</p>
          <p className="text-sm text-muted-foreground">{payload[0].value} calls</p>
        </div>
      )
    }
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle>Call Volume</CardTitle>
        <div className="flex rounded-lg border p-0.5">
          <Button
            variant={viewMode === "heatmap" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("heatmap")}
            className={cn("h-7 px-3", viewMode !== "heatmap" && "bg-transparent")}
          >
            Heatmap
          </Button>
          <Button
            variant={viewMode === "bar" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("bar")}
            className={cn("h-7 px-3", viewMode !== "bar" && "bg-transparent")}
          >
            Bar Chart
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {viewMode === "heatmap" ? (
          <div className="space-y-1">
            {/* Hour labels */}
            <div className="flex gap-1 pl-16">
              {hours
                .filter((_, i) => i % 3 === 0)
                .map((hour) => (
                  <div
                    key={hour}
                    className="w-6 text-center text-xs text-muted-foreground"
                    style={{ marginLeft: hour === 0 ? 0 : "auto" }}
                  >
                    {hour.toString().padStart(2, "0")}
                  </div>
                ))}
            </div>
            {/* Heatmap grid */}
            {heatmapData.map((dayData, dayIndex) => (
              <div key={dayData.day} className="flex items-center gap-1">
                <div className="w-14 text-right text-xs font-medium text-muted-foreground">{dayData.day}</div>
                <div className="flex flex-1 gap-0.5">
                  {dayData.hours.map((value, hourIndex) => (
                    <button
                      key={hourIndex}
                      className={cn(
                        "h-6 flex-1 rounded-sm transition-all hover:ring-2 hover:ring-primary",
                        getHeatColor(value),
                      )}
                      onClick={() => onCellClick?.(dayData.day, hourIndex)}
                      title={`${dayData.day} ${hourIndex}:00 - ${value} calls`}
                    />
                  ))}
                </div>
              </div>
            ))}
            {/* Legend */}
            <div className="mt-4 flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>Less</span>
              <div className="flex gap-0.5">
                <div className="h-4 w-4 rounded-sm bg-muted" />
                <div className="h-4 w-4 rounded-sm bg-blue-500/20" />
                <div className="h-4 w-4 rounded-sm bg-blue-500/40" />
                <div className="h-4 w-4 rounded-sm bg-blue-500/60" />
                <div className="h-4 w-4 rounded-sm bg-blue-500/90" />
              </div>
              <span>More</span>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="hour" tick={{ fill: "#9ca3af", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#9ca3af", fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }} />
              <Bar dataKey="calls" radius={[4, 4, 0, 0]}>
                {hourlyData.map((entry, index) => (
                  <Cell key={index} fill="#3b82f6" cursor="pointer" onClick={() => onCellClick?.("all", index)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

interface CallVolumeChartProps {
  data: Array<{ time: string; calls: number; previousCalls?: number }>
}

export function CallVolumeChart({ data }: CallVolumeChartProps) {
  const [showComparison, setShowComparison] = useState(true)
  const [timeRange, setTimeRange] = useState("24h")

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border bg-card p-3 shadow-lg">
          <p className="mb-2 font-medium text-foreground">{label}</p>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-sm text-muted-foreground">Today:</span>
              <span className="font-medium text-foreground">{payload[0]?.value} calls</span>
            </div>
            {showComparison && payload[1] && (
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-violet-400" />
                <span className="text-sm text-muted-foreground">Yesterday:</span>
                <span className="font-medium text-foreground">{payload[1]?.value} calls</span>
              </div>
            )}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle>Call Volume</CardTitle>
          <CardDescription>Incoming calls over time with comparison to previous period</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={timeRange} onValueChange={setTimeRange}>
            <TabsList className="h-8">
              <TabsTrigger value="24h" className="text-xs px-2">
                24h
              </TabsTrigger>
              <TabsTrigger value="7d" className="text-xs px-2">
                7d
              </TabsTrigger>
              <TabsTrigger value="30d" className="text-xs px-2">
                30d
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant={showComparison ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setShowComparison(!showComparison)}
            className="text-xs"
          >
            Compare
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCalls" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="colorPrevious" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} vertical={false} />
            <XAxis dataKey="time" tick={{ fill: "#ffffff", fontSize: 12 }} tickLine={false} axisLine={false} dy={10} />
            <YAxis tick={{ fill: "#ffffff", fontSize: 12 }} tickLine={false} axisLine={false} dx={-10} />
            <Tooltip content={<CustomTooltip />} />
            {showComparison && (
              <Area
                type="monotone"
                dataKey="previousCalls"
                stroke="#a78bfa"
                strokeWidth={2}
                strokeDasharray="4 4"
                fillOpacity={1}
                fill="url(#colorPrevious)"
                name="Yesterday"
              />
            )}
            <Area
              type="monotone"
              dataKey="calls"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fillOpacity={1}
              fill="url(#colorCalls)"
              name="Today"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

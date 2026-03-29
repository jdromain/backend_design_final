"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Phone, Bot, Database, Cpu, TrendingUp, TrendingDown } from "lucide-react"

interface UsageMeter {
  id: string
  label: string
  icon: "phone" | "bot" | "storage" | "tokens"
  used: number
  limit: number
  unit: string
  trend: number // percentage vs last period
}

interface UsageMetersGridProps {
  meters: UsageMeter[]
}

const iconMap = {
  phone: Phone,
  bot: Bot,
  storage: Database,
  tokens: Cpu,
}

export function UsageMetersGrid({ meters }: UsageMetersGridProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {meters.map((meter) => {
        const Icon = iconMap[meter.icon]
        const percent = Math.round((meter.used / meter.limit) * 100)
        const isWarning = percent >= 80
        const isCritical = percent >= 95

        return (
          <Card key={meter.id} className={isCritical ? "border-red-500/50" : isWarning ? "border-amber-500/50" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {meter.label}
                </span>
                <span
                  className={`flex items-center gap-1 text-xs ${meter.trend >= 0 ? "text-emerald-500" : "text-red-500"}`}
                >
                  {meter.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(meter.trend)}%
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold">
                    {meter.unit === "GB" ? meter.used.toFixed(1) : meter.used.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    / {meter.unit === "GB" ? meter.limit.toFixed(0) : meter.limit.toLocaleString()} {meter.unit}
                  </span>
                </div>
                <Progress
                  value={percent}
                  className={isCritical ? "[&>div]:bg-red-500" : isWarning ? "[&>div]:bg-amber-500" : ""}
                />
                <p
                  className={`text-xs ${isCritical ? "text-red-500" : isWarning ? "text-amber-500" : "text-muted-foreground"}`}
                >
                  {percent}% used
                  {isCritical && " - Limit reached soon"}
                  {isWarning && !isCritical && " - Approaching limit"}
                </p>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

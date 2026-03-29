"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ArrowUp, ArrowDown, Info, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface KpiTileProps {
  title: string
  value: string | number
  subValue?: string
  change?: number
  changeLabel?: string
  icon: LucideIcon
  sparklineData?: number[]
  color?: "default" | "success" | "warning" | "danger" | "info"
  pulse?: boolean
  isActive?: boolean
  onClick?: () => void
  tooltip?: string
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const width = 60
  const height = 20
  const padding = 2

  const points = data
    .map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2)
      const y = height - padding - ((value - min) / range) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
        className="opacity-70"
      />
    </svg>
  )
}

const colorConfig = {
  default: {
    icon: "bg-primary/10 text-primary",
    sparkline: "hsl(var(--primary))",
    ring: "ring-primary/30",
  },
  success: {
    icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    sparkline: "hsl(142.1 76.2% 36.3%)",
    ring: "ring-emerald-500/30",
  },
  warning: {
    icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    sparkline: "hsl(48 96% 53%)",
    ring: "ring-amber-500/30",
  },
  danger: {
    icon: "bg-red-500/10 text-red-600 dark:text-red-400",
    sparkline: "hsl(0 84.2% 60.2%)",
    ring: "ring-red-500/30",
  },
  info: {
    icon: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    sparkline: "hsl(199 89% 48%)",
    ring: "ring-sky-500/30",
  },
}

export function KpiTile({
  title,
  value,
  subValue,
  change,
  changeLabel = "vs prev period",
  icon: Icon,
  sparklineData,
  color = "default",
  pulse = false,
  isActive = false,
  onClick,
  tooltip,
}: KpiTileProps) {
  const config = colorConfig[color]
  const isPositive = change && change > 0
  const isNegative = change && change < 0

  return (
    <Card
      className={cn(
        "relative overflow-hidden cursor-pointer transition-all hover:shadow-md",
        isActive && `ring-2 ${config.ring}`,
        onClick && "hover:border-primary/50",
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
              {tooltip && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[200px]">
                      <p className="text-xs">{tooltip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight">{value}</span>
              {pulse && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
              )}
            </div>
            {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
            {change !== undefined && (
              <div className="flex items-center gap-1 mt-1">
                {isPositive && (
                  <span className="flex items-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <ArrowUp className="h-3 w-3" />
                    {change}%
                  </span>
                )}
                {isNegative && (
                  <span className="flex items-center text-xs font-medium text-red-600 dark:text-red-400">
                    <ArrowDown className="h-3 w-3" />
                    {Math.abs(change)}%
                  </span>
                )}
                {!isPositive && !isNegative && <span className="text-xs text-muted-foreground">0%</span>}
                <span className="text-xs text-muted-foreground">{changeLabel}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", config.icon)}>
              <Icon className="h-4 w-4" />
            </div>
            {sparklineData && <Sparkline data={sparklineData} color={config.sparkline} />}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

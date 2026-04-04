"use client"

import React from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

export interface InsightItem {
  id: string
  label: string
  count: number
  trend?: "up" | "down" | "flat"
  change?: number
}

interface InsightsCardProps {
  title: string
  icon: React.ReactNode
  items: InsightItem[]
  onItemClick?: (item: InsightItem) => void
  emptyMessage?: string
}

const trendConfig = {
  up: { icon: TrendingUp, color: "text-red-500" },
  down: { icon: TrendingDown, color: "text-emerald-500" },
  flat: { icon: Minus, color: "text-muted-foreground" },
}

export function InsightsCard({ title, icon, items, onItemClick, emptyMessage = "No data" }: InsightsCardProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <ScrollArea className="h-[180px]">
            <div className="space-y-1">
              {items.map((item, index) => {
                const trendEntry = item.trend && item.trend in trendConfig ? trendConfig[item.trend as keyof typeof trendConfig] : null
                const TrendIcon = trendEntry?.icon ?? null
                const trendColor = trendEntry?.color ?? ""

                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => onItemClick?.(item)}
                    className={cn(
                      "w-full flex items-center justify-between p-2 rounded-md text-left",
                      "hover:bg-muted/50 transition-colors group"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-muted-foreground w-4 shrink-0">
                        {index + 1}.
                      </span>
                      <span className="text-sm truncate">{item.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {TrendIcon && item.change !== undefined && (
                        <span className={cn("flex items-center text-xs", trendColor)}>
                          <TrendIcon className="h-3 w-3 mr-0.5" />
                          {Math.abs(item.change)}%
                        </span>
                      )}
                      <span className="text-sm font-medium tabular-nums">{item.count}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

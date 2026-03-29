"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Lightbulb, TrendingUp, TrendingDown, Zap, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface Insight {
  type: "regression" | "improvement" | "spike"
  title: string
  detail: string
  severity: "low" | "medium" | "high"
  onClick?: () => void
}

interface InsightsCardProps {
  insights: Insight[]
}

export function InsightsCard({ insights }: InsightsCardProps) {
  const getIcon = (type: Insight["type"]) => {
    switch (type) {
      case "regression":
        return TrendingDown
      case "improvement":
        return TrendingUp
      case "spike":
        return Zap
    }
  }

  const getColor = (type: Insight["type"], severity: Insight["severity"]) => {
    if (type === "improvement") return "text-emerald-500"
    if (type === "regression") {
      return severity === "high" ? "text-red-500" : "text-amber-500"
    }
    return "text-blue-500"
  }

  const getSeverityBadge = (severity: Insight["severity"]) => {
    const colors = {
      low: "bg-muted text-muted-foreground",
      medium: "bg-amber-500/10 text-amber-500",
      high: "bg-red-500/10 text-red-500",
    }
    return colors[severity]
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <CardTitle className="text-base">Insights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No insights for this period</p>
        ) : (
          insights.map((insight, index) => {
            const Icon = getIcon(insight.type)
            return (
              <button
                key={index}
                onClick={insight.onClick}
                className="flex w-full items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted text-left"
              >
                <Icon className={cn("h-5 w-5 mt-0.5 shrink-0", getColor(insight.type, insight.severity))} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{insight.title}</p>
                    <Badge variant="secondary" className={cn("text-xs shrink-0", getSeverityBadge(insight.severity))}>
                      {insight.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{insight.detail}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              </button>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

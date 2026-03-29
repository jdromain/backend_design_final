"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Bot } from "lucide-react"

interface AgentUsage {
  id: string
  name: string
  calls: number
  minutes: number
  tokens: number
  cost: number
}

interface AgentUsageCardProps {
  agent: AgentUsage
}

export function AgentUsageCard({ agent }: AgentUsageCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" />
          Agent Usage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-1">{agent.name}</p>
            <p className="text-xs text-muted-foreground">Total cost this period</p>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-3 border-t">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Calls</p>
              <p className="text-lg font-semibold">{agent.calls.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Minutes</p>
              <p className="text-lg font-semibold">{agent.minutes.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tokens</p>
              <p className="text-lg font-semibold">{(agent.tokens / 1000).toFixed(1)}k</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Cost</p>
              <p className="text-lg font-semibold">${agent.cost.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

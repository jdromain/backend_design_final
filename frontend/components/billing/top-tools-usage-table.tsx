"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Wrench } from "lucide-react"

interface ToolUsage {
  id: string
  name: string
  invocations: number
  errorRate: number
  cost: number
}

interface TopToolsUsageTableProps {
  tools: ToolUsage[]
}

export function TopToolsUsageTable({ tools }: TopToolsUsageTableProps) {
  const sortedTools = [...tools].sort((a, b) => b.invocations - a.invocations).slice(0, 5)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" />
          Top Tools by Usage
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sortedTools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Wrench className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No tool usage this period</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead className="text-right">Invocations</TableHead>
                <TableHead className="text-right">Error Rate</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTools.map((tool) => (
                <TableRow key={tool.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">{tool.name}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {tool.invocations.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant="secondary"
                      className={
                        tool.errorRate > 5
                          ? "bg-red-500/10 text-red-500"
                          : tool.errorRate > 2
                            ? "bg-amber-500/10 text-amber-500"
                            : "bg-emerald-500/10 text-emerald-500"
                      }
                    >
                      {tool.errorRate.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">${tool.cost.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

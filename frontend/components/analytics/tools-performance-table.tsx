"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Wrench, ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState } from "react"
import { cn } from "@/lib/utils"

interface ToolPerformance {
  name: string
  usageCount: number
  failureRate: number
  avgLatency: number
  lastFailure: string | null
}

interface ToolsPerformanceTableProps {
  tools: ToolPerformance[]
  onToolClick?: (toolName: string) => void
}

type SortKey = "name" | "usageCount" | "failureRate" | "avgLatency"

export function ToolsPerformanceTable({ tools, onToolClick }: ToolsPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("usageCount")
  const [sortDesc, setSortDesc] = useState(true)

  const sortedTools = [...tools].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal)
    }
    return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const SortButton = ({ column, label }: { column: SortKey; label: string }) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 data-[state=open]:bg-accent bg-transparent"
      onClick={() => handleSort(column)}
    >
      {label}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <Wrench className="h-5 w-5 text-muted-foreground" />
        <CardTitle className="text-base">Tools Performance</CardTitle>
      </CardHeader>
      <CardContent>
        {tools.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data for this period</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton column="name" label="Tool" />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton column="usageCount" label="Usage" />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton column="failureRate" label="Failure Rate" />
                </TableHead>
                <TableHead className="text-right">
                  <SortButton column="avgLatency" label="Avg Latency" />
                </TableHead>
                <TableHead className="text-right">Last Failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTools.map((tool) => (
                <TableRow
                  key={tool.name}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onToolClick?.(tool.name)}
                >
                  <TableCell className="font-medium font-mono text-sm">{tool.name}</TableCell>
                  <TableCell className="text-right">{tool.usageCount}</TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "font-mono",
                        tool.failureRate > 10 && "bg-red-500/10 text-red-500",
                        tool.failureRate > 5 && tool.failureRate <= 10 && "bg-amber-500/10 text-amber-500",
                      )}
                    >
                      {tool.failureRate.toFixed(1)}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{tool.avgLatency}ms</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">{tool.lastFailure || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

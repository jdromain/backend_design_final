"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { CallRecord } from "@/lib/types";
import { formatDistance } from "date-fns";

interface RecentCallsTableProps {
  calls: CallRecord[];
}

export function RecentCallsTable({ calls }: RecentCallsTableProps) {
  const getOutcomeBadge = (outcome: CallRecord["outcome"]) => {
    const variants: Record<CallRecord["outcome"], "default" | "secondary" | "destructive" | "outline"> = {
      handled: "default",
      escalated: "secondary",
      failed: "destructive",
      abandoned: "outline",
    };
    return variants[outcome];
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "N/A";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Calls</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Tools</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No calls yet
                </TableCell>
              </TableRow>
            ) : (
              calls.map((call) => (
                <TableRow key={call.callId}>
                  <TableCell>
                    {formatDistance(new Date(call.startedAt), new Date(), {
                      addSuffix: true,
                    })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {call.callerNumber || "Unknown"}
                  </TableCell>
                  <TableCell>{formatDuration(call.durationMs)}</TableCell>
                  <TableCell>
                    <Badge variant={getOutcomeBadge(call.outcome)}>
                      {call.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {call.toolsUsed?.length || 0} tools
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}


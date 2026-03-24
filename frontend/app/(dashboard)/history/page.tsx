"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { Calendar, Search, Filter } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import type { CallRecord } from "@/lib/types";

const columns: ColumnDef<CallRecord>[] = [
  {
    accessorKey: "startedAt",
    header: "Date & Time",
    cell: ({ row }) => {
      const date = new Date(row.getValue("startedAt"));
      return (
        <div className="flex flex-col">
          <span className="font-medium">{format(date, "MMM d, yyyy")}</span>
          <span className="text-xs text-muted-foreground">
            {format(date, "h:mm a")}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "callerNumber",
    header: "Caller",
    cell: ({ row }) => (
      <span className="font-mono text-sm">
        {row.getValue("callerNumber") || "Unknown"}
      </span>
    ),
  },
  {
    accessorKey: "phoneNumber",
    header: "Phone Line",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.getValue("phoneNumber")}</span>
    ),
  },
  {
    accessorKey: "durationMs",
    header: "Duration",
    cell: ({ row }) => {
      const ms = row.getValue("durationMs") as number | undefined;
      if (!ms) return "N/A";
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return minutes > 0
        ? `${minutes}m ${remainingSeconds}s`
        : `${remainingSeconds}s`;
    },
  },
  {
    accessorKey: "outcome",
    header: "Outcome",
    cell: ({ row }) => {
      const outcome = row.getValue("outcome") as CallRecord["outcome"];
      const variants: Record<
        CallRecord["outcome"],
        "default" | "secondary" | "destructive" | "outline"
      > = {
        handled: "default",
        escalated: "secondary",
        failed: "destructive",
        abandoned: "outline",
      };
      return <Badge variant={variants[outcome]}>{outcome}</Badge>;
    },
  },
  {
    accessorKey: "turnCount",
    header: "Turns",
    cell: ({ row }) => row.getValue("turnCount") || 0,
  },
  {
    accessorKey: "toolsUsed",
    header: "Tools",
    cell: ({ row }) => {
      const tools = row.getValue("toolsUsed") as string[] | undefined;
      return (
        <span className="text-sm text-muted-foreground">
          {tools?.length || 0}
        </span>
      );
    },
  },
];

export default function CallHistoryPage() {
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [limit] = useState(50);
  const [offset] = useState(0);

  const { data: calls = [], isLoading, error } = useQuery({
    queryKey: ["calls", "history", { outcomeFilter, limit, offset }],
    queryFn: () =>
      api.analytics.getCalls({
        limit,
        offset,
        outcome: outcomeFilter !== "all" ? (outcomeFilter as CallRecord["outcome"]) : undefined,
      }),
    refetchInterval: (query) => (query.state.error ? false : 30000),
    retry: 1,
  });

  // Filter calls based on search query
  const filteredCalls = calls.filter((call) => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      call.callerNumber?.toLowerCase().includes(search) ||
      call.phoneNumber?.toLowerCase().includes(search) ||
      call.callId?.toLowerCase().includes(search)
    );
  });

  const table = useReactTable({
    data: filteredCalls,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Call History</h1>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Call History</h1>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by caller, phone, or ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Filter by outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Outcomes</SelectItem>
                <SelectItem value="handled">Handled</SelectItem>
                <SelectItem value="escalated">Escalated</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="abandoned">Abandoned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {filteredCalls.length} Call{filteredCalls.length !== 1 ? "s" : ""}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      No calls found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


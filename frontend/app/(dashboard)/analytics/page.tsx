"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, AlertCircle, Clock, Zap } from "lucide-react";
import { api } from "@/lib/api";

const COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "hsl(var(--destructive))", "hsl(var(--muted))"];

export default function AnalyticsPage() {
  const { data: calls = [], isLoading, error } = useQuery({
    queryKey: ["calls", "all-analytics"],
    queryFn: () => api.analytics.getCalls({ limit: 1000 }),
    refetchInterval: (query) => (query.state.error ? false : 60000),
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Analytics</h1>
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      </div>
    );
  }

  // Calculate outcome distribution
  const outcomeData = [
    { name: "Handled", value: calls.filter((c) => c.outcome === "handled").length },
    { name: "Escalated", value: calls.filter((c) => c.outcome === "escalated").length },
    { name: "Failed", value: calls.filter((c) => c.outcome === "failed").length },
    { name: "Abandoned", value: calls.filter((c) => c.outcome === "abandoned").length },
  ];

  // Calculate hourly distribution
  const hourlyData = Array.from({ length: 24 }, (_, hour) => {
    const count = calls.filter((call) => {
      const callHour = new Date(call.startedAt).getHours();
      return callHour === hour;
    }).length;
    return {
      hour: hour.toString().padStart(2, "0") + ":00",
      calls: count,
    };
  });

  // Calculate tool usage
  const toolUsageMap = new Map<string, number>();
  calls.forEach((call) => {
    call.toolsUsed?.forEach((tool) => {
      toolUsageMap.set(tool, (toolUsageMap.get(tool) || 0) + 1);
    });
  });
  const toolUsageData = Array.from(toolUsageMap.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Calculate average duration by outcome
  const durationByOutcome = [
    {
      outcome: "Handled",
      avgDuration:
        calls
          .filter((c) => c.outcome === "handled" && c.durationMs)
          .reduce((sum, c) => sum + (c.durationMs || 0), 0) /
        (calls.filter((c) => c.outcome === "handled" && c.durationMs).length || 1) /
        1000,
    },
    {
      outcome: "Escalated",
      avgDuration:
        calls
          .filter((c) => c.outcome === "escalated" && c.durationMs)
          .reduce((sum, c) => sum + (c.durationMs || 0), 0) /
        (calls.filter((c) => c.outcome === "escalated" && c.durationMs).length || 1) /
        1000,
    },
    {
      outcome: "Failed",
      avgDuration:
        calls
          .filter((c) => c.outcome === "failed" && c.durationMs)
          .reduce((sum, c) => sum + (c.durationMs || 0), 0) /
        (calls.filter((c) => c.outcome === "failed" && c.durationMs).length || 1) /
        1000,
    },
  ];

  // Insights
  const totalCalls = calls.length;
  const successRate = totalCalls > 0
    ? ((calls.filter((c) => c.outcome === "handled").length / totalCalls) * 100).toFixed(1)
    : "0.0";
  const avgDuration = totalCalls > 0
    ? Math.floor(
        calls.reduce((sum, c) => sum + (c.durationMs || 0), 0) / totalCalls / 1000
      )
    : 0;
  const peakHour = hourlyData.reduce((max, item) => (item.calls > max.calls ? item : max), hourlyData[0]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Analytics</h1>

      {/* Insights Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successRate}%</div>
            <p className="text-xs text-muted-foreground">
              {calls.filter((c) => c.outcome === "handled").length} of {totalCalls} calls handled
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgDuration}s</div>
            <p className="text-xs text-muted-foreground">
              Average call length
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Peak Hour</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{peakHour.hour}</div>
            <p className="text-xs text-muted-foreground">
              {peakHour.calls} calls during busiest hour
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Escalation Rate</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalCalls > 0
                ? ((calls.filter((c) => c.outcome === "escalated").length / totalCalls) * 100).toFixed(1)
                : "0.0"}%
            </div>
            <p className="text-xs text-muted-foreground">
              Calls escalated to human
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Outcome Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Call Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={outcomeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name} ${((percent || 0) * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="hsl(var(--primary))"
                  dataKey="value"
                >
                  {outcomeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Hourly Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Call Volume by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="hour"
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                />
                <Bar dataKey="calls" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Tool Usage */}
        <Card>
          <CardHeader>
            <CardTitle>Top Tools Used</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={toolUsageData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" className="text-xs" stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  type="category"
                  dataKey="tool"
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Duration by Outcome */}
        <Card>
          <CardHeader>
            <CardTitle>Avg Duration by Outcome</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={durationByOutcome}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="outcome"
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  className="text-xs"
                  stroke="hsl(var(--muted-foreground))"
                  label={{ value: "Seconds", angle: -90, position: "insideLeft" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                />
                <Bar dataKey="avgDuration" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

